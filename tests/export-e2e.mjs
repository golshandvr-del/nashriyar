// Export E2E (ROADMAP phase 18): every DataTable's streaming export endpoint against a seeded server.
// Asserts the XLSX structure on the raw OOXML (stored ZIP ⇒ readable without a library): column widths, frozen header,
// autofilter, RTL, print setup, SUBTOTAL totals; that CSV has a UTF-8 BOM; that the file holds exactly the rows the
// list API returns (same query, every keyset page) and honours the on-screen table state (dt_* filters/sort/columns);
// and that the endpoints keep the list's permissions (401 anonymous, 403 for users outside the scope).
// Usage: BASE=http://localhost:3000 node tests/export-e2e.mjs   (or via `npm test`)
const BASE = process.env.BASE || 'http://localhost:3000'
let failures = 0
let passed = 0
const ok = (cond, msg) => {
  if (!cond) {
    failures++
    console.log('FAIL', msg)
  } else passed++
}

function client() {
  let cookie = ''
  return async function call(path, opts = {}) {
    const headers = { Origin: BASE, ...(opts.json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }
    const res = await fetch(BASE + path, { method: opts.json !== undefined ? 'POST' : 'GET', headers, body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined, redirect: 'manual' })
    const sc = res.headers.get('set-cookie')
    if (sc && sc.includes('nsh_sid=')) cookie = sc.split(';')[0]
    const ct = res.headers.get('content-type') || ''
    const buf = new Uint8Array(await res.arrayBuffer())
    return { status: res.status, ct, buf, json: ct.includes('json') ? JSON.parse(new TextDecoder().decode(buf) || 'null') : null, text: () => new TextDecoder().decode(buf), headers: res.headers }
  }
}
async function login(username, password) {
  const c = client()
  const r = await c('/api/auth/login', { json: { username, password } })
  ok(r.status === 200, `login ${username} -> ${r.status}`)
  return c
}

/** Reads a stored (method 0) ZIP through its central directory — also works for streamed entries. */
function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let e = bytes.length - 22
  while (e > 0 && dv.getUint32(e, true) !== 0x06054b50) e--
  if (e <= 0) return null
  const count = dv.getUint16(e + 10, true)
  let p = dv.getUint32(e + 16, true)
  const files = {}
  for (let i = 0; i < count; i++) {
    const size = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nl))
    const ln = dv.getUint16(off + 26, true), lx = dv.getUint16(off + 28, true)
    files[name] = new TextDecoder().decode(bytes.subarray(off + 30 + ln + lx, off + 30 + ln + lx + size))
    p += 46 + nl + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true)
  }
  return files
}

/** CSV → rows (quoted fields, CRLF). */
function parseCsv(text) {
  const rows = []
  let row = [], f = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"' && text[i + 1] === '"') (f += '"'), i++
      else if (ch === '"') q = false
      else f += ch
    } else if (ch === '"') q = true
    else if (ch === ',') row.push(f), (f = '')
    else if (ch === '\n') row.push(f.replace(/\r$/, '')), rows.push(row), (row = []), (f = '')
    else f += ch
  }
  if (f || row.length) row.push(f), rows.push(row)
  return rows
}

/** Every keyset page of a list API. */
async function allRows(c, path, key) {
  const out = []
  let cursor = null
  for (let i = 0; i < 50; i++) {
    const sep = path.includes('?') ? '&' : '?'
    const r = await c(path + (cursor ? `${sep}cursor=${encodeURIComponent(cursor)}` : ''))
    ok(r.status === 200, `GET ${path} -> ${r.status}`)
    out.push(...(r.json?.[key] || []))
    if (!r.json?.next_cursor) break
    cursor = r.json.next_cursor
  }
  return out
}

/** Full check of one export endpoint. */
async function checkExport(c, label, list, key, exp, extra = '') {
  const rows = await allRows(c, list, key)
  const sep = exp.includes('?') ? '&' : '?'
  // CSV: BOM, header, exactly the API's rows
  const csv = await c(`${exp}${sep}format=csv${extra}`)
  ok(csv.status === 200, `${label} csv -> ${csv.status}`)
  ok(/text\/csv/.test(csv.ct), `${label} csv content-type ${csv.ct}`)
  ok(csv.buf[0] === 0xef && csv.buf[1] === 0xbb && csv.buf[2] === 0xbf, `${label} csv starts with a UTF-8 BOM`)
  ok(/attachment; filename="[\w.-]+"/.test(csv.headers.get('content-disposition') || ''), `${label} csv has an ASCII attachment filename`)
  const lines = parseCsv(csv.text().replace(/^\uFEFF/, '')).filter((r) => r.length > 1 || r[0])
  ok(lines.length - 1 === rows.length, `${label} csv rows ${lines.length - 1} = api rows ${rows.length}`)
  // XLSX: structure
  const x = await c(`${exp}${sep}paper=A3&orientation=landscape${extra}`)
  ok(x.status === 200 && /spreadsheetml/.test(x.ct), `${label} xlsx -> ${x.status} ${x.ct}`)
  const f = unzip(x.buf)
  ok(!!f, `${label} xlsx is a readable zip`)
  if (!f) return { rows, header: lines[0] }
  for (const part of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) ok(!!f[part], `${label} xlsx part ${part}`)
  const s = f['xl/worksheets/sheet1.xml'] || ''
  const widths = [...s.matchAll(/<col min="\d+" max="\d+" width="([\d.]+)" customWidth="1"\/>/g)].map((m) => Number(m[1]))
  ok(widths.length === lines[0].length, `${label} xlsx has one width per column (${widths.length} vs ${lines[0].length})`)
  ok(widths.every((w) => w >= 6 && w <= 80), `${label} xlsx widths within bounds ${widths}`)
  ok(/<pane ySplit="\d+"[^>]*state="frozen"/.test(s), `${label} xlsx frozen header`)
  ok(/<autoFilter ref="A\d+:[A-Z]+\d+"\/>/.test(s), `${label} xlsx autofilter`)
  ok(s.includes('rightToLeft="1"'), `${label} xlsx RTL`)
  ok(/<pageSetup paperSize="8" orientation="landscape" fitToWidth="1"/.test(s), `${label} xlsx A3 landscape fit-to-width`)
  ok(/<oddFooter>[^<]*&amp;P[^<]*&amp;N/.test(s), `${label} xlsx page numbers in the footer`)
  const dataRows = (s.match(/<row /g) || []).length
  ok(dataRows >= rows.length + 1, `${label} xlsx rows ${dataRows} ≥ api rows ${rows.length} + header`)
  return { rows, header: lines[0], sheet: s, csv: lines }
}

const anon = client()
const officer = await login('officer', 'officer1234')
const team = await login('pub1-director', 'team1234')
const student = await login('40012345', 'student1234')

// ── admin lists ──
await checkExport(officer, 'users', '/api/admin/users?limit=300', 'users', '/api/admin/users/export')
await checkExport(officer, 'people', '/api/admin/people?limit=300', 'people', '/api/admin/people/export')
const pubs = await checkExport(officer, 'publications', '/api/admin/publications', 'publications', '/api/admin/publications/export')
await checkExport(officer, 'audit', '/api/admin/audit?limit=300', 'items', '/api/admin/audit/export')
await checkExport(officer, 'requests (all pubs)', '/api/membership/queue?status=all', 'requests', '/api/membership/queue/export?status=all')

// totals row: SUBTOTAL over the data range for `total: 'sum'` columns
ok(/<f>SUBTOTAL\(109,[A-Z]+\d+:[A-Z]+\d+\)<\/f>/.test(pubs.sheet || ''), 'publications xlsx has SUBTOTAL(109) totals')

// ── table state: same filter / sort / columns as the screen ──
{
  const all = await allRows(officer, '/api/admin/users?limit=300', 'users')
  const students = all.filter((u) => u.system_role === 'student')
  const r = await officer('/api/admin/users/export?format=csv&dt_f_system_role=student&dt_cols=display_name,entry_year&dt_sort=entry_year.desc')
  const lines = parseCsv(r.text().replace(/^\uFEFF/, '')).filter((x) => x.length > 1 || x[0])
  ok(lines[0].join('|') === 'نام|سال ورود', `dt_cols picks and orders the columns: ${lines[0]}`)
  ok(lines.length - 1 === students.length, `dt_f filter: ${lines.length - 1} = ${students.length} students`)
  const years = lines.slice(1).map((x) => x[1]).filter(Boolean).map(Number)
  ok(years.every((y, i) => i === 0 || years[i - 1] >= y), 'dt_sort desc is applied')
  // empty cells sort last in both directions
  const ys = lines.slice(1).map((x) => x[1])
  ok(ys.indexOf('') === -1 || ys.slice(ys.indexOf('')).every((y) => y === ''), 'empty values are last')
  // grouping puts the group column first
  const g = await officer('/api/admin/publications/export?format=csv&dt_group=frequency&dt_cols=title,published_count')
  ok(parseCsv(g.text().replace(/^\uFEFF/, ''))[0].join('|') === 'دورهٔ انتشار|نشریه|منتشرشده', 'dt_group puts the group column first')
  // Persian search: Arabic ي/ك and digit forms normalised the same as on screen
  const someone = students.find((u) => u.display_name)
  if (someone) {
    const name = someone.display_name.split(' ')[0].replace(/ی/g, 'ي').replace(/ک/g, 'ك')
    const s = await officer(`/api/admin/users/export?format=csv&dt_q=${encodeURIComponent(name)}&dt_cols=display_name`)
    const found = parseCsv(s.text().replace(/^\uFEFF/, '')).slice(1).map((x) => x[0])
    ok(found.includes(someone.display_name), `dt_q Persian-normalised search finds «${someone.display_name}» via «${name}»`)
  }
  // unknown columns / malformed state are ignored, not errors
  const bad = await officer('/api/admin/users/export?format=csv&dt_cols=nope,display_name&dt_sort=nope.asc&dt_f_nope=1')
  ok(bad.status === 200 && parseCsv(bad.text().replace(/^\uFEFF/, ''))[0].join('|') === 'نام', 'unknown dt_* keys are ignored')
}

// ── team lists (scoped to one publication) ──
const tp = (await team('/api/team/my')).json?.publications?.[0]?.publication_id
ok(!!tp, 'team account has a publication')
for (const [label, list, key, exp] of [
  ['members', `/api/team/${tp}/members`, 'members', `/api/team/${tp}/members/export`],
  ['issues', `/api/team/${tp}/issues`, 'issues', `/api/team/${tp}/issues/export`],
  ['codes', `/api/team/${tp}/codes`, 'codes', `/api/team/${tp}/codes/export`],
  ['print sales', `/api/team/${tp}/physical-sales`, 'sales', `/api/team/${tp}/physical-sales/export`],
  ['requests (team)', `/api/membership/queue?publication_id=${tp}&status=all`, 'requests', `/api/membership/queue/export?publication_id=${tp}&status=all`]
])
  await checkExport(team, label, list, key, exp)

// codes export never contains a raw code (only the last 4)
{
  const r = await team(`/api/team/${tp}/codes/export?format=csv&dt_cols=code_last4,state,price_paid`)
  ok(!/NSH-[A-Z0-9]{4}-[A-Z0-9]{4}/.test(r.text()), 'codes export holds no raw purchase code')
}

// ── permissions: exports keep the list's access rules ──
for (const p of ['/api/admin/users/export', '/api/admin/people/export', '/api/admin/publications/export', '/api/admin/audit/export', `/api/team/${tp}/members/export`, `/api/team/${tp}/codes/export`, '/api/membership/queue/export']) {
  const r = await anon(p)
  ok(r.status === 401, `anonymous ${p} -> ${r.status} (expected 401)`)
}
for (const p of ['/api/admin/users/export', '/api/admin/audit/export', `/api/team/${tp}/members/export`, `/api/team/${tp}/physical-sales/export`, '/api/membership/queue/export']) {
  const r = await student(p)
  ok(r.status === 403 || r.status === 404, `student ${p} -> ${r.status} (expected 403/404)`)
}
{
  const other = pubs.rows.find((p) => p.id !== tp)
  if (other) {
    const r = await team(`/api/team/${other.id}/members/export`)
    ok(r.status === 403 || r.status === 404, `team of another publication -> ${r.status} (expected 403/404)`)
  }
}

console.log(failures ? `export-e2e: ${failures} failed, ${passed} passed` : `export-e2e: ${passed} checks passed`)
process.exit(failures ? 1 : 0)

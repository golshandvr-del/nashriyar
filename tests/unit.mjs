// Unit tests for the pure analytics/insight helpers (ROADMAP phase 8: rules as pure, testable functions).
// Bundles the TypeScript sources with esbuild into a temp file, then asserts with node:assert. No server needed.
// Usage: node tests/unit.mjs
import { buildSync } from 'esbuild'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nashriyar-unit-')), 'pure.mjs')
buildSync({
  stdin: { contents: "export { healthVerdict } from './src/server/insights'\nexport { linearFit, termBounds, academicYearOf, academicYearRange, academicYears } from './src/shared/fa'\nexport { reminderMark, DEADLINE_MARKS, LICENSE_MARKS } from './src/server/lib/reminders'\nexport { redactText, scrubPersonal, scoreCategories, templateCaption } from './src/server/ai'\nexport { mapQuestion, sanitizeRoute } from './src/shared/askmap'\nexport { ruleHypotheses } from './src/server/lib/explain'\nexport { cursorPage } from './src/server/lib/util'\nexport { csvToRows, buildXlsx } from './src/web/lib/xlsx'\nexport { writeDomains } from './src/server/lib/rollup'\nexport { str, int, oneOf } from './src/server/lib/util'\nexport { v, parseInput, faMsg } from './src/server/lib/validate'\nexport { buildTableXlsx, streamTableXlsx, buildCsv, columnWidths, jalaliCell, csvField } from './src/shared/sheet'\nexport { ZipStream, crc32 } from './src/shared/zip'\nexport { parseTableState, tableStateToParams, applyTable, groupRows, exportColumns, exportRow, describeState, toSheetColumns } from './src/shared/table'\nexport { parseTenantConfig, resolveTenant, normalizeHost, tenantSecret } from './src/server/tenancy'", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', external: ['node:*']
})
const m = await import(out)
let n = 0
const t = (name, fn) => { fn(); n++; console.log('  ✓', name) }

t('linearFit: perfect line', () => {
  const f = m.linearFit([0, 1, 2, 3].map((x) => ({ x, y: 2 * x + 1 })))
  assert.equal(Math.round(f.slope * 1000) / 1000, 2)
  assert.equal(Math.round(f.intercept * 1000) / 1000, 1)
  assert.equal(Math.round(f.r2 * 1000) / 1000, 1)
})
t('linearFit: flat / degenerate input does not throw', () => {
  const f = m.linearFit([{ x: 0, y: 5 }, { x: 1, y: 5 }])
  assert.equal(f.slope, 0)
  m.linearFit([])
})
const ok = { regularity: 1, activity: 1, audience: 1, explore: 1, hygiene: 1 }
const facts = { since: 10, exp: 30, acts: 40, views: 500, posts: 8, pending: 0 }
t('healthVerdict: green with no weak parts', () => {
  const v = m.healthVerdict(85, ok, facts)
  assert.equal(v.level, 'green')
  assert.equal(v.reasons.length, 1)
})
t('healthVerdict: thresholds 70 / 40', () => {
  assert.equal(m.healthVerdict(70, ok, facts).level, 'green')
  assert.equal(m.healthVerdict(69, ok, facts).level, 'yellow')
  assert.equal(m.healthVerdict(40, ok, facts).level, 'yellow')
  assert.equal(m.healthVerdict(39, ok, facts).level, 'red')
})
t('healthVerdict: each weak part yields a reason', () => {
  const v = m.healthVerdict(20, { regularity: 0, activity: 0.1, audience: 0.2, explore: 0, hygiene: 0.3 }, { ...facts, since: 95, pending: 8 })
  assert.equal(v.level, 'red')
  assert.equal(v.reasons.length, 5)
  assert.ok(v.reasons[0].includes('95'))
})
t('termBounds returns an ordered range', () => {
  if (typeof m.termBounds !== 'function') return
  const b = m.termBounds(new Date('2026-10-30T00:00:00Z'))
  const s = b.start ?? b[0], e = b.end ?? b[1]
  assert.ok(String(s) < String(e))
})
t('reminderMark: picks the tightest applicable mark', () => {
  assert.equal(m.reminderMark(10, m.DEADLINE_MARKS), null)
  assert.equal(m.reminderMark(7, m.DEADLINE_MARKS), 7)
  assert.equal(m.reminderMark(5, m.DEADLINE_MARKS), 7)
  assert.equal(m.reminderMark(3, m.DEADLINE_MARKS), 3)
  assert.equal(m.reminderMark(0, m.DEADLINE_MARKS), 1)
  assert.equal(m.reminderMark(-1, m.DEADLINE_MARKS), null)
  assert.equal(m.reminderMark(45, m.LICENSE_MARKS), 60)
  assert.equal(m.reminderMark(20, m.LICENSE_MARKS), 30)
})
t('AI scrub: personal keys dropped, identifiers redacted', () => {
  const s = m.scrubPersonal({ title: 'فرامتن', display_name: 'سارا', rows: [{ student_number: '40012345', views: 3, note: 'تماس 09121234567 یا a@b.ir @someone' }] })
  assert.equal(s.title, 'فرامتن')
  assert.equal(s.display_name, undefined)
  assert.equal(s.rows[0].student_number, undefined)
  assert.equal(s.rows[0].views, 3)
  assert.ok(!/0912|a@b|@someone/.test(s.rows[0].note))
  assert.equal(m.redactText('دانشجو ۴۰۰۱۲۳۴۵'), 'دانشجو [شماره]')
  assert.equal(m.redactText('سال ۱۴۰۵ — ۱۲ شماره'), 'سال ۱۴۰۵ — ۱۲ شماره')
})
t('askmap: questions map to whitelisted reports/ranges/faculties', () => {
  const fac = [{ id: 'f1', name: 'دانشکدهٔ فنی' }, { id: 'f2', name: 'دانشکدهٔ علوم انسانی' }]
  let r = m.mapQuestion('کدام دانشکده‌ها در شش ماه اخیر کمتر منتشر کرده‌اند؟', fac)
  assert.equal(r.report, 'gaps'); assert.equal(r.range, 'acad')
  r = m.mapQuestion('فروش ماه گذشته دانشکده علوم انسانی چقدر بود', fac)
  assert.equal(r.report, 'sales'); assert.equal(r.range, 'prevMonth'); assert.equal(r.faculty_id, 'f2')
  r = m.mapQuestion('بهترین نشریات امسال', fac)
  assert.equal(r.report, 'ranking'); assert.equal(r.range, 'year')
  r = m.mapQuestion('پیش‌بینی ترم آینده', fac)
  assert.equal(r.report, 'forecast')
  r = m.mapQuestion('روند بازدید در ۷ روز اخیر', fac)
  assert.equal(r.report, 'trends'); assert.equal(r.range, '7d')
  r = m.mapQuestion('سلام', fac)
  assert.equal(r.report, 'trends'); assert.equal(r.confidence, 0)
  const fac2 = [{ id: 'a', name: 'فنی و مهندسی' }, { id: 'b', name: 'علوم پایه' }, { id: 'c', name: 'علوم انسانی' }]
  assert.equal(m.mapQuestion('فروش دانشکده فنی', fac2).faculty_id, 'a')
  assert.equal(m.mapQuestion('روند علوم انسانی', fac2).faculty_id, 'c')
  assert.equal(m.mapQuestion('روند علوم', fac2).faculty_id, null)
  assert.deepEqual(m.sanitizeRoute({ report: 'DROP TABLE', range: 'year', faculty_id: 'x' }, fac), { range: 'year' })
})
t('explain: rule hypotheses follow the evidence', () => {
  const base = { publication_id: 'p', title: 't', frequency: 'monthly', days_since_last_issue: 10, issues_last_180: 3, members_active: 8, members_joined_90: 0, members_left_90: 0, director_changed_90: false, days_since_director_change: null, open_issues: 1, stuck_items: 0, last_activity_days: 2, posts_30: 2, posts_prev_30: 2, views_30: 50, views_prev_30: 50, pending_comments: 0, license_days_left: 300 }
  const calm = m.ruleHypotheses(base)
  assert.equal(calm.length, 1); assert.match(calm[0].text, /علت روشنی/)
  const bad = m.ruleHypotheses({ ...base, members_left_90: 3, members_active: 2, director_changed_90: true, days_since_director_change: 20, stuck_items: 4 })
  assert.ok(bad.length >= 4); assert.ok(bad.every((h) => h.source === 'rule'))
  assert.ok(bad.some((h) => /مدیرمسئول/.test(h.text))); assert.ok(bad.some((h) => /گلوگاه/.test(h.text)))
})
t('team helpers: category overlap + caption template', () => {
  const cats = [{ id: 'ai', name: 'هوش مصنوعی' }, { id: 'h', name: 'سلامت' }, { id: 'lit', name: 'ادبی و هنری' }]
  assert.deepEqual(m.scoreCategories('کاربرد هوش مصنوعی در درمان', cats), ['ai'])
  assert.deepEqual(m.scoreCategories('شعر و داستان کوتاه', cats), [])
  const cap = m.templateCaption({ section: 'سرمقاله', issue_title: 'آب', issue_number: 3, summary: 'دربارهٔ بحران آب. ادامه دارد.', publication: 'سبز' })
  assert.match(cap, /«سرمقاله» از شمارهٔ 3 سبز — آب\./)
  assert.match(cap, /دربارهٔ بحران آب\./)
  assert.ok(!/ادامه دارد/.test(cap))
})
// ROADMAP phase 17: more coverage of business logic — pagination, CSV parsing, xlsx container
const fakeCtx = (q) => ({ req: { query: (k) => q[k] } })
t('cursorPage: first page, limit clamp, next_cursor round-trip', () => {
  const pg = m.cursorPage(fakeCtx({ limit: '2' }), { col: 'a.created_at', idCol: 'a.id', max: 5 })
  assert.equal(pg.limit, 2); assert.equal(pg.fetch, 3); assert.equal(pg.and, ''); assert.deepEqual(pg.params, [])
  assert.equal(pg.order, 'a.created_at DESC, a.id DESC')
  const rows = [{ t: '3', id: 'c' }, { t: '2', id: 'b' }, { t: '1', id: 'a' }]
  const f = pg.finish(rows, (r) => [r.t, r.id])
  assert.equal(f.rows.length, 2); assert.ok(f.next_cursor)
  const pg2 = m.cursorPage(fakeCtx({ limit: '2', cursor: f.next_cursor }), { col: 'a.created_at', idCol: 'a.id' })
  assert.deepEqual(pg2.params, ['2', '2', 'b'])
  assert.match(pg2.and, /a\.created_at < \? OR \(a\.created_at = \? AND a\.id < \?\)/)
  assert.equal(pg2.finish(rows.slice(2), (r) => [r.t, r.id]).next_cursor, null)
  assert.equal(m.cursorPage(fakeCtx({ limit: '9999' }), { col: 'x', idCol: 'id', max: 5 }).limit, 5)
  assert.equal(m.cursorPage(fakeCtx({ limit: '-3' }), { col: 'x', idCol: 'id', def: 7 }).limit, 7)
  assert.match(m.cursorPage(fakeCtx({}), { col: 'x', idCol: 'id', dir: 'ASC', nullable: true }).order, /COALESCE\(x, ''\) ASC/)
})
t('cursorPage: garbage cursor → 400 bad_cursor', () => {
  for (const bad of ['%%%', 'bm90LWpzb24', btoa(encodeURIComponent('{"a":1}'))]) {
    assert.throws(() => m.cursorPage(fakeCtx({ cursor: bad }), { col: 'x', idCol: 'id' }), (e) => e.status === 400 && e.code === 'bad_cursor')
  }
})
t('csvToRows: BOM, quotes, escaped quotes, newlines in cells, CRLF', () => {
  const q = '"'
  const csv = '\ufeffنام,' + q + 'شهر، استان' + q + '\r\n' + q + 'علی ' + q + q + 'ع' + q + q + q + ',' + q + 'خط۱\nخط۲' + q + '\n'
  assert.deepEqual(m.csvToRows(csv), [['نام', 'شهر، استان'], ['علی "ع"', 'خط۱\nخط۲']])
  assert.deepEqual(m.csvToRows('a,,c'), [['a', '', 'c']])
})
t('buildXlsx: valid zip container, RTL sheet, escaped text, control chars dropped', () => {
  const bytes = m.buildXlsx([['عنوان', 'مبلغ'], ['<b>&"', 12000], ['bad\u0001char', null]], 'گزارش')
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b) // "PK"
  const text = new TextDecoder().decode(bytes)
  assert.ok(text.includes('xl/worksheets/sheet1.xml'))
  assert.ok(text.includes('rightToLeft="1"'))
  assert.ok(text.includes('&lt;b&gt;&amp;&quot;'))
  // the zip headers are binary (they legitimately contain 0x01 bytes); the cell text proves the control char was dropped
  assert.ok(text.includes('badchar'))
})
// ROADMAP phase 17 (docs/API_VERSIONING.md): zero-downtime migrations are additive and every file is registered
t('migrations are additive, numbered and all registered', () => {
  const files = fs.readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()
  const reg = fs.readFileSync('src/server/migrate.ts', 'utf8')
  files.forEach((f, i) => {
    assert.match(f, /^\d{4}_[a-z0-9_]+\.sql$/, `name ${f}`)
    assert.equal(Number(f.slice(0, 4)), i + 1, `contiguous numbering at ${f}`)
    assert.ok(reg.includes(`name: '${f.replace(/\.sql$/, '')}'`), `${f} registered in MIGRATIONS`)
    const sql = fs.readFileSync(path.join('migrations', f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
    for (const bad of [/\bDROP\s+(TABLE|COLUMN)\b/i, /\bRENAME\b/i, /\bALTER\s+TABLE\s+\w+\s+(DROP|ALTER)\b/i]) assert.ok(!bad.test(sql), `${f}: destructive statement ${bad}`)
    // a NOT NULL column added later must carry a DEFAULT, or existing rows would break the migration
    for (const m of sql.matchAll(/ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN\s+([^;]+)/gi)) {
      if (/NOT\s+NULL/i.test(m[1])) assert.match(m[1], /DEFAULT/i, `${f}: NOT NULL without DEFAULT: ${m[1].trim()}`)
    }
  })
})
// ROADMAP phase 17: targeted analytics-cache invalidation — write → data-domain mapping
t('writeDomains: reads and tracking never invalidate; writes map to their domains', () => {
  assert.deepEqual(m.writeDomains('GET', '/api/team/p1/codes'), [])
  assert.deepEqual(m.writeDomains('POST', '/api/public/track'), [])
  assert.deepEqual(m.writeDomains('POST', '/api/auth/login'), [])
  assert.deepEqual(m.writeDomains('POST', '/api/team/p1/physical-sales'), ['sales'])
  assert.deepEqual(m.writeDomains('POST', '/api/v1/team/p1/codes'), ['sales'])
  assert.deepEqual(m.writeDomains('POST', '/api/me/codes/redeem'), ['sales'])
  assert.deepEqual(m.writeDomains('POST', '/api/me/follows/p1'), ['social'])
  assert.deepEqual(m.writeDomains('PUT', '/api/team/p1/issues/i1'), ['content'])
  assert.ok(m.writeDomains('POST', '/api/admin/settings').includes('settings'))
  assert.ok(m.writeDomains('POST', '/api/admin/something-new').length >= 5, 'unknown writes bump everything')
})
// ROADMAP phase 17: academic-year dimension (1 Mehr → 31 Shahrivar)
t('academic year: boundaries at 1 Mehr, ranges contiguous, list newest first', () => {
  assert.equal(m.academicYearOf('2026-09-22'), 1404) // 31 Shahrivar 1405
  assert.equal(m.academicYearOf('2026-09-23'), 1405) // 1 Mehr 1405
  assert.equal(m.academicYearOf('2026-03-21T10:00:00Z'), 1404) // 1 Farvardin 1405 still belongs to 1404–1405
  const r = m.academicYearRange(1404)
  assert.equal(r.from, '2025-09-23')
  assert.equal(r.to, '2026-09-22')
  assert.ok(r.label.includes('۱۴۰۴') && r.label.includes('۱۴۰۵'))
  const next = m.academicYearRange(1405)
  assert.equal(new Date(next.from).getTime() - new Date(r.to).getTime(), 86400000, 'no gap / overlap between years')
  const ys = m.academicYears('2023-01-01', new Date('2026-11-01T00:00:00Z'))
  assert.deepEqual(ys.map((y) => y.year), [1405, 1404, 1403, 1402, 1401])
  assert.equal(ys.filter((y) => y.current).length, 1)
})
// ROADMAP phase 17: unified zod validation — same Persian messages for field helpers and object schemas
t('validation: str/int/oneOf via zod keep the Persian messages; parseInput reports every field', () => {
  const err = (f) => { try { f(); return null } catch (e) { return e } }
  assert.equal(m.str(' سلام ', 'نام'), 'سلام')
  assert.equal(m.str(12345, 'شماره'), '12345')
  assert.equal(m.str('', 'نام', { optional: true }), '')
  assert.equal(err(() => m.str('', 'نام')).message, '«نام» الزامی است')
  assert.equal(err(() => m.str('a', 'نام', { min: 2 })).message, '«نام» باید حداقل 2 نویسه باشد')
  assert.equal(err(() => m.str('abcdef', 'نام', { max: 3 })).message, '«نام» بیش از حد طولانی است')
  assert.equal(err(() => m.str('', 'نام')).status, 400)
  assert.equal(err(() => m.str('', 'نام')).code, 'validation')
  assert.equal(m.int('42', 'تعداد'), 42)
  assert.equal(m.int('', 'تعداد', { optional: true }), null)
  assert.equal(err(() => m.int('2.5', 'تعداد')).message, '«تعداد» باید عدد صحیح باشد')
  assert.equal(err(() => m.int('abc', 'تعداد')).message, '«تعداد» باید عدد صحیح باشد')
  assert.equal(err(() => m.int(null, 'تعداد')).message, '«تعداد» الزامی است')
  assert.equal(err(() => m.int(0, 'تعداد', { min: 1 })).message, '«تعداد» نباید کمتر از 1 باشد')
  assert.equal(err(() => m.int(9, 'تعداد', { max: 5 })).message, '«تعداد» نباید بیشتر از 5 باشد')
  assert.equal(m.oneOf('b', ['a', 'b'], 'نوع'), 'b')
  assert.equal(m.oneOf('', ['a', 'b'], 'نوع', 'a'), 'a')
  assert.equal(err(() => m.oneOf('z', ['a', 'b'], 'نوع')).message, 'مقدار «نوع» نامعتبر است')
  const shape = { title: m.v.str('عنوان', { max: 10 }), count: m.v.int('تعداد', { min: 1 }), kind: m.v.oneOf(['a', 'b'], 'نوع', 'a'), ok: m.v.bool('تأیید') }
  assert.deepEqual(m.parseInput({ title: ' x ', count: '3', ok: 'on', extra: 1 }, shape), { title: 'x', count: 3, kind: 'a', ok: true })
  const e = err(() => m.parseInput({ count: 0, kind: 'q' }, shape))
  assert.equal(e.status, 400)
  assert.equal(e.message, '«عنوان» الزامی است')
  assert.deepEqual(e.details.fields, { title: '«عنوان» الزامی است', count: '«تعداد» نباید کمتر از 1 باشد', kind: 'مقدار «نوع» نامعتبر است' })
  assert.equal(err(() => m.parseInput({ a: 5 }, { a: m.v.list(m.v.str('برچسب'), 'برچسب‌ها', 3) })).details.fields.a, 'مقدار «برچسب‌ها» نامعتبر است')
  assert.equal(err(() => m.parseInput({ a: ['1', '2', '3', '4'] }, { a: m.v.list(m.v.str('برچسب'), 'برچسب‌ها', 3) })).message, '«برچسب‌ها» حداکثر 3 مورد می‌پذیرد')
  assert.equal(m.v.str('عنوان'), m.v.str('عنوان'), 'field schemas are memoised')
})

// ROADMAP phase 18: presentation-grade XLSX — structure is asserted on the raw OOXML parts (stored ZIP ⇒ readable)
const unzipStored = (bytes) => {
  // walks the central directory, so it also reads streamed entries (sizes only in the data descriptor)
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let e = bytes.length - 22
  while (dv.getUint32(e, true) !== 0x06054b50) e--
  const count = dv.getUint16(e + 10, true)
  let p = dv.getUint32(e + 16, true)
  const files = {}
  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50)
    const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nl))
    const ln = dv.getUint16(off + 26, true), lx = dv.getUint16(off + 28, true)
    const data = bytes.subarray(off + 30 + ln + lx, off + 30 + ln + lx + size)
    assert.equal(m.crc32(data), crc, `crc ${name}`)
    files[name] = new TextDecoder().decode(data)
    p += 46 + nl + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true)
  }
  return files
}
const SHEET_COLS = [{ key: 'name', label: 'نام و نام خانوادگی' }, { key: 'n', label: 'تعداد', type: 'number', total: 'sum' }, { key: 'd', label: 'تاریخ', type: 'date' }, { key: 'note', label: 'توضیح' }]
const SHEET_ROWS = Array.from({ length: 30 }, (_, i) => ({ name: 'کاربر ' + i, n: i, d: '2026-10-01', note: i === 2 ? 'متن طولانی '.repeat(20) : '=HYPERLINK("x")' }))
t('sheet: xlsx has widths, wrapped rows, frozen bold header, autofilter, RTL, Jalali, SUBTOTAL totals, print setup', () => {
  const f = unzipStored(m.buildTableXlsx(SHEET_COLS, SHEET_ROWS, { title: 'گزارش', subtitle: 'فیلتر: همه', sheetName: 'افراد', paper: 'A3', orientation: 'landscape' }))
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) assert.ok(f[part], part)
  const s = f['xl/worksheets/sheet1.xml']
  const widths = [...s.matchAll(/<col min="(\d+)" max="\d+" width="(\d+)"/g)].map((x) => +x[2])
  assert.equal(widths.length, 4)
  assert.ok(widths[3] === 50 && widths[0] > widths[1], `widths follow content, long text capped: ${widths}`)
  assert.ok(s.includes('rightToLeft="1"'), 'RTL sheet')
  assert.ok(s.includes('<pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/>'), 'header frozen below title+subtitle')
  assert.ok(s.includes('<autoFilter ref="A3:D33"/>'), 'autofilter over header + data')
  assert.match(s, /<row r="3"><c r="A3" s="1" t="inlineStr">/, 'header row uses the bold header style')
  assert.match(s, /<row r="6" ht="\d+" customHeight="1">/, 'long text row gets a taller wrapped height')
  assert.ok(s.includes('۱۴۰۵/۰۷/۰۹'), 'ISO date written as Jalali')
  assert.ok(s.includes('<f>SUBTOTAL(109,B4:B33)</f><v>435</v>'), 'totals row follows Excel filtering, cached value present')
  assert.ok(s.includes('جمع (۳۰ ردیف)'))
  assert.ok(s.includes('<pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'), 'A3 landscape, fit to width')
  assert.ok(s.includes('<mergeCell ref="A1:D1"/>') && s.includes('&amp;P از &amp;N'), 'title merged, page x of y footer')
  const wb = f['xl/workbook.xml']
  assert.ok(wb.includes(`<definedName name="_xlnm.Print_Titles" localSheetId="0">'افراد'!$3:$3</definedName>`), 'header row repeats on every printed page')
  assert.ok(wb.includes(`'افراد'!$A$3:$D$33`), 'filter database name')
  assert.ok(f['xl/styles.xml'].includes('wrapText="1"') && f['xl/styles.xml'].includes('readingOrder="2"'))
})
t('sheet: streamed xlsx equals the in-memory sheet; CSV has BOM and neutralises formulas', async () => {})
{
  const chunks = []
  let i = 0
  const done = await m.streamTableXlsx(SHEET_COLS, { title: 'گزارش', subtitle: 'فیلتر: همه', sheetName: 'افراد' }, async () => (i < 3 ? SHEET_ROWS.slice(i++ * 10, i * 10) : []), (c) => chunks.push(c))
  assert.equal(done, 30)
  const streamed = unzipStored(new Uint8Array(Buffer.concat(chunks.map((c) => Buffer.from(c)))))
  const mem = unzipStored(m.buildTableXlsx(SHEET_COLS, SHEET_ROWS, { title: 'گزارش', subtitle: 'فیلتر: همه', sheetName: 'افراد' }))
  assert.equal(streamed['xl/worksheets/sheet1.xml'], mem['xl/worksheets/sheet1.xml'])
  assert.equal(streamed['xl/workbook.xml'], mem['xl/workbook.xml'])
  const csv = m.buildCsv(SHEET_COLS, SHEET_ROWS.slice(0, 2))
  assert.ok(csv.startsWith('\ufeffنام و نام خانوادگی,تعداد,تاریخ,توضیح\r\n'))
  assert.ok(csv.includes(`کاربر 0,0,۱۴۰۵/۰۷/۰۹,"'=HYPERLINK(""x"")"`), 'formula-looking text is prefixed and quoted')
  assert.equal(m.csvField('-5'), '-5')
  assert.equal(m.csvField('-abc'), `"'-abc"`)
  assert.equal(m.jalaliCell('2026-03-21'), '۱۴۰۵/۰۱/۰۱')
}

// ROADMAP phase 18: one table model for screen, URL and export
const TCOLS = [
  { key: 'name', label: 'نام' },
  { key: 'gender', label: 'جنسیت', labels: { male: 'مرد', female: 'زن' }, filter: 'select', groupable: true },
  { key: 'pubs', label: 'نشریات', list: true, filter: 'select' },
  { key: 'year', label: 'سال ورود', type: 'number', filter: 'number' },
  { key: 'joined', label: 'تاریخ عضویت', type: 'date', filter: 'date' },
  { key: 'note', label: 'یادداشت', hidden: true }
]
const TROWS = [
  { name: 'علی رضایی', gender: 'male', pubs: 'نشریه الف، نشریه ب', year: 1401, joined: '2025-10-01', note: 'x' },
  { name: 'زهرا كريمي', gender: 'female', pubs: 'نشریه ب', year: 1400, joined: '2024-02-10' },
  { name: 'مریم احمدی', gender: 'female', pubs: 'نشریه ج', year: 1402, joined: null },
  { name: 'رضا ۱۲۳', gender: null, pubs: '', year: null, joined: '2026-01-05' }
]
t('table: URL state round-trips; filters, Persian search, sort and grouping match the screen', () => {
  const st = m.parseTableState(new URLSearchParams('dt_q=كريمي&dt_sort=year.desc&dt_group=gender&dt_cols=name,year,bogus&dt_f_gender=female,male&dt_f_year=1400~&dt_f_joined=~2025-12-31&dt_f_bogus=1'), TCOLS)
  assert.deepEqual(st.cols, ['name', 'year'], 'unknown columns dropped')
  assert.deepEqual(st.filters, { gender: ['female', 'male'], year: { from: '1400' }, joined: { to: '2025-12-31' } })
  assert.deepEqual(m.parseTableState(m.tableStateToParams(st), TCOLS), st, 'params ⇄ state')
  // search is Persian-normalised (ك/ي ⇒ ک/ی) and digit-insensitive; it only looks at the visible columns
  const all = { q: '', sort: null, group: null, cols: null, filters: {} }
  assert.deepEqual(m.applyTable(TROWS, TCOLS, { ...all, q: 'کریمی' }).map((r) => r.name), ['زهرا كريمي'])
  assert.deepEqual(m.applyTable(TROWS, TCOLS, { ...all, q: '123' }).map((r) => r.name), ['رضا ۱۲۳'])
  assert.equal(m.applyTable(TROWS, TCOLS, { ...all, q: 'x' }).length, 0, 'hidden column not searched')
  assert.deepEqual(m.applyTable(TROWS, TCOLS, { ...all, q: 'زن' }).map((r) => r.name), ['زهرا كريمي', 'مریم احمدی'], 'labels searched')
  // list column: any contained value; number/date ranges inclusive, empty cells excluded
  assert.deepEqual(m.applyTable(TROWS, TCOLS, { ...all, filters: { pubs: ['نشریه ب'] } }).map((r) => r.name), ['علی رضایی', 'زهرا كريمي'])
  assert.deepEqual(m.applyTable(TROWS, TCOLS, { ...all, filters: { year: { from: '۱۴۰۱' } } }).map((r) => r.year), [1401, 1402])
  assert.deepEqual(m.applyTable(TROWS, TCOLS, { ...all, filters: { joined: { from: '2025-01-01', to: '2026-01-05' } } }).map((r) => r.name), ['علی رضایی', 'رضا ۱۲۳'])
  // sort: empties last in both directions; stable
  assert.deepEqual(m.applyTable(TROWS, TCOLS, { ...all, sort: { key: 'year', dir: 'desc' } }).map((r) => r.year), [1402, 1401, 1400, null])
  assert.deepEqual(m.applyTable(TROWS, TCOLS, { ...all, sort: { key: 'year', dir: 'asc' } }).map((r) => r.year), [1400, 1401, 1402, null])
  // group by label (ascending, «—» last), sort inside each group
  const gs = { ...all, group: 'gender', sort: { key: 'year', dir: 'asc' } }
  const rows = m.applyTable(TROWS, TCOLS, gs)
  assert.deepEqual(m.groupRows(rows, TCOLS, gs).map((g) => [g.label, g.rows.map((r) => r.year)]), [['زن', [1400, 1402]], ['مرد', [1401]], ['—', [null]]])
  // export: group column first, labels applied, lists joined; description lists every active choice
  const ec = m.exportColumns(TCOLS, { ...gs, cols: ['name', 'pubs'] })
  assert.deepEqual(ec.map((c) => c.key), ['gender', 'name', 'pubs'])
  assert.deepEqual(m.exportRow(ec, TROWS[0]), { gender: 'مرد', name: 'علی رضایی', pubs: 'نشریه الف، نشریه ب' })
  assert.equal(m.toSheetColumns(ec)[0].type, 'text')
  assert.equal(m.describeState(TCOLS, st), 'جنسیت: زن، مرد · سال ورود: 1400 تا … · تاریخ عضویت: … تا 2025-12-31 · جست‌وجو: «كريمي» · گروه‌بندی: جنسیت · مرتب‌سازی: سال ورود (نزولی)')
})

t('tenancy: config validation, host resolution, per-tenant secret', () => {
  const cfg = m.parseTenantConfig({ tenants: [{ slug: 'ut', name: 'دانشگاه تهران', hosts: ['Nashriyar.UT.ac.ir', 'ut.localhost'] }, { slug: 'sharif', hosts: ['nashriyar.sharif.edu'] }], default: 'ut' })
  assert.deepEqual(cfg.tenants[0].hosts, ['nashriyar.ut.ac.ir', 'ut.localhost'])
  assert.equal(cfg.tenants[1].name, 'sharif')
  assert.equal(m.resolveTenant(cfg, 'NASHRIYAR.SHARIF.EDU:443').slug, 'sharif')
  assert.equal(m.resolveTenant(cfg, 'ut.localhost:3000').slug, 'ut')
  assert.equal(m.resolveTenant(cfg, '10.0.0.5').slug, 'ut') // default
  assert.equal(m.resolveTenant({ tenants: cfg.tenants }, 'evil.example'), null) // no default -> 404
  assert.equal(m.normalizeHost('[::1]:3000'), '[::1]')
  assert.equal(m.normalizeHost('a.b.'), 'a.b')
  assert.equal(m.parseTenantConfig([{ slug: 'x1', host: 'x.ir' }]).tenants[0].hosts[0], 'x.ir') // array shorthand + single host
  assert.throws(() => m.parseTenantConfig({ tenants: [{ slug: 'Bad Slug', hosts: ['a.ir'] }] }), /invalid slug/)
  assert.throws(() => m.parseTenantConfig({ tenants: [{ slug: 'aa', hosts: ['a.ir'] }, { slug: 'aa', hosts: ['b.ir'] }] }), /duplicate slug/)
  assert.throws(() => m.parseTenantConfig({ tenants: [{ slug: 'aa', hosts: ['a.ir'] }, { slug: 'bb', hosts: ['A.ir'] }] }), /assigned twice/)
  assert.throws(() => m.parseTenantConfig({ tenants: [{ slug: 'aa', hosts: [] }] }), /at least one host/)
  assert.throws(() => m.parseTenantConfig({ tenants: [{ slug: 'aa', hosts: ['a b.ir'] }] }), /invalid host/)
  assert.throws(() => m.parseTenantConfig({ tenants: [{ slug: 'aa', hosts: ['a.ir'] }], default: 'zz' }), /default/)
  assert.throws(() => m.parseTenantConfig({}), /expected/)
  assert.equal(m.tenantSecret(undefined, 'ut'), undefined)
  assert.equal(m.tenantSecret('short', 'ut'), undefined)
  assert.notEqual(m.tenantSecret('0123456789abcdef', 'ut'), m.tenantSecret('0123456789abcdef', 'sharif'))
})

console.log(`unit: ${n} passed`)

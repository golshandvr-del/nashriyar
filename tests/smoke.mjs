// Smoke test: hits every GET API route with the relevant role and checks status codes + key invariants.
// Usage: BASE=http://localhost:3000 node tests/smoke.mjs   (server must be running with seeded demo data)
const BASE = process.env.BASE || 'http://localhost:3000'
let failures = 0
const ok = (cond, msg) => {
  if (!cond) {
    failures++
    console.log('FAIL', msg)
  }
}

function client() {
  let cookie = ''
  return async function call(path, opts = {}) {
    const headers = { Origin: BASE, ...(opts.json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }
    const res = await fetch(BASE + path, { method: opts.method || (opts.json !== undefined ? 'POST' : 'GET'), headers, body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body, redirect: 'manual' })
    const sc = res.headers.get('set-cookie')
    if (sc && sc.includes('nsh_sid=')) cookie = sc.split(';')[0]
    const ct = res.headers.get('content-type') || ''
    const data = ct.includes('json') ? await res.json().catch(() => null) : await res.arrayBuffer()
    return { status: res.status, data, ct, headers: res.headers }
  }
}

async function login(username, password) {
  const c = client()
  const r = await c('/api/auth/login', { json: { username, password } })
  ok(r.status === 200, `login ${username} -> ${r.status} ${JSON.stringify(r.data)}`)
  return c
}

async function expect(c, path, status = 200, label = '') {
  const r = await c(path)
  ok(r.status === status, `${label} GET ${path} -> ${r.status} (expected ${status}) ${r.ct.includes('json') ? JSON.stringify(r.data).slice(0, 200) : ''}`)
  return r.data
}

const noFollowers = (obj, where) => {
  const s = JSON.stringify(obj)
  ok(!/follower/i.test(s), `${where}: response must never contain follower data`)
}

const anon = client()
// ───── public ─────
const home = await expect(anon, '/api/public/home')
noFollowers(home, 'public/home')
const issue = home.latest[0]
await expect(anon, '/api/public/categories')
const cats = (await anon('/api/public/categories')).data
await expect(anon, `/api/public/categories/${cats.categories[0].slug}`)
await expect(anon, `/api/public/faculties/${cats.faculties[0].id}`)
await expect(anon, '/api/public/publications')
const pub = await expect(anon, `/api/public/publications/${issue.publication_slug}`)
noFollowers(pub, 'public/publication')
await expect(anon, `/api/public/publications/${issue.publication_slug}/posts`)
const iss = await expect(anon, `/api/public/issues/${issue.id}`)
noFollowers(iss, 'public/issue')
const explore = await expect(anon, '/api/public/explore')
noFollowers(explore, 'public/explore')
const firstPost = (explore.posts || explore.items || [])[0]
if (firstPost) await expect(anon, `/api/public/posts/${firstPost.id}`)
await expect(anon, '/api/public/stories')
await expect(anon, '/api/public/search?q=' + encodeURIComponent('شماره'))
await expect(anon, '/api/public/settings')
await expect(anon, '/api/public/recruitment')
await expect(anon, '/api/public/certificates/NOPE', 404)
await expect(anon, '/api/me/library', 401, 'anon')
await expect(anon, '/api/admin/overview', 401, 'anon')
// media: covers of published issues are public
const cover = await anon('/api/media/k/' + issue.cover_key)
ok(cover.status === 200 && cover.ct.includes('svg'), 'public cover served')
// reader: free issue readable without login (client decision #2)
const freeIssue = home.free[0]
if (freeIssue) {
  const man = await expect(anon, `/api/reader/${freeIssue.id}/manifest`)
  ok(man.full === true && man.pages.length === man.allowed, 'free issue fully readable anonymously')
  const pg = await anon(man.pages[0].url)
  ok(pg.status === 200, 'signed page url works')
  const bad = await anon(man.pages[0].url.replace(/s=[^&]+/, 's=deadbeef'))
  ok(bad.status === 403, 'tampered page signature rejected')
  ok((await anon(`/api/reader/${freeIssue.id}/page/1`)).status === 403, 'unsigned page url rejected')
}

// ───── student ─────
const st = await login('40012345', 'student1234')
for (const p of ['/api/auth/me', '/api/auth/sessions', '/api/me/library', '/api/me/feed', '/api/me/follows', '/api/me/saved', '/api/me/comments', '/api/me/notifications', '/api/me/profile']) await expect(st, p, 200, 'student')
await expect(st, '/api/admin/overview', 403, 'student')
await expect(st, '/api/analytics/summary', 403, 'student')
const redeem = await st('/api/me/codes/redeem', { json: { code: 'NSH-DEMO-2026' } })
ok(redeem.status === 200, `student redeem demo code -> ${redeem.status} ${JSON.stringify(redeem.data)}`)
const again = await st('/api/me/codes/redeem', { json: { code: 'NSH-DEMO-2026' } })
ok(again.status >= 400, 'one-time code cannot be redeemed twice')

// ───── team (publication 1) ─────
const tm = await login('pub1-director', 'team1234')
const my = await expect(tm, '/api/team/my')
const pubId = my.publications[0].publication_id
for (const p of ['dashboard', 'activity', 'codes', 'comments', 'issues', 'keywords', 'members', 'physical-sales', 'posts', 'recruitment', 'search-issues?q=a', 'stats']) {
  const d = await expect(tm, `/api/team/${pubId}/${p}`, 200, 'team')
  noFollowers(d, 'team/' + p)
}
const tIssues = (await tm(`/api/team/${pubId}/issues`)).data.issues
await expect(tm, `/api/team/${pubId}/issues/${tIssues[0].id}`)
await expect(tm, `/api/media/pages/${tIssues[0].id}/status`)
const members = (await tm(`/api/team/${pubId}/members`)).data
const m0 = (members.members || [])[0]
if (m0) await expect(tm, `/api/team/${pubId}/members/${m0.id}`)
await expect(tm, `/api/admin/overview`, 403, 'team')
// purchase-code concurrency (ROADMAP phase 5 acceptance): two simultaneous redemptions of one code → exactly one succeeds
const paidIssue = tIssues.find((i) => i.status === 'published' && i.pricing === 'paid')
if (paidIssue) {
  const made = await tm(`/api/team/${pubId}/codes`, { json: { issue_id: paidIssue.id, count: 1, ttl_hours: 1 } })
  ok(made.status === 200 && made.data.codes?.length === 1, `team creates purchase code -> ${made.status}`)
  const code = made.data.codes?.[0]
  if (code) {
    const [r1, r2] = await Promise.all([st('/api/me/codes/redeem', { json: { code } }), st('/api/me/codes/redeem', { json: { code } })])
    ok([r1.status, r2.status].filter((x) => x === 200).length === 1, `concurrent redeem: exactly one success (${r1.status}, ${r2.status})`)
  }
}
// another publication's panel must be forbidden
const other = (await anon('/api/public/publications')).data
const otherPub = (other.publications || other.items || []).find((p) => p.id !== pubId)
if (otherPub) await expect(tm, `/api/team/${otherPub.id}/dashboard`, 403, 'team cross-publication')

// ───── officer ─────
const of = await login('officer', 'officer1234')
for (const p of ['announcements', 'approvals', 'audit', 'categories', 'comments', 'deadlines', 'overview', 'people', 'posts', 'publications', 'reports', 'settings', 'shelves', 'structure', 'team-users', 'users']) await expect(of, `/api/admin/${p}`, 200, 'officer')
await expect(of, `/api/admin/publications/${pubId}`)
await expect(of, `/api/admin/publications/${pubId}/followers`)
await expect(of, `/api/admin/issues/${tIssues[0].id}`)
const people = (await of('/api/admin/people')).data
const person = (people.people || people.items || [])[0]
if (person) await expect(of, `/api/admin/people/${encodeURIComponent(person.key || person.student_number || person.id)}`)
for (const p of ['directors', 'explore', 'gaps', 'insights', 'live', 'production', 'ranking', 'sales', 'summary', 'trends']) await expect(of, `/api/analytics/${p}`, 200, 'officer analytics')
const csv = await of('/api/analytics/export/ranking.csv')
ok(csv.status === 200, 'ranking csv export')

// ───── faculty supervisor (scoped) & analyst ─────
const sup = await login('supervisor', 'super1234')
await expect(sup, '/api/analytics/summary', 200, 'supervisor')
const an = await login('analyst', 'analyst1234')
await expect(an, '/api/analytics/ranking', 200, 'analyst')

// ───── ROADMAP phase 17: academic-year dimension + read-only yearly archive ─────
{
  const ys = await expect(of, '/api/analytics/academic-years', 200, 'academic years')
  ok(Array.isArray(ys?.years) && ys.years.filter((y) => y.current).length === 1, 'academic-years: exactly one current year')
  const cur = ys.years.find((y) => y.current)
  const prev = ys.years.find((y) => !y.current)
  // ?acad= cuts every report to Mehr → Shahrivar (capped at today for the running year)
  const sAcad = await expect(of, `/api/analytics/summary?acad=${cur.year}`, 200, 'summary ?acad')
  ok(sAcad?.from === cur.from, `summary ?acad from=${sAcad?.from} expected ${cur.from}`)
  await expect(of, `/api/analytics/ranking?acad=${prev.year}`, 200, 'ranking ?acad')
  // the running year cannot be archived; a finished year freezes once and is then served unchanged
  await expect(of, `/api/analytics/archive/${cur.year}`, 409, 'archive of the running year')
  await expect(of, '/api/analytics/archive/abc', 400, 'archive bad year')
  const a1 = await expect(of, `/api/analytics/archive/${prev.year}`, 200, 'archive finished year')
  const a2 = await expect(of, `/api/analytics/archive/${prev.year}`, 200, 'archive finished year (again)')
  ok(a1?.read_only === true && a1?.archived_at && a1.archived_at === a2?.archived_at, 'archive: frozen once (same archived_at)')
  ok(JSON.stringify(a1?.totals) === JSON.stringify(a2?.totals), 'archive: totals unchanged on re-read')
  const ys2 = await expect(of, '/api/analytics/academic-years', 200, 'academic years after archive')
  ok(ys2.years.find((y) => y.year === prev.year)?.archived === true, 'academic-years: finished year flagged archived')
  // faculty supervisor sees only own-faculty rows
  const as = await expect(sup, `/api/analytics/archive/${prev.year}`, 200, 'supervisor archive')
  ok((as?.byFaculty || []).length <= 1, 'archive: supervisor sees a single faculty')
  ok((as?.totals?.pages ?? 0) <= (a1?.totals?.pages ?? 0), 'archive: supervisor totals within org totals')
  await expect(st, '/api/analytics/academic-years', 403, 'student academic years')
}

// ───── ROADMAP phase 17: keyset (cursor) pagination on list endpoints ─────
{
  // walk every page with a small limit: no duplicates, page sizes respected, union equals the single big page
  async function walk(c, path, key, limit = 3, maxPages = 400) {
    const seen = []
    let cursor = null
    for (let i = 0; i < maxPages; i++) {
      const sep = path.includes('?') ? '&' : '?'
      const r = await c(`${path}${sep}limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`)
      ok(r.status === 200, `paginate ${path} page ${i} -> ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`)
      if (r.status !== 200) return seen
      const rows = r.data[key] || []
      ok(rows.length <= limit, `paginate ${path}: page size ${rows.length} <= ${limit}`)
      seen.push(...rows)
      cursor = r.data.next_cursor
      if (!cursor) return seen
      ok(rows.length === limit, `paginate ${path}: a non-final page is full`)
    }
    return seen
  }
  const idOf = (x) => x.id ?? x.person_key
  const cases = [
    [of, '/api/admin/audit', 'items'],
    [of, '/api/admin/users', 'users'],
    [of, '/api/admin/people', 'people'],
    [of, '/api/admin/posts', 'posts'],
    [of, '/api/admin/reports', 'reports'],
    [of, '/api/admin/comments?status=approved', 'comments'],
    [tm, `/api/team/${pubId}/issues`, 'issues'],
    [tm, `/api/team/${pubId}/codes`, 'codes'],
    [tm, `/api/team/${pubId}/activity`, 'items'],
    [tm, `/api/team/${pubId}/physical-sales`, 'sales'],
    [tm, `/api/team/${pubId}/comments?status=approved`, 'comments']
  ]
  for (const [c, path, key] of cases) {
    const all = (await c(path)).data?.[key] || []
    const paged = await walk(c, path, key)
    const ids = paged.map(idOf)
    ok(new Set(ids).size === ids.length, `paginate ${path}: no duplicates across pages`)
    // the first page of the default request is a prefix of the walk, in the same order
    const n = Math.min(all.length, ids.length)
    ok(all.slice(0, n).map(idOf).join() === ids.slice(0, n).join(), `paginate ${path}: same order as the unpaged list`)
    if (all.length < 200) ok(ids.length === all.length, `paginate ${path}: walk covers every row (${ids.length} vs ${all.length})`)
  }
  const badCur = await of('/api/admin/audit?cursor=%%%not-a-cursor')
  ok(badCur.status === 400 && badCur.data?.code === 'bad_cursor', `invalid cursor -> 400 bad_cursor (${badCur.status})`)
  const big = await of('/api/admin/audit?limit=100000')
  ok(big.status === 200 && big.data.items.length <= 300, 'limit is clamped to the endpoint maximum')
}

// ───── ROADMAP phase 17: API versioning — /api/v1/* is the same contract as /api/* ─────
{
  for (const p of ['/api/health', '/api/public/home', '/api/maintenance']) {
    const a = await fetch(BASE + p)
    const b = await fetch(BASE + p.replace('/api/', '/api/v1/'))
    ok(a.status === 200 && b.status === 200, `v1 alias ${p} -> ${a.status}/${b.status}`)
    ok(b.headers.get('x-api-version') === '1' && a.headers.get('x-api-version') === '1', `X-API-Version: 1 on ${p}`)
  }
  const pa = await (await fetch(BASE + '/api/public/home')).json()
  const pb = await (await fetch(BASE + '/api/v1/public/home')).json()
  ok(JSON.stringify(Object.keys(pa).sort()) === JSON.stringify(Object.keys(pb).sort()), 'v1 alias returns the same response shape')
  const u1 = await fetch(BASE + '/api/v1/admin/users')
  ok(u1.status === 401, `v1 alias keeps auth (${u1.status})`)
  const v1auth = await of('/api/v1/admin/users?limit=2')
  ok(v1auth.status === 200 && Array.isArray(v1auth.data.users), 'v1 alias works for a signed-in officer')
  const n1 = await fetch(BASE + '/api/v1/__nope__')
  ok(n1.status === 404, `unknown v1 path -> 404 (${n1.status})`)
}

// ───── ROADMAP phase 17: targeted analytics-cache invalidation ─────
{
  const xc = async (p) => (await of(p)).headers.get('x-cache') || 'miss'
  await of('/api/analytics/forecast'); await of('/api/analytics/sales')
  ok((await xc('/api/analytics/forecast')) === 'hit' && (await xc('/api/analytics/sales')) === 'hit', 'analytics reports are cached after the first read')
  const iss = (await tm(`/api/team/${pubId}/issues?limit=1`)).data.issues[0]
  const sale = await tm(`/api/team/${pubId}/physical-sales`, { json: { issue_id: iss.id, quantity: 1 } })
  ok(sale.status === 200, `record a physical sale -> ${sale.status}`)
  ok((await xc('/api/analytics/sales')) === 'miss', 'a sale invalidates the sales report')
  ok((await xc('/api/analytics/forecast')) === 'hit', 'a sale does NOT invalidate the (content-only) forecast report')
  const v1 = await of('/api/v1/analytics/forecast')
  ok(v1.headers.get('x-cache') === 'hit', 'the /api/v1 alias shares the same cache entry')
  if (sale.data?.id) await tm(`/api/team/${pubId}/physical-sales/${sale.data.id}`, { method: 'DELETE' })
}

// ───── ROADMAP phase 17: request id on every response and in every error body ─────
{
  const h = await fetch(BASE + '/api/health')
  ok(/^[\w.:-]{8,64}$/.test(h.headers.get('x-request-id') || ''), 'X-Request-Id header on /api/health')
  const e401 = await fetch(BASE + '/api/admin/users')
  const b401 = await e401.json()
  ok(e401.status === 401 && b401.request_id && b401.request_id === e401.headers.get('x-request-id'), `401 body request_id matches header ${JSON.stringify(b401)}`)
  const e404 = await fetch(BASE + '/api/__nope__', { headers: { 'X-Request-Id': 'smoke-req-0001' } })
  const b404 = await e404.json()
  ok(e404.status === 404 && b404.request_id === 'smoke-req-0001' && b404.code === 'not_found', `404 keeps a sane incoming X-Request-Id ${JSON.stringify(b404)}`)
  const bad = await fetch(BASE + '/api/health', { headers: { 'X-Request-Id': 'bad id <script>' } })
  ok(bad.headers.get('x-request-id') !== 'bad id <script>', 'an unsafe incoming X-Request-Id is replaced')
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL SMOKE CHECKS PASSED')
process.exit(failures ? 1 : 0)

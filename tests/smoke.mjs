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
    return { status: res.status, data, ct }
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

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL SMOKE CHECKS PASSED')
process.exit(failures ? 1 : 0)

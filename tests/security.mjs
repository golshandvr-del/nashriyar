// Security test suite (ROADMAP phase 9): IDOR, CSRF, XSS, rate limiting, follower leakage,
// access to the original PDF, purchase-code reuse, signed reader URLs, session cookie flags.
// Usage: BASE=http://localhost:3000 node tests/security.mjs   (server running with seeded demo data)
const BASE = process.env.BASE || 'http://localhost:3000'
let failures = 0
let passed = 0
const ok = (cond, msg) => {
  if (cond) passed++
  else {
    failures++
    console.log('FAIL', msg)
  }
}

function client(origin = BASE) {
  let cookie = ''
  const call = async (path, opts = {}) => {
    const headers = { ...(origin ? { Origin: origin } : {}), ...(opts.json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) }
    const res = await fetch(BASE + path, { method: opts.method || (opts.json !== undefined || opts.form ? 'POST' : 'GET'), headers, body: opts.form || (opts.json !== undefined ? JSON.stringify(opts.json) : undefined) })
    const sc = res.headers.get('set-cookie')
    if (sc && sc.includes('nsh_sid=')) cookie = sc.split(';')[0]
    const ct = res.headers.get('content-type') || ''
    const data = ct.includes('json') ? await res.json().catch(() => null) : await res.text()
    return { status: res.status, data, ct, headers: res.headers, setCookie: sc }
  }
  call.cookie = () => cookie
  call.setCookie = (c) => (cookie = c)
  return call
}

async function login(username, password) {
  const c = client()
  const r = await c('/api/auth/login', { json: { username, password } })
  ok(r.status === 200, `login ${username} -> ${r.status}`)
  return { c, r }
}

const anon = client()
const { c: st, r: stLogin } = await login('40012345', 'student1234')
const { c: tm } = await login('pub1-director', 'team1234')
const { c: of } = await login('officer', 'officer1234')

// ───── session cookie flags ─────
const sc = stLogin.setCookie || ''
ok(/HttpOnly/i.test(sc), 'session cookie is HttpOnly')
ok(/SameSite=Lax|SameSite=Strict/i.test(sc), 'session cookie has SameSite')

// ───── security headers ─────
const home = await anon('/')
ok(/default-src 'self'/.test(home.headers.get('content-security-policy') || ''), 'CSP header on HTML')
ok(/frame-ancestors 'none'/.test(home.headers.get('content-security-policy') || ''), 'CSP forbids framing')
ok(home.headers.get('x-content-type-options') === 'nosniff', 'nosniff header')
ok(home.headers.get('x-frame-options') === 'DENY', 'X-Frame-Options DENY')

// ───── CSRF: cross-origin state change is rejected even with a valid session ─────
const evil = client('https://evil.example')
evil.setCookie(st.cookie())
const csrf = await evil('/api/me/follows/x', { json: {} })
ok(csrf.status === 403 && csrf.data?.code === 'csrf', `cross-origin POST rejected (csrf) -> ${csrf.status}`)
const csrfRef = await (async () => {
  const c = client(null)
  c.setCookie(st.cookie())
  return c('/api/me/notifications/read-all', { json: {}, headers: { Referer: 'https://evil.example/page' } })
})()
ok(csrfRef.status === 403, `cross-origin Referer POST rejected -> ${csrfRef.status}`)

// ───── authentication & role boundaries ─────
ok((await anon('/api/me/library')).status === 401, 'anonymous -> /api/me 401')
ok((await anon('/api/team/my')).status === 401, 'anonymous -> /api/team 401')
ok((await anon('/api/admin/overview')).status === 401 || (await anon('/api/admin/overview')).status === 403, 'anonymous -> /api/admin denied')
ok((await st('/api/admin/people')).status === 403, 'student -> admin people 403')
ok((await st('/api/analytics/ranking')).status === 403, 'student -> analytics 403')
ok((await tm('/api/admin/settings')).status === 403, 'team -> admin settings 403')
ok((await of('/api/admin/settings', { json: { feature_flags: { explore: false } } })).status === 200, 'officer may save settings')
const flags = (await anon('/api/public/settings')).data?.features || {}
ok(flags.explore !== false, 'officer cannot change feature flags (super admin only)')

// ───── IDOR: team of publication 1 against another publication ─────
const my = (await tm('/api/team/my')).data
const pubId = my.publications[0].publication_id
const pubs = (await anon('/api/public/publications')).data
const otherPub = (pubs.publications || pubs.items || []).find((p) => p.id !== pubId)
ok(!!otherPub, 'found another publication')
if (otherPub) {
  ok((await tm(`/api/team/${otherPub.id}/members`)).status === 403, 'IDOR: read other team members 403')
  ok((await tm(`/api/team/${otherPub.id}/members`, { json: { full_name: 'نفوذی' } })).status === 403, 'IDOR: add member to other team 403')
  ok((await tm(`/api/team/${otherPub.id}/codes`, { json: { issue_id: 'x', count: 1 } })).status === 403, 'IDOR: mint codes for other publication 403')
  ok((await tm(`/api/team/${otherPub.id}/stats`)).status === 403, 'IDOR: other publication stats 403')
  // an issue of another publication addressed through our own publication id
  const otherIssues = (await of(`/api/admin/publications/${otherPub.id}`)).data?.issues || []
  if (otherIssues[0]) {
    const r = await tm(`/api/team/${pubId}/issues/${otherIssues[0].id}`)
    ok(r.status === 404 || r.status === 403, `IDOR: other publication's issue via own pub id -> ${r.status}`)
  }
}

// ───── follower counts never leak publicly ─────
const pubPage = await anon(`/api/public/publications/${(pubs.publications || pubs.items)[0].slug}`)
ok(pubPage.status === 200 && !/follower/i.test(JSON.stringify(pubPage.data)), 'public publication page has no follower data')
ok(!/follower/i.test(JSON.stringify((await anon('/api/public/explore')).data)), 'explore has no follower data')
ok(!/follower/i.test(JSON.stringify((await st('/api/me/follows')).data)), 'my follows has no follower counts')

// ───── XSS: stored comment is kept as text and only ever served as JSON ─────
const posts = (await anon('/api/public/explore')).data.posts || []
if (posts[0]) {
  const payload = '<img src=x onerror=alert(1)><script>alert(2)</script>'
  const r = await st(`/api/me/posts/${posts[0].id}/comments`, { json: { body: payload } })
  ok(r.status === 200 || r.status === 429, `comment accepted for moderation -> ${r.status}`)
  const mine = await st('/api/me/comments')
  ok(mine.ct.includes('application/json'), 'comment API responds with JSON content-type')
  // stored verbatim as data inside JSON (React renders it as text, CSP blocks inline script anyway)
  ok(!mine.ct.includes('text/html'), 'comment API never serves HTML')
  ok(typeof mine.data === 'object' && mine.data !== null, 'comment API body parses as JSON data')
}
const api404 = await anon('/api/public/publications/%3Cscript%3Ealert(1)%3C%2Fscript%3E')
ok(api404.ct.includes('json') && !String(api404.data).includes('<script>'), 'error responses are JSON, never reflected HTML')

// ───── rate limiting: repeated bad logins lock the key ─────
let last = 0
for (let i = 0; i < 10; i++) last = (await anon('/api/auth/login', { json: { username: 'sec-nobody-' + Date.now().toString(36).slice(0, 4), password: 'wrong' } })).status
const victim = 'sec-lock-' + Date.now().toString(36)
const codes = []
for (let i = 0; i < 10; i++) codes.push((await anon('/api/auth/login', { json: { username: victim, password: 'wrong' + i } })).status)
ok(codes.includes(429), `login rate limit kicks in (statuses: ${codes.join(',')})`)
ok(last === 401 || last === 429, 'bad credentials -> 401')

// ───── purchase codes: one-time use, bound to issue ─────
const tIssues = (await tm(`/api/team/${pubId}/issues`)).data.issues
const paid = tIssues.find((i) => i.status === 'published' && i.pricing === 'paid')
if (paid) {
  const made = await tm(`/api/team/${pubId}/codes`, { json: { issue_id: paid.id, count: 1, ttl_hours: 1 } })
  const code = made.data?.codes?.[0]
  ok(!!code, 'team mints a code')
  const { c: st2 } = await login('39010152', 'student1234')
  const r1 = await st2('/api/me/codes/redeem', { json: { code } })
  ok(r1.status === 200, `first redemption ok -> ${r1.status}`)
  const r2 = await st('/api/me/codes/redeem', { json: { code } })
  ok(r2.status >= 400, `code reuse by another student rejected -> ${r2.status}`)
  const r3 = await st2('/api/me/codes/redeem', { json: { code } })
  ok(r3.status >= 400, `code reuse by same student rejected -> ${r3.status}`)
  const bogus = await st('/api/me/codes/redeem', { json: { code: 'NSH-ZZZZ-ZZZZ' } })
  ok(bogus.status === 400, `bogus code rejected -> ${bogus.status}`)

  // ───── reader: signed, expiring page URLs; paywall enforced server-side ─────
  const { c: st3 } = await login('39010322', 'student1234')
  const man = await st3(`/api/reader/${paid.id}/manifest`)
  ok(man.status === 200 && man.data.full === false, 'non-entitled student gets preview manifest only')
  const allowed = man.data?.allowed || 0
  ok((man.data?.pages || []).length === allowed, 'manifest lists only allowed pages')
  const forged = await st3(`/api/reader/${paid.id}/page/${allowed + 1}?e=${Math.floor(Date.now() / 1000) + 300}&s=deadbeef`)
  ok(forged.status === 403, `forged page signature rejected -> ${forged.status}`)
  const expired = await st3(`/api/reader/${paid.id}/page/1?e=${Math.floor(Date.now() / 1000) - 10}&s=x`)
  ok(expired.status === 403, `expired page URL rejected -> ${expired.status}`)
  if (man.data?.pages?.[0]) {
    const u = man.data.pages[0].url
    const swapped = u.replace(/\/page\/1\?/, `/page/${allowed + 1}?`)
    const r = await st3(swapped)
    ok(r.status === 403, `re-using a signature for another page rejected -> ${r.status}`)
  }
  const full = await st2(`/api/reader/${paid.id}/manifest`)
  ok(full.status === 200 && full.data.full === true, 'entitled student gets the full manifest')
}

// ───── original PDF is never served to readers ─────
const draft = tIssues.find((i) => !['published', 'awaiting_approval', 'archived'].includes(i.status))
if (draft) {
  const pdf = new Blob([new TextEncoder().encode('%PDF-1.4\n%sec-test\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')], { type: 'application/pdf' })
  const fd = new FormData()
  fd.set('file', pdf, 'sec.pdf')
  fd.set('pub', pubId)
  fd.set('role', 'main_pdf')
  fd.set('issue', draft.id)
  const up = await tm('/api/media/upload', { form: fd })
  ok(up.status === 200 && up.data?.key, `team uploads main PDF -> ${up.status}`)
  if (up.data?.key) {
    const url = `/api/media/k/${up.data.key}`
    ok((await tm(url)).status === 200, 'team can fetch its own main PDF')
    ok((await anon(url)).status === 401, 'anonymous cannot fetch main PDF (401)')
    ok((await st(url)).status === 403, 'student cannot fetch main PDF (403)')
    ok((await anon('/api/media/k/' + up.data.key.replace(/[^/]+$/, '../../etc/passwd'))).status === 404, 'path traversal key rejected')
  }
  // uploads are type-sniffed by magic bytes, not by the declared name/MIME
  const fake = new FormData()
  fake.set('file', new Blob(['<html><script>alert(1)</script></html>'], { type: 'image/png' }), 'x.png')
  fake.set('pub', pubId)
  fake.set('role', 'gallery')
  fake.set('issue', draft.id)
  ok((await tm('/api/media/upload', { form: fake })).status === 400, 'HTML disguised as PNG rejected by magic-byte sniffing')
  // uploading into another publication is forbidden
  if (otherPub) {
    const fd2 = new FormData()
    fd2.set('file', pdf, 'sec.pdf')
    fd2.set('pub', otherPub.id)
    fd2.set('role', 'logo')
    ok((await tm('/api/media/upload', { form: fd2 })).status === 403, 'IDOR: upload into other publication 403')
  }
}

console.log(failures ? `\nsecurity: ${failures} FAILURE(S), ${passed} passed` : `\nsecurity: ALL ${passed} CHECKS PASSED`)
process.exit(failures ? 1 : 0)

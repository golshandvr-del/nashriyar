// Smoke test for the Cloudflare runtime (wrangler pages dev, local D1/R2) — needs NO demo data.
// Usage: npm run build && npx wrangler pages dev dist --d1=DB --local --port 8788
//        BASE=http://127.0.0.1:8788 node tests/smoke-cf.mjs
const BASE = process.env.BASE || 'http://127.0.0.1:8788'
let failures = 0
const ok = (cond, msg) => {
  console.log(cond ? 'ok  ' : 'FAIL', msg)
  if (!cond) failures++
}
const get = async (p) => {
  const r = await fetch(BASE + p, { headers: { Origin: BASE } })
  const ct = r.headers.get('content-type') || ''
  return { status: r.status, headers: r.headers, data: ct.includes('json') ? await r.json() : await r.text() }
}

const h = await get('/api/health')
ok(h.status === 200 && h.data.ok === true && h.data.db === 'ok', 'GET /api/health → db ok (migrations applied on D1)')

const home = await get('/')
ok(home.status === 200 && String(home.data).includes('<div id="root"'), 'GET / serves the SPA shell')
const csp = home.headers.get('content-security-policy') || ''
ok(csp.includes("default-src 'self'") && !/https?:\/\//.test(csp), 'CSP present and allows no external origin')
ok(home.headers.get('x-frame-options') === 'DENY', 'X-Frame-Options: DENY')
const html = String(home.data)
ok(!/(src|href)=["']https?:\/\//i.test(html), 'index.html loads no external script/style/font (ADR-003)')
const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1])
let ext = 0
for (const a of assets) {
  const body = await (await fetch(BASE + a)).text()
  if (/@import\s+url\(["']?https?:|url\(["']?https?:\/\/(?!www\.w3\.org)/i.test(body)) ext++
}
ok(assets.length > 0 && ext === 0, `entry assets (${assets.length}) reference no external url() / @import`)

for (const p of ['/api/public/home', '/api/public/explore', '/api/public/categories', '/api/auth/me']) {
  const r = await get(p)
  ok(r.status === 200, `GET ${p} → 200`)
}
const spa = await get('/explore')
ok(spa.status === 200 && String(spa.data).includes('<div id="root"'), 'deep link /explore falls back to the SPA')
const admin = await get('/api/admin/overview')
ok(admin.status === 401 || admin.status === 403, 'admin API rejects anonymous visitors')
const post = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' })
ok(post.status === 403, 'cross-origin POST blocked (CSRF)')

console.log(failures ? `\n${failures} CLOUDFLARE SMOKE CHECK(S) FAILED` : '\nALL CLOUDFLARE SMOKE CHECKS PASSED')
process.exit(failures ? 1 : 0)

// Light load test (ROADMAP phase 12): N concurrent visitors on the public dashboard/explore APIs and
// M concurrent readers paging through a free issue. Dependency-free (Node 18+ fetch).
// Usage: BASE=http://localhost:3000 VUS=500 READERS=50 DURATION=30 node tests/load.mjs
// Each reader uses its own User-Agent, so the per-viewer page-rate guard (90 pages/min) applies per reader
// exactly as in production. Exit code 1 if the error rate exceeds 1% or p95 exceeds P95_MS (default 1500).
const BASE = process.env.BASE || 'http://localhost:3000'
const VUS = Number(process.env.VUS || 500)
const READERS = Number(process.env.READERS || 50)
const DURATION = Number(process.env.DURATION || 30) * 1000
const P95_MS = Number(process.env.P95_MS || 1500)
const THINK_MS = Number(process.env.THINK_MS || 1000)

const stats = {}
const rec = (name, ms, ok) => {
  const s = (stats[name] ||= { lat: [], err: 0 })
  s.lat.push(ms)
  if (!ok) s.err++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const jitter = (ms) => ms * (0.5 + Math.random())

async function hit(name, path, headers = {}) {
  const t = performance.now()
  try {
    const res = await fetch(BASE + path, { headers })
    const body = (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.arrayBuffer()
    rec(name, performance.now() - t, res.ok)
    return res.ok ? body : null
  } catch {
    rec(name, performance.now() - t, false)
    return null
  }
}

const PUBLIC_PATHS = [
  ['home', '/api/public/home'],
  ['explore', '/api/public/explore'],
  ['stories', '/api/public/stories'],
  ['categories', '/api/public/categories'],
  ['publications', '/api/public/publications']
]

async function visitor(end) {
  while (Date.now() < end) {
    const [name, path] = PUBLIC_PATHS[Math.floor(Math.random() * PUBLIC_PATHS.length)]
    await hit(name, path)
    await sleep(jitter(THINK_MS))
  }
}

async function reader(id, issueId, end) {
  const headers = { 'User-Agent': `nashriyar-load-reader/${id}` }
  while (Date.now() < end) {
    const man = await hit('reader.manifest', `/api/reader/${issueId}/manifest`, headers)
    if (!man) {
      await sleep(THINK_MS)
      continue
    }
    for (const p of man.pages) {
      if (Date.now() >= end) break
      await hit('reader.page', p.url, headers)
      await sleep(jitter(2000)) // a fast reader: ~30 pages/min, well below the 90/min guard
    }
  }
}

// Officer dashboards (ROADMAP phase 17): ANALYSTS concurrent officers browsing analytics reports (served from the
// targeted cache after the first read, exactly like production). Set ANALYSTS=0 to skip. OFFICER=user:pass.
const ANALYSTS = Number(process.env.ANALYSTS ?? 5)
const [OFF_USER, OFF_PASS] = (process.env.OFFICER || 'officer:officer1234').split(':')
const ANALYTICS_PATHS = ['summary', 'trends', 'explore', 'ranking', 'sales', 'production', 'forecast', 'gaps', 'visuals', 'directors']
async function analyst(cookie, end) {
  while (Date.now() < end) {
    const p = ANALYTICS_PATHS[Math.floor(Math.random() * ANALYTICS_PATHS.length)]
    await hit(`analytics.${p}`, `/api/analytics/${p}`, { cookie })
    await sleep(jitter(THINK_MS * 3))
  }
}
async function officerCookie() {
  const res = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ username: OFF_USER, password: OFF_PASS }) })
  const set = res.headers.getSetCookie?.() || [res.headers.get('set-cookie') || '']
  return res.ok ? set.map((c) => c.split(';')[0]).join('; ') : null
}

const pct = (arr, q) => {
  if (!arr.length) return 0
  const a = [...arr].sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.floor(q * a.length))]
}

const home = await (await fetch(BASE + '/api/public/home')).json().catch(() => null)
// first free issue whose page 1 really renders (synthetic 10-year issues from scripts/gen-10y.mjs have no page files)
let issueId = process.env.ISSUE || null
for (const it of issueId ? [] : home?.free || []) {
  const h = { 'User-Agent': 'nashriyar-load-probe' }
  const man = await (await fetch(`${BASE}/api/reader/${it.id}/manifest`, { headers: h })).json().catch(() => null)
  const first = man?.pages?.[0]?.url
  if (first && (await fetch(BASE + first, { headers: h })).ok) {
    issueId = it.id
    break
  }
}
if (!issueId) console.log('warning: no free issue found — reader scenario skipped')
console.log(`load: ${VUS} visitors + ${issueId ? READERS : 0} readers for ${DURATION / 1000}s against ${BASE}`)
const cookie = ANALYSTS > 0 ? await officerCookie() : null
if (ANALYSTS > 0 && !cookie) console.log('warning: officer login failed — analytics scenario skipped')
// warm the analytics cache once (a real install has warm caches; cold computation is measured separately)
if (cookie) for (const p of ANALYTICS_PATHS) await fetch(`${BASE}/api/analytics/${p}`, { headers: { cookie } })
const end = Date.now() + DURATION
const t0 = Date.now()
await Promise.all([
  ...(cookie ? Array.from({ length: ANALYSTS }, () => analyst(cookie, end)) : []),
  ...Array.from({ length: VUS }, () => visitor(end)),
  ...(issueId ? Array.from({ length: READERS }, (_, i) => reader(i, issueId, end)) : [])
])
const secs = (Date.now() - t0) / 1000

let total = 0
let errors = 0
const all = []
console.log('\nendpoint            reqs   err    p50    p95    p99 (ms)')
for (const [name, s] of Object.entries(stats)) {
  total += s.lat.length
  errors += s.err
  all.push(...s.lat)
  const f = (n) => String(Math.round(n)).padStart(6)
  console.log(`${name.padEnd(18)} ${String(s.lat.length).padStart(5)} ${String(s.err).padStart(5)} ${f(pct(s.lat, 0.5))} ${f(pct(s.lat, 0.95))} ${f(pct(s.lat, 0.99))}`)
}
const p95 = pct(all, 0.95)
const errRate = total ? errors / total : 1
console.log(`\ntotal ${total} requests in ${secs.toFixed(1)}s (${(total / secs).toFixed(1)} req/s), errors ${(errRate * 100).toFixed(2)}%, p95 ${Math.round(p95)}ms`)
const pass = errRate <= 0.01 && p95 <= P95_MS
console.log(pass ? 'PASS' : `FAIL (limits: errors <= 1%, p95 <= ${P95_MS}ms)`)
process.exit(pass ? 0 : 1)

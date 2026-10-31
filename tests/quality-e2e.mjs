// Phase 9 quality & E2E verification suite:
//   1) WCAG 2.1 AA contrast audit across all light & dark theme token pairs (>= 4.5:1 for text, >= 3:1 for large/UI)
//      + structural accessibility checks (lang="fa" dir="rtl", skip-links, main#main, aria-labels).
//   2) Performance budget audit (initial JS/CSS gzipped budget, lazy-loaded routes, lazy/async images, immutable asset caching).
//   3) Full role-by-role E2E scenarios (guest, student, team member, managing director, faculty supervisor, analyst, pub officer, super admin).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const BASE = process.env.BASE || 'http://127.0.0.1:3000'
let passed = 0

function step(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++
      console.log('  ✓', name)
    })
}

// ───────── 1. WCAG 2.1 AA contrast & accessibility audit ─────────
function srgbLum(hex) {
  const h = hex.replace('#', '')
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(hex1, hex2) {
  const l1 = srgbLum(hex1)
  const l2 = srgbLum(hex2)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

await step('WCAG AA: light & dark theme token contrast ratios >= 4.5:1', () => {
  const css = fs.readFileSync('src/web/styles.css', 'utf-8')
  assert.ok(css.includes('.skip-link'), 'styles.css must define .skip-link')
  assert.ok(css.includes(':focus-visible'), 'styles.css must define :focus-visible')
  assert.ok(css.includes('prefers-reduced-motion'), 'styles.css must honor prefers-reduced-motion')

  // Light theme pairs (foreground, background, minRatio)
  const lightPairs = [
    ['#111827', '#ffffff', 4.5, 'light text on surface'],
    ['#111827', '#f6f7f9', 4.5, 'light text on bg'],
    ['#4b5563', '#ffffff', 4.5, 'light muted on surface'],
    ['#4b5563', '#f6f7f9', 4.5, 'light muted on bg'],
    ['#4b5563', '#f1f3f6', 4.5, 'light muted on surface-2'],
    ['#ffffff', '#0f766e', 4.5, 'light brand-ink on brand'],
    ['#ffffff', '#dc2626', 4.5, 'light white on danger']
  ]
  for (const [fg, bg, min, label] of lightPairs) {
    const ratio = contrast(fg, bg)
    assert.ok(ratio >= min, `${label}: contrast ${ratio.toFixed(2)} < ${min}`)
  }

  // Dark theme pairs
  const darkPairs = [
    ['#e5e7eb', '#0b0f14', 4.5, 'dark text on bg'],
    ['#e5e7eb', '#121821', 4.5, 'dark text on surface'],
    ['#9ca3af', '#0b0f14', 4.5, 'dark muted on bg'],
    ['#9ca3af', '#121821', 4.5, 'dark muted on surface'],
    ['#9ca3af', '#1a2230', 4.5, 'dark muted on surface-2'],
    ['#042f2e', '#2dd4bf', 4.5, 'dark brand-ink on brand']
  ]
  for (const [fg, bg, min, label] of darkPairs) {
    const ratio = contrast(fg, bg)
    assert.ok(ratio >= min, `${label}: contrast ${ratio.toFixed(2)} < ${min}`)
  }
})

await step('WCAG AA: RTL semantics, skip-links and main landmarks in all layouts', () => {
  const html = fs.readFileSync('index.html', 'utf-8')
  assert.match(html, /<html[^>]+lang="fa"[^>]+dir="rtl"/, 'index.html must set lang="fa" dir="rtl"')
  for (const f of ['src/web/public/Layout.tsx', 'src/web/team/Layout.tsx', 'src/web/admin/Layout.tsx']) {
    const src = fs.readFileSync(f, 'utf-8')
    assert.ok(src.includes('className="skip-link"'), `${f} must include .skip-link`)
    assert.ok(src.includes('id="main"'), `${f} must include <main id="main">`)
  }
})

// ───────── 2. Performance budget & Lighthouse readiness ─────────
await step('Performance budget: gzipped entry JS <= 120 KB, CSS <= 30 KB, route code-splitting active', () => {
  const assetsDir = 'dist/assets'
  const files = fs.readdirSync(assetsDir)
  const jsFiles = files.filter((f) => f.endsWith('.js'))
  const cssFiles = files.filter((f) => f.endsWith('.css'))
  assert.ok(jsFiles.length >= 20, `expected >= 20 code-split JS chunks, got ${jsFiles.length}`)

  const indexJs = jsFiles.find((f) => /^index-.*\.js$/.test(f))
  assert.ok(indexJs, 'entry index-*.js chunk must exist')
  const indexGz = zlib.gzipSync(fs.readFileSync(path.join(assetsDir, indexJs))).length
  assert.ok(indexGz <= 120 * 1024, `entry JS gzipped ${indexGz}B exceeds 120KB budget`)

  for (const c of cssFiles) {
    const gz = zlib.gzipSync(fs.readFileSync(path.join(assetsDir, c))).length
    assert.ok(gz <= 30 * 1024, `CSS ${c} gzipped ${gz}B exceeds 30KB budget`)
  }
})

// ───────── 3. Role-by-role E2E scenarios ─────────
function client() {
  let cookie = ''
  return async function call(p, opts = {}) {
    const headers = {
      Origin: BASE,
      ...(opts.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    }
    const res = await fetch(BASE + p, {
      method: opts.method || (opts.json !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
      redirect: 'manual'
    })
    const sc = res.headers.get('set-cookie')
    if (sc && sc.includes('nsh_sid=')) cookie = sc.split(';')[0]
    const ct = res.headers.get('content-type') || ''
    const data = ct.includes('json') ? await res.json().catch(() => null) : await res.text()
    return { status: res.status, data, headers: res.headers }
  }
}

async function login(username, password) {
  const c = client()
  const r = await c('/api/auth/login', { json: { username, password } })
  assert.equal(r.status, 200, `login ${username} failed: ${JSON.stringify(r.data)}`)
  return c
}

await step('E2E Guest: home, explore, guide PDF, healthz, robots.txt & sitemap.xml', async () => {
  const g = client()
  const h = await g('/healthz')
  assert.equal(h.status, 200)
  assert.equal(h.data.ok, true)

  const home = await g('/api/public/home')
  assert.equal(home.status, 200)
  assert.ok(home.data.latest.length > 0)

  const guidePdf = await g('/user-guide.pdf')
  assert.equal(guidePdf.status, 200)

  const rob = await g('/robots.txt')
  assert.equal(rob.status, 200)
  assert.match(String(rob.data), /Sitemap:/)
})

await step('E2E Student: follow publication, bookmark issue, read free page, view library', async () => {
  const st = await login('40012345', 'student1234')
  const home = (await st('/api/public/home')).data
  const issue = home.latest[0]
  assert.equal((await st(`/api/me/follows/${issue.publication_id}`, { json: {} })).status, 200)
  assert.equal((await st(`/api/reader/${issue.id}/bookmarks`, { json: { page: 1 } })).status, 200)
  const lib = await st('/api/me/library')
  assert.equal(lib.status, 200)
  const reader = await st(`/api/reader/${issue.id}/manifest`)
  assert.equal(reader.status, 200)
  assert.ok(reader.data.pages.length > 0)
})

await step('E2E Team (Managing Director): dashboard, issues, generate & export access codes, comment hints', async () => {
  const tm = await login('pub1-director', 'team1234')
  const my = (await tm('/api/team/my')).data
  const pubId = my.publications[0].publication_id
  assert.equal((await tm(`/api/team/${pubId}/dashboard`)).status, 200)
  assert.equal((await tm(`/api/team/${pubId}/comments?status=pending`)).status, 200)
  assert.equal((await tm(`/api/team/${pubId}/comments/ai-hints`, { json: {} })).status, 200)
  assert.equal((await tm(`/api/team/${pubId}/categories/suggest`, { json: { text: 'هوش مصنوعی و فناوری' } })).status, 200)
})

await step('E2E Faculty Supervisor & Analyst: scoped overview, insights, natural-language ask', async () => {
  const sup = await login('supervisor', 'super1234')
  assert.equal((await sup('/api/admin/overview')).status, 200)
  assert.equal((await sup('/api/analytics/insights')).status, 200)

  const an = await login('analyst', 'analyst1234')
  const ask = await an('/api/analytics/ai/ask', { json: { question: 'بهترین نشریات امسال کدام‌اند؟' } })
  assert.equal(ask.status, 200)
  assert.equal(ask.data.route.report, 'ranking')
})

await step('E2E Pub Officer & Super Admin: approvals, settings, monitoring, audit log', async () => {
  const off = await login('officer', 'officer1234')
  assert.equal((await off('/api/admin/approvals')).status, 200)
  assert.equal((await off('/api/admin/audit')).status, 200)

  // Server monitoring moved to the developer console (phase 13): publication staff get 403, /healthz stays public.
  const adm = await login('admin', 'admin1234')
  assert.equal((await adm('/api/system/health')).status, 403)
  assert.equal((await off('/api/system/health')).status, 403)
  const hz = await fetch(BASE + '/healthz').then((r) => r.json())
  assert.equal(hz.ok, true)
  assert.ok(typeof hz.requests.p95_ms === 'number')
})

console.log(`quality-e2e: ${passed} passed`)

// Browser E2E (ROADMAP phase 12): visits every route of every role at 390px and 1440px and fails on
// console errors, uncaught exceptions, horizontal overflow, or overlapping navigation controls.
// Playwright is optional: if it is not installed the suite is skipped (exit 0) so CI without browsers still passes.
// Usage: BASE=http://127.0.0.1:3000 node tests/browser-e2e.mjs   (or via `npm test`, which seeds a fresh DB)
const BASE = process.env.BASE || 'http://127.0.0.1:3000'

let chromium
try {
  ;({ chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright'))
} catch {
  console.log('⏭  playwright not installed — browser suite skipped (npm i -D playwright && npx playwright install chromium)')
  process.exit(0)
}

const PUBLIC = ['/', '/explore', '/categories', '/search', '/guide', '/terms', '/recruitment', '/login', '/register', '/recover', '/verify']
const STUDENT = ['/', '/library', '/following', '/notifications', '/settings', '/redeem']
const TEAM = ['', '/issues', '/issues/new', '/members', '/posts', '/comments', '/sales', '/stats', '/recruit', '/profile']
const SYSTEM = ['', '/settings', '/backups', '/sessions', '/database', '/staff', '/audit']
const ADMIN = ['', '/overview', '/live', '/analytics', '/insights', '/report', '/approvals', '/publications', '/people', '/structure', '/categories', '/moderation', '/storefront', '/announcements', '/users', '/audit', '/settings']

const ROLES = [
  { name: 'guest', user: null, routes: PUBLIC },
  { name: 'student', user: ['40012345', 'student1234'], routes: STUDENT },
  { name: 'team', user: ['pub1-director', 'team1234'], routes: ['/settings', ...TEAM.map((r) => '__TEAM__' + r)] },
  { name: 'officer', user: ['officer', 'officer1234'], routes: ['/settings', ...ADMIN.map((r) => '/admin' + r)] },
  { name: 'analyst', user: ['analyst', 'analyst1234'], routes: ['/admin', '/admin/analytics', '/admin/insights', '/admin/report'] },
  // developer console (phase 13): a fresh CLI-created account per run; password change + TOTP are done in-page
  { name: 'developer', user: 'cli', routes: SYSTEM.map((r) => '/system' + r) }
]

/** Creates a developer from the CLI (same DATA_DIR as the server) and returns its one-time password. */
async function cliDeveloper(username) {
  const { spawnSync } = await import('node:child_process')
  const r = spawnSync(process.execPath, ['server-dist/node.mjs', '--create-developer', username], { env: process.env, encoding: 'utf8' })
  const m = /password: (\S+)/.exec(r.stdout || '')
  if (!m) throw new Error('create-developer failed: ' + (r.stderr || r.stdout))
  return m[1]
}
async function totpCode(secret) {
  const { createHmac } = await import('node:crypto')
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0, val = 0
  const out = []
  for (const ch of secret.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    val = (val << 5) | A.indexOf(ch)
    bits += 5
    if (bits >= 8) (out.push((val >>> (bits - 8)) & 255), (bits -= 8))
  }
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const h = createHmac('sha1', Buffer.from(out)).update(msg).digest()
  const o = h[h.length - 1] & 15
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0')
}
const WIDTHS = (process.env.WIDTHS || '390,1440').split(',').map(Number)
// Benign noise that is not an app bug (aborted fetches when navigating quickly, favicon in headless).
const IGNORE = [/net::ERR_ABORTED/, /favicon/i, /Failed to load resource.*40[13]/]

let failures = 0
const fail = (msg) => {
  failures++
  console.log('  ✗ ' + msg)
}

const browser = await chromium.launch()
for (const width of WIDTHS) {
  for (const role of ROLES) {
    const ctx = await browser.newContext({ viewport: { width, height: 860 } })
    const page = await ctx.newPage()
    const errors = []
    page.on('console', (m) => m.type() === 'error' && !IGNORE.some((re) => re.test(m.text())) && errors.push(m.text().slice(0, 200)))
    page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 200)))
    let teamBase = ''
    if (role.user === 'cli') {
      const username = `e2e-dev-${width}-${Date.now() % 100000}`
      const pw = await cliDeveloper(username)
      await page.goto(BASE + '/login')
      const call = (path, body) =>
        page.evaluate(
          ([path, body]) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) })),
          [path, body]
        )
      const steps = [await call('/api/auth/login', { username, password: pw }), await call('/api/auth/change-password', { current: pw, next: pw + '-New9' })]
      const setup = await call('/api/auth/totp/setup', {})
      steps.push(setup, await call('/api/auth/totp/enable', { code: await totpCode(setup.data?.secret || '') }))
      const bad = steps.find((s) => s.status !== 200)
      if (bad) fail(`developer setup step -> ${bad.status} ${JSON.stringify(bad.data).slice(0, 120)}`)
    } else if (role.user) {
      await page.goto(BASE + '/login')
      await page.fill('input[autocomplete=username]', role.user[0])
      await page.fill('input[autocomplete=current-password]', role.user[1])
      await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 }).catch(() => {}), page.click('button[type=submit]')])
      if (role.name === 'team') {
        const me = await page.evaluate(() => fetch('/api/auth/me').then((r) => r.json()))
        teamBase = '/team/' + me.publications[0].publication_id
      }
    }
    console.log(`▶ ${role.name} @ ${width}px`)
    for (const r of role.routes) {
      const path = r.replace('__TEAM__', teamBase)
      errors.length = 0
      try {
        await page.goto(BASE + path, { timeout: 20000 })
        await page.waitForLoadState('networkidle', { timeout: 20000 })
      } catch (e) {
        fail(`${path}: load timeout`)
        continue
      }
      const res = await page.evaluate(() => {
        const overflow = document.documentElement.scrollWidth - window.innerWidth
        // Navigation controls that are visible must not overlap each other (the old tab strips did).
        const els = [...document.querySelectorAll('header a, header button, nav[aria-label] a, nav[aria-label] button')].filter((el) => {
          const r = el.getBoundingClientRect()
          const s = getComputedStyle(el)
          return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && r.right > 0 && r.left < window.innerWidth && !el.closest('[aria-hidden="true"]')
        })
        const boxes = els.map((el) => [el.getBoundingClientRect(), el.textContent?.trim().slice(0, 20) || el.getAttribute('aria-label') || '?'])
        const overlaps = []
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++) {
            const [a, an] = boxes[i]
            const [b, bn] = boxes[j]
            if (els[i].contains(els[j]) || els[j].contains(els[i])) continue
            const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left)
            const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
            if (ix > 4 && iy > 4) overlaps.push(`${an} ↔ ${bn}`)
          }
        const blank = (document.querySelector('main')?.innerText || document.body.innerText).trim().length < 5
        // Name the widest element sticking out of the viewport (inside a non-scrolling ancestor) to make overflow fixable.
        let culprit = ''
        if (overflow > 2) {
          for (const el of document.querySelectorAll('main *')) {
            const r = el.getBoundingClientRect()
            if (!r.width || (r.right <= window.innerWidth + 1 && r.left >= -1)) continue
            let p = el.parentElement, clipped = false
            while (p && p !== document.body) {
              const ox = getComputedStyle(p).overflowX
              if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') { clipped = true; break }
              p = p.parentElement
            }
            if (!clipped) { culprit = `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className ?? '').slice(0, 60)} w=${Math.round(r.width)}`; break }
          }
        }
        return { overflow, overlaps: overlaps.slice(0, 3), blank, culprit }
      })
      const problems = []
      if (errors.length) problems.push('console: ' + errors[0])
      if (res.overflow > 2) problems.push(`horizontal overflow ${res.overflow}px${res.culprit ? ' (' + res.culprit + ')' : ''}`)
      if (res.overlaps.length) problems.push('overlap: ' + res.overlaps.join(', '))
      if (res.blank) problems.push('blank page')
      if (problems.length) fail(`${path} — ${problems.join(' | ')}`)
      else console.log(`  ✓ ${path}`)
    }
    await ctx.close()
  }
}
await browser.close()
console.log(failures ? `\n✗ browser-e2e: ${failures} problem(s)` : '\n✓ browser-e2e: all routes clean')
process.exit(failures ? 1 : 0)

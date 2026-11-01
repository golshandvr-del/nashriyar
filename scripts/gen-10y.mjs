// 10-year synthetic dataset for the load test (ROADMAP phase 17).
// Adds, on top of a seeded DB: 100 publications, 5000 published issues spread over 10 years, 1,000,000 view events,
// plus access codes, physical sales and follows in realistic proportions; then rolls finished days into view_daily
// exactly like lib/rollup.ts does, so analytics read the same shape as a real long-running install.
// Usage: DATA_DIR=data-10y node server-dist/node.mjs --seed && node scripts/gen-10y.mjs data-10y
// Env: PUBS (100) ISSUES (5000) VIEWS (1000000) YEARS (10)
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import crypto from 'node:crypto'

const dir = process.argv[2] || process.env.DATA_DIR || 'data'
const PUBS = Number(process.env.PUBS || 100)
const ISSUES = Number(process.env.ISSUES || 5000)
const VIEWS = Number(process.env.VIEWS || 1_000_000)
const YEARS = Number(process.env.YEARS || 10)
const DAY = 86400_000
const NOW = Date.now()
const SPAN = YEARS * 365 * DAY

const db = new DatabaseSync(path.join(dir, 'nashriyar.db'))
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = OFF;')

// deterministic PRNG so runs are comparable
let seed = 1405
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
let idn = 0
const id = (p) => `${p}${(idn++).toString(36).padStart(7, '0')}`
const iso = (t) => new Date(t).toISOString()
const day = (t) => iso(t).slice(0, 10)

const assoc = db.prepare('SELECT id, faculty_id FROM associations').all()
const users = db.prepare("SELECT id FROM users WHERE system_role = 'student' LIMIT 200").all().map((r) => r.id)
const director = db.prepare("SELECT id FROM users WHERE system_role = 'team' LIMIT 1").get()?.id
const cats = db.prepare('SELECT id FROM categories').all().map((r) => r.id)
if (!assoc.length) throw new Error('seed the DB first (node server-dist/node.mjs --seed)')

const t0 = Date.now()
const tx = (fn) => {
  db.exec('BEGIN')
  try {
    fn()
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

// ── publications ──
const insPub = db.prepare(`INSERT INTO publications (id, slug, title, tagline, association_id, faculty_id, frequency, status, keywords, search_text, founded_at, created_at)
  VALUES (?,?,?,?,?,?,?,'active',?,?,?,?)`)
const insRole = db.prepare('INSERT INTO publication_roles (id, publication_id, user_id, role, started_at) VALUES (?,?,?,?,?)')
const insPubCat = db.prepare('INSERT OR IGNORE INTO publication_categories (publication_id, category_id) VALUES (?,?)')
const pubs = []
tx(() => {
  for (let i = 0; i < PUBS; i++) {
    const a = pick(assoc)
    const pid = id('lp')
    const founded = NOW - SPAN - ri(0, 200) * DAY
    const title = `نشریهٔ آزمون بار ${i + 1}`
    insPub.run(pid, `load-${i + 1}`, title, 'دادهٔ ساختگی ده‌ساله', a.id, a.faculty_id, pick(['monthly', 'quarterly', 'biannual']), 'آزمون،بار', title, iso(founded), iso(founded))
    if (director) insRole.run(id('lr'), pid, director, 'managing_director', iso(founded))
    if (cats.length) insPubCat.run(pid, pick(cats))
    pubs.push(pid)
  }
})

// ── issues: evenly spread over the span, numbered per publication ──
const insIssue = db.prepare(`INSERT INTO issues (id, publication_id, number, title, keywords, status, published_at, page_count, pricing, price_digital, price_print, search_text, created_at, updated_at)
  VALUES (?,?,?,?,?,'published',?,?,?,?,?,?,?,?)`)
const issues = []
const nextNo = new Map()
tx(() => {
  for (let k = 0; k < ISSUES; k++) {
    const pid = pubs[k % pubs.length]
    const n = (nextNo.get(pid) || 0) + 1
    nextNo.set(pid, n)
    const at = NOW - SPAN + Math.floor(((k + rnd()) / ISSUES) * SPAN)
    const paid = rnd() < 0.3
    const iid = id('li')
    insIssue.run(iid, pid, n, `شمارهٔ ${n}`, 'آزمون', iso(at), ri(8, 40), paid ? 'paid' : 'free', paid ? 30000 : null, pick([null, 60000]), `شماره ${n}`, iso(at - 20 * DAY), iso(at))
    issues.push({ id: iid, pid, at, paid })
  }
})

// ── sales: codes for paid issues (≈4 each), some physical sales, follows ──
const insCode = db.prepare(`INSERT INTO access_codes (id, issue_id, publication_id, code_hash, code_last4, price_paid, channel, created_at, expires_at, redeemed_at, redeemed_by)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
const insSale = db.prepare('INSERT INTO physical_sales (id, issue_id, publication_id, quantity, unit_price, sold_at, channel, created_at) VALUES (?,?,?,?,?,?,?,?)')
const insFollow = db.prepare('INSERT OR IGNORE INTO follows (user_id, publication_id, created_at) VALUES (?,?,?)')
let codes = 0
let sales = 0
tx(() => {
  for (const is of issues) {
    if (is.paid) {
      for (let j = ri(1, 7); j > 0; j--) {
        const at = is.at + ri(0, 60) * DAY
        const redeemed = rnd() < 0.8
        insCode.run(id('lc'), is.id, is.pid, crypto.randomBytes(16).toString('hex'), String(ri(1000, 9999)), 30000, pick(['cash', 'card_to_card']), iso(at), iso(at + DAY), redeemed ? iso(at + 3600_000) : null, redeemed && users.length ? pick(users) : null)
        codes++
      }
    }
    if (rnd() < 0.4) {
      insSale.run(id('ls'), is.id, is.pid, ri(5, 80), 60000, day(is.at + ri(0, 30) * DAY), 'غرفه', iso(is.at))
      sales++
    }
  }
  for (const u of users) for (let j = 0; j < 5; j++) insFollow.run(u, pick(pubs), iso(NOW - ri(0, 3000) * DAY))
})

// ── 1M view events, newest-heavy (more traffic in recent years), in batched transactions ──
const insView = db.prepare('INSERT INTO view_events (id, entity_type, entity_id, publication_id, viewer_hash, user_id, day, created_at) VALUES (?,?,?,?,?,?,?,?)')
const TYPES = ['issue', 'issue', 'issue_read', 'publication', 'post', 'search']
const BATCH = 50_000
for (let done = 0; done < VIEWS; done += BATCH) {
  tx(() => {
    for (let k = done; k < Math.min(VIEWS, done + BATCH); k++) {
      // sqrt skews toward recent days: growth of the audience over the decade
      const at = NOW - Math.floor((1 - Math.sqrt(rnd())) * SPAN)
      const is = issues[Math.floor(rnd() * issues.length)]
      const type = pick(TYPES)
      insView.run(id('lv'), type, type === 'publication' ? is.pid : type === 'search' ? null : is.id, is.pid, 'vh' + ri(1, 40000), rnd() < 0.2 && users.length ? pick(users) : null, day(at), iso(at))
    }
  })
  process.stdout.write(`\rviews ${Math.min(VIEWS, done + BATCH)}/${VIEWS}`)
}
process.stdout.write('\n')

// ── rollup (same SQL as lib/rollup.ts ensureRollup), up to yesterday ──
const yesterday = day(NOW - DAY)
db.exec('DELETE FROM view_daily')
db.prepare(`INSERT INTO view_daily (day, publication_id, entity_type, n, uniq)
  SELECT day, COALESCE(publication_id, ''), entity_type, COUNT(*), COUNT(DISTINCT COALESCE(viewer_hash, user_id, id))
  FROM view_events WHERE day <= ? GROUP BY day, COALESCE(publication_id, ''), entity_type`).run(yesterday)
db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('analytics_rollup_until', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(yesterday), iso(NOW))
db.exec('DELETE FROM analytics_cache')
db.exec('ANALYZE')

const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n
console.log(JSON.stringify({
  publications: count('publications'), issues: count('issues'), view_events: count('view_events'), view_daily: count('view_daily'),
  access_codes: count('access_codes'), physical_sales: count('physical_sales'), follows: count('follows'),
  added: { pubs: PUBS, issues: ISSUES, views: VIEWS, codes, sales }, seconds: Math.round((Date.now() - t0) / 1000)
}))
db.close()

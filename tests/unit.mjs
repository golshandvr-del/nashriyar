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
  stdin: { contents: "export { healthVerdict } from './src/server/insights'\nexport { linearFit, termBounds } from './src/shared/fa'\nexport { reminderMark, DEADLINE_MARKS, LICENSE_MARKS } from './src/server/lib/reminders'\nexport { redactText, scrubPersonal, scoreCategories, templateCaption } from './src/server/ai'\nexport { mapQuestion, sanitizeRoute } from './src/shared/askmap'\nexport { ruleHypotheses } from './src/server/lib/explain'\nexport { cursorPage } from './src/server/lib/util'\nexport { csvToRows, buildXlsx } from './src/web/lib/xlsx'\nexport { writeDomains } from './src/server/lib/rollup'", resolveDir: process.cwd(), loader: 'ts' },
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
console.log(`unit: ${n} passed`)

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
  stdin: { contents: "export { healthVerdict } from './src/server/insights'\nexport { linearFit, termBounds } from './src/shared/fa'\nexport { reminderMark, DEADLINE_MARKS, LICENSE_MARKS } from './src/server/lib/reminders'\nexport { redactText, scrubPersonal } from './src/server/ai'\nexport { mapQuestion, sanitizeRoute } from './src/shared/askmap'", resolveDir: process.cwd(), loader: 'ts' },
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
console.log(`unit: ${n} passed`)

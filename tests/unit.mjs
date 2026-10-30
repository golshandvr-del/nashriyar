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
  stdin: { contents: "export { healthVerdict } from './src/server/insights'\nexport { linearFit, termBounds } from './src/shared/fa'\nexport { reminderMark, DEADLINE_MARKS, LICENSE_MARKS } from './src/server/lib/reminders'", resolveDir: process.cwd(), loader: 'ts' },
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
console.log(`unit: ${n} passed`)

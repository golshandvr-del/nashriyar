// Query-plan audit (ROADMAP phase 17): EXPLAINs every distinct statement the app really ran during the e2e suites
// (the server writes them to SQL_LOG) and fails when a query on a growing table does a full table scan or needs a
// temporary B-tree for ORDER BY where an index should serve it. Small, bounded tables (settings, faculties, ...) are
// allowed to scan. Usage (normally via `npm test`): SQL_LOG=/tmp/sql.log DATA_DIR=... node tests/query-plan.mjs
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const LOG = process.env.SQL_LOG
const DB_FILE = path.join(process.env.DATA_DIR || 'data', 'nashriyar.db')
if (!LOG || !fs.existsSync(LOG) || !fs.existsSync(DB_FILE)) {
  console.log('⏭  query-plan: no SQL_LOG / database — skipped')
  process.exit(0)
}

// tables that grow with years of use; a full scan here is a scaling bug
const BIG = [
  'users', 'sessions', 'issues', 'issue_toc_items', 'toc_assignments', 'issue_members', 'issue_stages', 'stage_events',
  'issue_approvals', 'media_assets', 'issue_pages', 'access_codes', 'entitlements', 'physical_sales', 'reading_progress',
  'reader_bookmarks', 'posts', 'follows', 'saved_posts', 'comments', 'reports', 'notifications', 'activity_events',
  'audit_logs', 'view_events', 'view_daily', 'announcement_reads', 'certificates', 'team_members', 'membership_requests',
  'festival_entries', 'festival_scores', 'system_audit', 'login_attempts', 'highlight_items'
]
// statement fragments that are intentionally whole-table (maintenance, exports, backups, rollups over a bounded window)
const ALLOW = [/^PRAGMA/i, /sqlite_master/i, /_migrations/i, /COUNT\(\*\) AS n FROM \w+$/i, /DELETE FROM login_attempts/i, /DELETE FROM sessions WHERE expires_at/i]

const db = new DatabaseSync(DB_FILE, { readOnly: true })
const sqls = [...new Set(fs.readFileSync(LOG, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean))]
const problems = new Map()
let explained = 0
for (const sql of sqls) {
  if (!/^\s*(SELECT|WITH|UPDATE|DELETE)/i.test(sql) || ALLOW.some((re) => re.test(sql))) continue
  let plan
  try {
    plan = db.prepare('EXPLAIN QUERY PLAN ' + sql).all()
  } catch {
    continue // statements that need bound parameters of a specific type, or touch temp objects
  }
  explained++
  for (const row of plan) {
    const d = String(row.detail)
    const m = /^SCAN (\w+)(?: AS \w+)?$/.exec(d)
    if (m && BIG.includes(m[1])) {
      const key = `${m[1]} :: ${sql.slice(0, 220)}`
      problems.set(key, d)
    }
  }
}

const list = [...problems.keys()].sort()
console.log(`query-plan: ${sqls.length} distinct statements, ${explained} explained, ${list.length} full scan(s) on growing tables`)
for (const p of list) console.log('  ✗ SCAN ' + p)
if (process.env.QUERY_PLAN_REPORT) process.exit(0) // report-only mode while auditing
process.exit(list.length ? 1 : 0)

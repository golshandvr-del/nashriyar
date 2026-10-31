// Periodic maintenance (ROADMAP phase 11: "replace the lazy rollup with a real server cron").
// One idempotent job used by both runtimes:
//  - Cloudflare: still lazy (rollup/reminders run on the first relevant request of the day).
//  - Self-hosted Node: entry/node.ts runs runMaintenance() on an in-process schedule (hourly) and the
//    daily backup at BACKUP_HOUR; `node server-dist/node.mjs --maintenance` runs it once (for host cron).
import type { Db } from '../adapters/db'
import { ensureRollup } from './rollup'
import { ensureReminders } from './reminders'
import { nowIso, setSetting } from './util'

export interface MaintenanceReport {
  rollup_until: string | null
  reminders: boolean
  sessions_purged: number
  cache_purged: number
  login_attempts_purged: number
  stories_expired: number
  at: string
}

const DAY = 86400_000

async function count(db: Db, sql: string, params: unknown[]): Promise<number> {
  return (await db.first<{ n: number }>(sql, params))?.n ?? 0
}

export async function runMaintenance(db: Db): Promise<MaintenanceReport> {
  const now = nowIso()
  const rollup_until = await ensureRollup(db, 400).catch(() => null)
  const reminders = await ensureReminders(db).catch(() => false)

  // Sessions expired or revoked more than 7 days ago (kept briefly for the "active sessions" audit view).
  const old = new Date(Date.now() - 7 * DAY).toISOString()
  const sessions_purged = await count(db, 'SELECT COUNT(*) AS n FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)', [old, old])
  if (sessions_purged) await db.run('DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)', [old, old])

  const cache_purged = await count(db, 'SELECT COUNT(*) AS n FROM analytics_cache WHERE expires_at <= ?', [now])
  if (cache_purged) await db.run('DELETE FROM analytics_cache WHERE expires_at <= ?', [now])

  // Rate-limit windows older than a day that are not currently locked.
  const dayAgo = new Date(Date.now() - DAY).toISOString()
  const login_attempts_purged = await count(db, 'SELECT COUNT(*) AS n FROM login_attempts WHERE window_start < ? AND (locked_until IS NULL OR locked_until < ?)', [dayAgo, now])
  if (login_attempts_purged) await db.run('DELETE FROM login_attempts WHERE window_start < ? AND (locked_until IS NULL OR locked_until < ?)', [dayAgo, now])

  // Stories past their 24h are already hidden by every query; count them for the report only (they stay in
  // the team's archive and in analytics).
  const stories_expired = await count(db, "SELECT COUNT(*) AS n FROM posts WHERE is_story = 1 AND status = 'published' AND expires_at <= ?", [now])

  const report: MaintenanceReport = { rollup_until, reminders, sessions_purged, cache_purged, login_attempts_purged, stories_expired, at: now }
  await setSetting(db, 'maintenance_last', report)
  return report
}

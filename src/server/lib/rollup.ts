// Analytics infrastructure (ROADMAP phase 7, docs/ANALYTICS.md):
//  - lazy daily rollup of view_events into view_daily (no cron: runs on the first analytics request of a new day)
//  - short-lived result cache (analytics_cache) keyed by viewer scope + path + query
import type { Db } from '../adapters/db'
import { getSetting, nowIso, setSetting } from './util'

const DAY = 86400_000
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10)

/**
 * Aggregate every finished day (up to yesterday, UTC) that has not been rolled up yet.
 * Bounded to `maxDays` per call so a long backlog never blows the per-request CPU budget;
 * the remainder is picked up by the next request. Returns the last rolled-up day.
 */
export async function ensureRollup(db: Db, maxDays = 120): Promise<string | null> {
  const yesterday = isoDay(Date.now() - DAY)
  let last = await getSetting<string | null>(db, 'analytics_rollup_until', null)
  if (!last) {
    const first = await db.first<{ d: string | null }>('SELECT MIN(day) AS d FROM view_events')
    if (!first?.d) return null
    last = isoDay(new Date(first.d + 'T00:00:00Z').getTime() - DAY)
  }
  if (last >= yesterday) return last
  const until = [isoDay(new Date(last + 'T00:00:00Z').getTime() + maxDays * DAY), yesterday].sort()[0]
  await db.batch([
    { sql: 'DELETE FROM view_daily WHERE day > ? AND day <= ?', params: [last, until] },
    {
      sql: `INSERT INTO view_daily (day, publication_id, entity_type, n, uniq)
            SELECT day, COALESCE(publication_id, ''), entity_type, COUNT(*), COUNT(DISTINCT COALESCE(viewer_hash, user_id, id))
            FROM view_events WHERE day > ? AND day <= ? GROUP BY day, COALESCE(publication_id, ''), entity_type`,
      params: [last, until]
    }
  ])
  await setSetting(db, 'analytics_rollup_until', until)
  return until
}

/** Read a cached JSON body (null when missing/expired). */
export async function cacheGet(db: Db, key: string): Promise<string | null> {
  const r = await db.first<{ value: string }>('SELECT value FROM analytics_cache WHERE key = ? AND expires_at > ?', [key, nowIso()])
  return r?.value ?? null
}

/** Store a JSON body for `ttlSec` seconds; occasionally purges expired rows. */
export async function cachePut(db: Db, key: string, value: string, ttlSec = 300) {
  if (value.length > 900_000) return // never cache oversized payloads
  const exp = new Date(Date.now() + ttlSec * 1000).toISOString()
  await db.run(
    'INSERT INTO analytics_cache (key, value, expires_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at',
    [key, value, exp]
  )
  if (Math.random() < 0.05) await db.run('DELETE FROM analytics_cache WHERE expires_at <= ?', [nowIso()])
}

/** Drop every cached analytics result (e.g. after settings that change scoring weights). */
export async function cacheClear(db: Db) {
  await db.run('DELETE FROM analytics_cache')
}

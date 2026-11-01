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

// ───────── Targeted invalidation (ROADMAP phase 17) ─────────
// Each analytics report depends on a few data domains. Every domain has a generation counter (settings
// `analytics_cache_gen`); the cache key of a report embeds the generations of its domains, so a write that bumps
// one domain makes exactly the dependent reports miss — other cached reports stay warm. No DELETE storm, no stale
// numbers after a write. `views` is bumped by the (nightly) rollup only: raw view tracking never invalidates.
export const CACHE_DOMAINS = ['content', 'sales', 'social', 'people', 'settings', 'views'] as const
export type CacheDomain = (typeof CACHE_DOMAINS)[number]
const GEN_KEY = 'analytics_cache_gen'

export async function cacheGens(db: Db): Promise<Record<CacheDomain, number>> {
  const g = await getSetting<Partial<Record<CacheDomain, number>>>(db, GEN_KEY, {})
  const out = {} as Record<CacheDomain, number>
  for (const d of CACHE_DOMAINS) out[d] = Number(g?.[d]) || 0
  return out
}

/**
 * Bump the generation of the given domains in ONE statement (json_set on the stored object), so concurrent writers
 * never lose an increment. Domain names come from the fixed CACHE_DOMAINS list, never from input.
 */
export async function bumpCache(db: Db, domains: readonly CacheDomain[]) {
  const ds = [...new Set(domains)].filter((d) => (CACHE_DOMAINS as readonly string[]).includes(d))
  if (!ds.length) return
  const sets = ds.map((d) => `'$.${d}', COALESCE(json_extract(value, '$.${d}'), 0) + 1`).join(', ')
  await db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = json_set(value, ${sets}), updated_at = excluded.updated_at`,
    [GEN_KEY, JSON.stringify(Object.fromEntries(ds.map((d) => [d, 1]))), nowIso()]
  )
}

/** Which domains a successful API write touches. Unknown writes conservatively bump everything. */
export function writeDomains(method: string, path: string): CacheDomain[] {
  const ALL = [...CACHE_DOMAINS].filter((d) => d !== 'views') as CacheDomain[]
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return []
  const p = path.replace(/^\/api(?:\/v\d+)?/, '')
  // high-volume or analytics-neutral writes
  if (/^\/(public\/track|auth\/(login|logout|totp|password)|me\/notifications|me\/library|analytics\/|festivals\/)/.test(p)) return []
  if (p.startsWith('/auth/')) return ['people'] // registration, recovery
  if (/^\/team\/[^/]+\/(codes|physical-sales)/.test(p)) return ['sales']
  if (/^\/team\/[^/]+\/(posts|comments|highlights|captions|keywords|categories\/suggest)/.test(p)) return ['social', 'content']
  if (p.startsWith('/team/') || p.startsWith('/media/') || p.startsWith('/desk/')) return ['content']
  if (p.startsWith('/me/codes/')) return ['sales']
  if (/^\/me\/(follows|saved|posts|reports)/.test(p)) return ['social']
  if (/^\/me\/(profile|delete-account)/.test(p)) return ['people', 'content']
  if (p.startsWith('/me/sections/')) return ['content']
  if (p.startsWith('/membership/')) return ['content', 'people']
  if (/^\/admin\/(comments|posts|reports)/.test(p)) return ['social']
  if (/^\/admin\/(users|registration)/.test(p)) return ['people']
  if (p.startsWith('/admin/settings')) return [...ALL, 'views'] // weights/thresholds change every score
  return [...ALL, 'views']
}

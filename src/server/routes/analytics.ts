import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { MONITOR_ROLES } from '../context'
import { requireRole } from '../auth'
import { cacheGens, cacheGet, cachePut, ensureRollup, type CacheDomain } from '../lib/rollup'
import { pubScope } from '../domains/analytics/service'
// re-exported for modules that historically imported the scope helper from this file
export { pubScope }
import { archiveRoutes } from '../domains/analytics/archive'
import { visualsRoutes } from '../domains/analytics/visuals'
import { insightsRoutes } from '../domains/analytics/insights'
import { overviewRoutes } from '../domains/analytics/overview'
import { productionRoutes } from '../domains/analytics/production'
import { engagementRoutes } from '../domains/analytics/engagement'
import { exportRoutes } from '../domains/analytics/export'
import { aiRoutes } from '../domains/analytics/ai'

export const analyticsRoutes = new Hono<AppEnv>()

analyticsRoutes.use('*', async (c, next) => {
  requireRole(c, MONITOR_ROLES)
  await next()
})

// ROADMAP phase 7 infrastructure: lazy daily rollup (no cron) + 5-minute result cache for read-only reports.
// Cache key includes the viewer's role and faculty scope, so a faculty supervisor never sees another scope's numbers.
// /academic-years and /archive/ read stored snapshots (already cheap) and must see a freshly frozen year at once
const NO_CACHE = ['/live', '/insights', '/ai/', '/academic-years', '/archive/']
// ROADMAP phase 17: data domains each report reads. The cache key embeds those domains' generation counters, so a
// write only invalidates the reports that depend on it (lib/rollup.ts → writeDomains/bumpCache). Unlisted → all.
const ALL_DOMAINS: CacheDomain[] = ['content', 'sales', 'social', 'people', 'settings', 'views']
const REPORT_DOMAINS: Record<string, CacheDomain[]> = {
  '/forecast': ['content'],
  '/production': ['content', 'people'],
  '/gaps': ['content', 'people'],
  '/sales': ['sales', 'content'],
  '/trends': ['content', 'sales', 'social', 'views'],
  '/explore': ['social', 'sales', 'content', 'views'],
  '/directors': ['content', 'sales', 'social', 'people', 'views']
}
const reportDomains = (pathname: string) => {
  const sub = pathname.replace(/^\/api(?:\/v\d+)?\/analytics/, '')
  return REPORT_DOMAINS[sub] || ALL_DOMAINS
}
analyticsRoutes.use('*', async (c, next) => {
  if (c.req.method !== 'GET') return next()
  const db = c.get('db')
  try {
    await ensureRollup(db)
  } catch {
    /* rollup is an optimisation; never block a report */
  }
  const url = new URL(c.req.url)
  if (NO_CACHE.some((p) => url.pathname.includes(p)) || url.searchParams.has('fresh')) return next()
  const u = c.get('user')!
  const gens = await cacheGens(db).catch(() => null)
  const domains = reportDomains(url.pathname)
  const genTag = gens ? domains.map((d) => `${d[0]}${gens[d]}`).join('.') : `t${Date.now()}`
  // version prefix stripped: /api/v1/analytics/x and /api/analytics/x share one entry
  const path = url.pathname.replace(/^\/api\/v\d+\//, '/api/')
  const key = `${u.system_role}:${u.scope_faculty_id || ''}:${genTag}:${path}?${[...url.searchParams].sort().map(([k, v]) => `${k}=${v}`).join('&')}`
  const hit = await cacheGet(db, key).catch(() => null)
  if (hit) {
    const isCsv = url.pathname.endsWith('.csv')
    return c.body(hit, 200, { 'Content-Type': isCsv ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8', 'X-Cache': 'hit' })
  }
  await next()
  if (c.res.status === 200) {
    const text = await c.res.clone().text()
    // exact invalidation makes long TTLs safe; reports that include today's raw views stay short-lived
    await cachePut(db, key, text, domains.includes('views') ? 300 : 6 * 3600).catch(() => {})
  }
})

// domain modules (ROADMAP phase 17): mounted after the guard/cache middleware so both apply
analyticsRoutes.route('/', archiveRoutes)

// domain module (ROADMAP phase 17): ../domains/analytics/overview
analyticsRoutes.route('/', overviewRoutes)

// domain module (ROADMAP phase 17): ../domains/analytics/production
analyticsRoutes.route('/', productionRoutes)

// domain module (ROADMAP phase 17): ../domains/analytics/engagement
analyticsRoutes.route('/', engagementRoutes)

// domain module (ROADMAP phase 17): ../domains/analytics/insights
analyticsRoutes.route('/', insightsRoutes)

// domain module (ROADMAP phase 17): ../domains/analytics/export
analyticsRoutes.route('/', exportRoutes)

// domain module (ROADMAP phase 17): ../domains/analytics/visuals
analyticsRoutes.route('/', visualsRoutes)

// domain module (ROADMAP phase 17): ../domains/analytics/ai
analyticsRoutes.route('/', aiRoutes)


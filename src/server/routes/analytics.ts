import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { MONITOR_ROLES } from '../context'
import { requireRole } from '../auth'
import { body, dateRange } from '../lib/util'
import { computeInsights } from '../insights'
import { aiNarrative, aiAsk } from '../ai'
import { mapQuestion, ASK_REPORT_LABELS } from '../../shared/askmap'
import { cacheGens, cacheGet, cachePut, ensureRollup, type CacheDomain } from '../lib/rollup'
import { kpis, previousRange, pubScope, pubViewsParams, pubViewsSql, rolledUntil } from '../domains/analytics/service'
// re-exported for modules that historically imported the scope helper from this file
export { pubScope }
import { archiveRoutes } from '../domains/analytics/archive'
import { visualsRoutes } from '../domains/analytics/visuals'
import { insightsRoutes } from '../domains/analytics/insights'
import { overviewRoutes } from '../domains/analytics/overview'
import { productionRoutes } from '../domains/analytics/production'
import { engagementRoutes } from '../domains/analytics/engagement'

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

/** CSV export of the ranking (opened in Excel; UTF-8 BOM for Persian). */
analyticsRoutes.get('/export/ranking.csv', async (c) => {
  const db = c.get('db')
  const s = pubScope(c)
  const { from, to } = dateRange(c, 365)
  const rows = await db.all<any>(
    `SELECT p.title, f.name AS faculty, (SELECT COUNT(*) FROM issues i WHERE i.publication_id = p.id AND i.status IN ('published','archived') AND substr(i.published_at,1,10) BETWEEN ? AND ?) AS published,
       ${pubViewsSql()} AS views,
       (SELECT COUNT(*) FROM follows fo WHERE fo.publication_id = p.id AND fo.unfollowed_at IS NULL) AS followers,
       (SELECT COUNT(*) FROM access_codes ac WHERE ac.publication_id = p.id AND substr(ac.redeemed_at,1,10) BETWEEN ? AND ?) AS digital_sold
     FROM publications p LEFT JOIN faculties f ON f.id = p.faculty_id WHERE p.deleted_at IS NULL${s.sql} ORDER BY published DESC`,
    [from, to, ...pubViewsParams(from, to, await rolledUntil(c)), from, to, ...s.params]
  )
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = '\uFEFF' + ['نشریه,دانشکده,شماره‌های منتشرشده,بازدید,دنبال‌کننده,فروش دیجیتال', ...rows.map((r) => [r.title, r.faculty, r.published, r.views, r.followers, r.digital_sold].map(esc).join(','))].join('\r\n')
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ranking-${from}-${to}.csv"` } })
})

// domain module (ROADMAP phase 17): ../domains/analytics/visuals
analyticsRoutes.route('/', visualsRoutes)

// ───────── Optional AI layer (Phase 10) — disabled unless configured ─────────
analyticsRoutes.post('/ai/narrative', async (c) => {
  const { from, to } = dateRange(c, 90)
  const { pFrom, pTo } = previousRange(from, to)
  const data = { from, to, current: await kpis(c, from, to), previous: await kpis(c, pFrom, pTo), insights: (await computeInsights(c.get('db'), pubScope(c))).slice(0, 10) }
  return c.json(await aiNarrative(c, data))
})

/**
 * Persian statistical Q&A (ROADMAP phase 10): the question is first mapped — deterministically, from
 * whitelists only (src/shared/askmap.ts) — to one of the predefined reports + range (+ faculty). The UI
 * opens that report with the normal dashboard components. No free SQL is ever generated. The optional AI
 * only adds a short narrative over the same aggregated KPIs.
 */
analyticsRoutes.post('/ai/ask', async (c) => {
  const b = await body<{ question?: string }>(c)
  const question = String(b.question || '').slice(0, 500)
  const u = c.get('user')!
  const faculties = await c.get('db').all<{ id: string; name: string }>(
    u.system_role === 'faculty_supervisor' ? 'SELECT id, name FROM faculties WHERE id = ?' : 'SELECT id, name FROM faculties',
    u.system_role === 'faculty_supervisor' ? [u.scope_faculty_id] : []
  )
  const route = mapQuestion(question, faculties)
  const { from, to } = dateRange(c, 365)
  const data = { from, to, report: ASK_REPORT_LABELS[route.report], kpis: await kpis(c, from, to) }
  const ai = await aiAsk(c, question, data)
  return c.json({ ...ai, route: { ...route, label: ASK_REPORT_LABELS[route.report] } })
})

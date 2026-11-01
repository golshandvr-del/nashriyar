import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { MONITOR_ROLES } from '../context'
import { requireRole } from '../auth'
import { body, dateRange, nowIso, parseJson } from '../lib/util'
import { computeInsights } from '../insights'
import { aiNarrative, aiAsk } from '../ai'
import { mapQuestion, ASK_REPORT_LABELS } from '../../shared/askmap'
import { cacheGens, cacheGet, cachePut, ensureRollup, type CacheDomain } from '../lib/rollup'
import { kpis, previousRange, pubScope, pubViewsParams, pubViewsSql, rolledUntil, viewSeries } from '../domains/analytics/service'
// re-exported for modules that historically imported the scope helper from this file
export { pubScope }
import { archiveRoutes } from '../domains/analytics/archive'
import { visualsRoutes } from '../domains/analytics/visuals'
import { insightsRoutes } from '../domains/analytics/insights'
import { overviewRoutes } from '../domains/analytics/overview'
import { productionRoutes } from '../domains/analytics/production'

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

/** Explore analytics: posts, engagement, top posts, comment moderation speed. */
analyticsRoutes.get('/explore', async (c) => {
  const db = c.get('db')
  const s = pubScope(c)
  const { from, to } = dateRange(c, 90)
  const fromTs = from + 'T00:00:00.000Z'
  const toTs = to + 'T23:59:59.999Z'
  const top = await db.all<any>(
    `SELECT po.id, po.images_json, po.caption, p.title AS publication_title, COUNT(v.id) AS views,
       (SELECT COUNT(*) FROM saved_posts sp WHERE sp.post_id = po.id) AS saves, (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = po.id AND cm.status = 'approved') AS comments
     FROM posts po JOIN publications p ON p.id = po.publication_id LEFT JOIN view_events v ON v.entity_type = 'post' AND v.entity_id = po.id AND v.day BETWEEN ? AND ?
     WHERE po.status = 'published'${s.sql} GROUP BY po.id ORDER BY views DESC LIMIT 12`,
    [from, to, ...s.params]
  )
  const byPub = await db.all(
    `SELECT p.title, COUNT(DISTINCT po.id) AS posts, ${pubViewsSql('post')} AS views
     FROM publications p LEFT JOIN posts po ON po.publication_id = p.id AND po.published_at BETWEEN ? AND ? WHERE p.deleted_at IS NULL${s.sql} GROUP BY p.id ORDER BY views DESC`,
    [...pubViewsParams(from, to, await rolledUntil(c)), fromTs, toTs, ...s.params]
  )
  const moderation = await db.first(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN cm.status='pending' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN cm.status='approved' THEN 1 ELSE 0 END) AS approved,
       SUM(CASE WHEN cm.status IN ('rejected','spam') THEN 1 ELSE 0 END) AS rejected, AVG(CASE WHEN cm.moderated_at IS NOT NULL THEN (julianday(cm.moderated_at) - julianday(cm.created_at)) * 24 END) AS avg_hours
     FROM comments cm JOIN posts po ON po.id = cm.post_id JOIN publications p ON p.id = po.publication_id WHERE cm.is_team_reply = 0 AND cm.created_at BETWEEN ? AND ?${s.sql}`,
    [fromTs, toTs, ...s.params]
  )
  // Funnel (ROADMAP phase 6/8): explore post view -> issue page -> reading -> purchase (unique viewers per step)
  // ONE pass over the range for every distinct-viewer figure (ROADMAP phase 17: was five scans of raw view_events)
  const FUNNEL_TYPES = ['post', 'post_read_full', 'issue', 'issue_read'] as const
  const uq = await db.first<Record<string, number>>(
    `SELECT COUNT(*) AS views, COUNT(DISTINCT v.viewer_hash) AS uniq,
       ${FUNNEL_TYPES.map((t) => `COUNT(DISTINCT CASE WHEN v.entity_type = '${t}' THEN v.viewer_hash END) AS u_${t}`).join(', ')}
     FROM view_events v JOIN publications p ON p.id = v.publication_id WHERE v.day BETWEEN ? AND ?${s.sql}`,
    [from, to, ...s.params]
  )
  const uniq = async (type: (typeof FUNNEL_TYPES)[number]) => Number(uq?.[`u_${type}`] ?? 0)
  const bought = Number((await db.first<{ n: number }>(`SELECT COUNT(DISTINCT ac.redeemed_by) AS n FROM access_codes ac JOIN publications p ON p.id = ac.publication_id WHERE ac.redeemed_at BETWEEN ? AND ?${s.sql}`, [fromTs, toTs, ...s.params]))?.n ?? 0)
  // Weekday × hour heatmap (Tehran local time, UTC+03:30) and daily calendar heatmap (ROADMAP phase 7)
  const hourly = await db.all<{ d: number; h: number; n: number }>(
    `SELECT CAST(strftime('%w', datetime(v.created_at, '+210 minutes')) AS INTEGER) AS d, CAST(strftime('%H', datetime(v.created_at, '+210 minutes')) AS INTEGER) AS h, COUNT(*) AS n
     FROM view_events v JOIN publications p ON p.id = v.publication_id WHERE v.day BETWEEN ? AND ?${s.sql} GROUP BY d, h`,
    [from, to, ...s.params]
  )
  const calendar = (await viewSeries(c, from, to, 'v.day')).map((r) => ({ day: String(r.k), n: r.n }))
  const funnel = [
    { key: 'post', label: 'دیدن پست اکسپلور', n: await uniq('post') },
    { key: 'post_read_full', label: 'کلیک «خواندن کامل»', n: await uniq('post_read_full') },
    { key: 'issue', label: 'ورود به صفحهٔ شماره', n: await uniq('issue') },
    { key: 'issue_read', label: 'شروع خواندن', n: await uniq('issue_read') },
    { key: 'purchase', label: 'خرید (بازخرید کد)', n: bought }
  ]
  // Public-space totals + most viewed categories/associations (ROADMAP phase 7)
  const totals = { views: Number(uq?.views ?? 0), uniq: Number(uq?.uniq ?? 0) }
  const byCategory = await db.all(
    `SELECT cat.id, cat.name, COUNT(v.id) AS views, COUNT(DISTINCT v.viewer_hash) AS uniq
     FROM view_events v JOIN publications p ON p.id = v.publication_id JOIN publication_categories pc ON pc.publication_id = p.id JOIN categories cat ON cat.id = pc.category_id
     WHERE cat.type = 'subject' AND v.day BETWEEN ? AND ?${s.sql} GROUP BY cat.id ORDER BY views DESC LIMIT 12`,
    [from, to, ...s.params]
  )
  const byAssociation = await db.all(
    `SELECT a.id, a.name, a.kind, COUNT(v.id) AS views, COUNT(DISTINCT v.viewer_hash) AS uniq
     FROM view_events v JOIN publications p ON p.id = v.publication_id JOIN associations a ON a.id = p.association_id
     WHERE v.day BETWEEN ? AND ?${s.sql} GROUP BY a.id ORDER BY views DESC LIMIT 12`,
    [from, to, ...s.params]
  )
  return c.json({ from, to, totals, byCategory, byAssociation, top: top.map((r) => ({ ...r, image: parseJson<string[]>(r.images_json, [])[0] || null, images_json: undefined })), byPub, moderation, funnel, hourly, calendar })
})

/** Sales: digital codes and print, by publication and issue. */
analyticsRoutes.get('/sales', async (c) => {
  const db = c.get('db')
  const s = pubScope(c)
  const { from, to } = dateRange(c, 365)
  const fromTs = from + 'T00:00:00.000Z'
  const toTs = to + 'T23:59:59.999Z'
  const byIssue = await db.all(
    `SELECT i.id, i.number, i.title, i.price_digital, i.print_run, p.title AS publication_title,
       (SELECT COUNT(*) FROM access_codes ac WHERE ac.issue_id = i.id AND ac.created_at BETWEEN ? AND ?) AS codes_created,
       (SELECT COUNT(*) FROM access_codes ac WHERE ac.issue_id = i.id AND ac.redeemed_at BETWEEN ? AND ?) AS codes_redeemed,
       (SELECT COUNT(*) FROM access_codes ac WHERE ac.issue_id = i.id AND ac.redeemed_at IS NULL AND ac.revoked_at IS NULL AND ac.expires_at < ? AND ac.created_at BETWEEN ? AND ?) AS codes_expired,
       (SELECT COALESCE(SUM(price_paid),0) FROM access_codes ac WHERE ac.issue_id = i.id AND ac.redeemed_at BETWEEN ? AND ?) AS revenue_digital,
       (SELECT COALESCE(SUM(quantity),0) FROM physical_sales ps WHERE ps.issue_id = i.id AND ps.sold_at BETWEEN ? AND ?) AS print_sold
     FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.pricing = 'paid' AND i.status IN ('published','archived')${s.sql} ORDER BY revenue_digital DESC LIMIT 100`,
    [fromTs, toTs, fromTs, toTs, nowIso(), fromTs, toTs, fromTs, toTs, from, to, ...s.params]
  )
  const channels = await db.all(
    `SELECT COALESCE(ac.channel,'other') AS channel, COUNT(*) AS n FROM access_codes ac JOIN publications p ON p.id = ac.publication_id WHERE ac.redeemed_at BETWEEN ? AND ?${s.sql} GROUP BY channel`,
    [fromTs, toTs, ...s.params]
  )
  // Totals, breakdowns and monthly trend (ROADMAP phase 7 sales)
  const now = nowIso()
  const codes = await db.first<any>(
    `SELECT COUNT(*) AS created,
       SUM(CASE WHEN ac.redeemed_at IS NOT NULL THEN 1 ELSE 0 END) AS redeemed,
       SUM(CASE WHEN ac.redeemed_at IS NULL AND ac.revoked_at IS NULL AND ac.expires_at < ? THEN 1 ELSE 0 END) AS expired,
       SUM(CASE WHEN ac.revoked_at IS NOT NULL THEN 1 ELSE 0 END) AS revoked
     FROM access_codes ac JOIN publications p ON p.id = ac.publication_id WHERE ac.created_at BETWEEN ? AND ?${s.sql}`,
    [now, fromTs, toTs, ...s.params]
  )
  const revenue = await db.first<any>(
    `SELECT COALESCE(SUM(ac.price_paid),0) AS digital FROM access_codes ac JOIN publications p ON p.id = ac.publication_id WHERE ac.redeemed_at BETWEEN ? AND ?${s.sql}`,
    [fromTs, toTs, ...s.params]
  )
  const print = await db.first<any>(
    `SELECT COALESCE(SUM(ps.quantity),0) AS qty, COALESCE(SUM(ps.quantity * COALESCE(ps.unit_price,0)),0) AS revenue
     FROM physical_sales ps JOIN publications p ON p.id = ps.publication_id WHERE ps.sold_at BETWEEN ? AND ?${s.sql}`,
    [from, to + 'T23:59:59', ...s.params]
  )
  const created = Number(codes?.created || 0)
  const totals = {
    codes_created: created,
    codes_redeemed: Number(codes?.redeemed || 0),
    codes_expired: Number(codes?.expired || 0),
    codes_revoked: Number(codes?.revoked || 0),
    use_rate: created ? Math.round((Number(codes?.redeemed || 0) / created) * 1000) / 10 : 0,
    revenue_digital: Number(revenue?.digital || 0),
    print_sold: Number(print?.qty || 0),
    revenue_print: Number(print?.revenue || 0)
  }
  const byPublication = await db.all(
    `SELECT p.id, p.title, COUNT(ac.id) AS sold, COALESCE(SUM(ac.price_paid),0) AS revenue,
       (SELECT COALESCE(SUM(quantity),0) FROM physical_sales ps WHERE ps.publication_id = p.id AND ps.sold_at BETWEEN ? AND ?) AS print_sold
     FROM publications p LEFT JOIN access_codes ac ON ac.publication_id = p.id AND ac.redeemed_at BETWEEN ? AND ?
     WHERE p.deleted_at IS NULL${s.sql} GROUP BY p.id HAVING sold > 0 OR print_sold > 0 ORDER BY revenue DESC`,
    [from, to + 'T23:59:59', fromTs, toTs, ...s.params]
  )
  const byFaculty = await db.all(
    `SELECT f.id, COALESCE(f.name, 'بدون دانشکده') AS name, COUNT(ac.id) AS sold, COALESCE(SUM(ac.price_paid),0) AS revenue
     FROM access_codes ac JOIN publications p ON p.id = ac.publication_id LEFT JOIN faculties f ON f.id = p.faculty_id
     WHERE ac.redeemed_at BETWEEN ? AND ?${s.sql} GROUP BY f.id ORDER BY revenue DESC`,
    [fromTs, toTs, ...s.params]
  )
  const byCategory = await db.all(
    `SELECT cat.id, cat.name, COUNT(DISTINCT ac.id) AS sold, COALESCE(SUM(ac.price_paid),0) AS revenue
     FROM access_codes ac JOIN publications p ON p.id = ac.publication_id JOIN publication_categories pc ON pc.publication_id = p.id JOIN categories cat ON cat.id = pc.category_id
     WHERE cat.type = 'subject' AND ac.redeemed_at BETWEEN ? AND ?${s.sql} GROUP BY cat.id ORDER BY revenue DESC LIMIT 12`,
    [fromTs, toTs, ...s.params]
  )
  const monthly = await db.all(
    `SELECT substr(ac.redeemed_at,1,7) AS m, COUNT(*) AS sold, COALESCE(SUM(ac.price_paid),0) AS revenue
     FROM access_codes ac JOIN publications p ON p.id = ac.publication_id WHERE ac.redeemed_at BETWEEN ? AND ?${s.sql} GROUP BY m ORDER BY m`,
    [fromTs, toTs, ...s.params]
  )
  return c.json({ from, to, totals, byIssue, channels, byPublication, byFaculty, byCategory, monthly })
})

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

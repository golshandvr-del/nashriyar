import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../context'
import { MONITOR_ROLES } from '../context'
import { requireRole } from '../auth'
import { body, dateRange, getSetting, nowIso, parseJson } from '../lib/util'
import { computeInsights, getWeights, healthScores } from '../insights'
import { linearFit, termBounds } from '../../shared/fa'
import { aiNarrative, aiAsk } from '../ai'
import { mapQuestion, ASK_REPORT_LABELS } from '../../shared/askmap'
import { cacheGet, cachePut, ensureRollup } from '../lib/rollup'

export const analyticsRoutes = new Hono<AppEnv>()

analyticsRoutes.use('*', async (c, next) => {
  requireRole(c, MONITOR_ROLES)
  await next()
})

// ROADMAP phase 7 infrastructure: lazy daily rollup (no cron) + 5-minute result cache for read-only reports.
// Cache key includes the viewer's role and faculty scope, so a faculty supervisor never sees another scope's numbers.
const NO_CACHE = ['/live', '/insights', '/ai/']
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
  const key = `${u.system_role}:${u.scope_faculty_id || ''}:${url.pathname}?${[...url.searchParams].sort().map(([k, v]) => `${k}=${v}`).join('&')}`
  const hit = await cacheGet(db, key).catch(() => null)
  if (hit) {
    const isCsv = url.pathname.endsWith('.csv')
    return c.body(hit, 200, { 'Content-Type': isCsv ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8', 'X-Cache': 'hit' })
  }
  await next()
  if (c.res.status === 200) {
    const text = await c.res.clone().text()
    await cachePut(db, key, text, 300).catch(() => {})
  }
})

/** Faculty supervisors are restricted to their own faculty. */
export function pubScope(c: Context<AppEnv>, alias = 'p') {
  const u = c.get('user')!
  const q = (k: string) => (c.req.query(k) || '').slice(0, 64)
  let sql = ''
  const params: unknown[] = []
  const add = (frag: string, v: unknown) => {
    sql += frag
    params.push(v)
  }
  if (u.system_role === 'faculty_supervisor') add(` AND ${alias}.faculty_id = ?`, u.scope_faculty_id)
  else if (q('faculty')) add(` AND ${alias}.faculty_id = ?`, q('faculty'))
  // global filters (ROADMAP phase 7), all kept in the URL by the dashboard
  if (q('owner_kind')) add(` AND ${alias}.association_id IN (SELECT id FROM associations WHERE kind = ?)`, q('owner_kind'))
  if (q('association')) add(` AND ${alias}.association_id = ?`, q('association'))
  if (q('publication')) add(` AND ${alias}.id = ?`, q('publication'))
  if (q('category')) add(` AND ${alias}.id IN (SELECT publication_id FROM publication_categories WHERE category_id = ?)`, q('category'))
  // free/paid: publications that publish issues of that pricing model
  if (q('pricing') === 'free' || q('pricing') === 'paid')
    add(` AND ${alias}.id IN (SELECT publication_id FROM issues WHERE pricing = ? AND deleted_at IS NULL)`, q('pricing'))
  return { sql, params }
}

const DAY = 86400_000
function previousRange(from: string, to: string) {
  const len = new Date(to).getTime() - new Date(from).getTime() + DAY
  const pTo = new Date(new Date(from).getTime() - DAY).toISOString().slice(0, 10)
  const pFrom = new Date(new Date(from).getTime() - len).toISOString().slice(0, 10)
  return { pFrom, pTo }
}

/**
 * View count over [from, to] (ROADMAP phase 7 rollup): finished days come from view_daily,
 * days after the rollup watermark (today / backlog) from raw view_events. Same scope rules as pubScope.
 */
async function viewCount(c: Context<AppEnv>, from: string, to: string, type?: string) {
  const db = c.get('db')
  const s = pubScope(c)
  const until = (await getSetting<string | null>(db, 'analytics_rollup_until', null)) || '0000-00-00'
  const t = type ? ' AND v.entity_type = ?' : ''
  const tp = type ? [type] : []
  const rolled = Number(
    (await db.first<{ n: number }>(
      `SELECT COALESCE(SUM(v.n),0) AS n FROM view_daily v JOIN publications p ON p.id = v.publication_id WHERE v.day BETWEEN ? AND ? AND v.day <= ?${t}${s.sql}`,
      [from, to, until, ...tp, ...s.params]
    ))?.n ?? 0
  )
  const raw = Number(
    (await db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM view_events v JOIN publications p ON p.id = v.publication_id WHERE v.day BETWEEN ? AND ? AND v.day > ?${t}${s.sql}`,
      [from, to, until, ...tp, ...s.params]
    ))?.n ?? 0
  )
  return rolled + raw
}

async function kpis(c: Context<AppEnv>, from: string, to: string) {
  const db = c.get('db')
  const s = pubScope(c)
  const fromTs = from + 'T00:00:00.000Z'
  const toTs = to + 'T23:59:59.999Z'
  const one = async (sql: string, params: unknown[]) => Number((await db.first<{ n: number }>(sql, params))?.n ?? 0)
  return {
    published: await one(`SELECT COUNT(*) AS n FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?${s.sql}`, [fromTs, toTs, ...s.params]),
    pages: await one(`SELECT COALESCE(SUM(i.page_count),0) AS n FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?${s.sql}`, [fromTs, toTs, ...s.params]),
    started: await one(`SELECT COUNT(*) AS n FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.deleted_at IS NULL AND i.created_at BETWEEN ? AND ?${s.sql}`, [fromTs, toTs, ...s.params]),
    views: await viewCount(c, from, to),
    reads: await viewCount(c, from, to, 'issue_read'),
    post_views: await viewCount(c, from, to, 'post'),
    new_followers: await one(`SELECT COUNT(*) AS n FROM follows f JOIN publications p ON p.id = f.publication_id WHERE f.created_at BETWEEN ? AND ?${s.sql}`, [fromTs, toTs, ...s.params]),
    digital_sold: await one(`SELECT COUNT(*) AS n FROM access_codes ac JOIN publications p ON p.id = ac.publication_id WHERE ac.redeemed_at BETWEEN ? AND ?${s.sql}`, [fromTs, toTs, ...s.params]),
    revenue_digital: await one(`SELECT COALESCE(SUM(ac.price_paid),0) AS n FROM access_codes ac JOIN publications p ON p.id = ac.publication_id WHERE ac.redeemed_at BETWEEN ? AND ?${s.sql}`, [fromTs, toTs, ...s.params]),
    print_sold: await one(`SELECT COALESCE(SUM(ps.quantity),0) AS n FROM physical_sales ps JOIN publications p ON p.id = ps.publication_id WHERE ps.sold_at BETWEEN ? AND ?${s.sql}`, [from, to, ...s.params]),
    revenue_print: await one(`SELECT COALESCE(SUM(ps.quantity * COALESCE(ps.unit_price,0)),0) AS n FROM physical_sales ps JOIN publications p ON p.id = ps.publication_id WHERE ps.sold_at BETWEEN ? AND ?${s.sql}`, [from, to, ...s.params]),
    comments: await one(`SELECT COUNT(*) AS n FROM comments cm JOIN posts po ON po.id = cm.post_id JOIN publications p ON p.id = po.publication_id WHERE cm.created_at BETWEEN ? AND ? AND cm.is_team_reply = 0${s.sql}`, [fromTs, toTs, ...s.params]),
    posts: await one(`SELECT COUNT(*) AS n FROM posts po JOIN publications p ON p.id = po.publication_id WHERE po.published_at BETWEEN ? AND ?${s.sql}`, [fromTs, toTs, ...s.params]),
    new_students: await one(`SELECT COUNT(*) AS n FROM users WHERE system_role = 'student' AND created_at BETWEEN ? AND ?`, [fromTs, toTs]),
    active_publications: await one(
      `SELECT COUNT(DISTINCT a.publication_id) AS n FROM activity_events a JOIN publications p ON p.id = a.publication_id
       WHERE a.created_at BETWEEN ? AND ? AND a.type IN ('issue.created','toc.status','stage.status','post.published','issue.approval_requested','codes.created')${s.sql}`,
      [fromTs, toTs, ...s.params]
    )
  }
}

/**
 * KPI sparklines (ROADMAP phase 7 overview): each key split into up to 24 equal buckets over [from, to].
 * Uses per-day GROUP BY queries, so cost is one query per key regardless of range length.
 */
async function sparklines(c: Context<AppEnv>, from: string, to: string) {
  const db = c.get('db')
  const s = pubScope(c)
  const t0 = new Date(from + 'T00:00:00Z').getTime()
  const days = Math.max(1, Math.round((new Date(to + 'T00:00:00Z').getTime() - t0) / DAY) + 1)
  const n = Math.min(24, days)
  const bucket = (day: string) => Math.min(n - 1, Math.floor(((new Date(day.slice(0, 10) + 'T00:00:00Z').getTime() - t0) / DAY) * (n / days)))
  const fill = (rows: { d: string; n: number }[]) => {
    const out = new Array(n).fill(0)
    for (const r of rows) if (r.d) out[bucket(r.d)] += Number(r.n) || 0
    return out
  }
  const fromTs = from + 'T00:00:00.000Z'
  const toTs = to + 'T23:59:59.999Z'
  const views = (type?: string) =>
    db.all<{ d: string; n: number }>(
      `SELECT v.day AS d, COUNT(*) AS n FROM view_events v JOIN publications p ON p.id = v.publication_id WHERE v.day BETWEEN ? AND ?${type ? ' AND v.entity_type = ?' : ''}${s.sql} GROUP BY v.day`,
      [from, to, ...(type ? [type] : []), ...s.params]
    )
  return {
    published: fill(await db.all(`SELECT substr(i.published_at,1,10) AS d, COUNT(*) AS n FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?${s.sql} GROUP BY d`, [fromTs, toTs, ...s.params])),
    pages: fill(await db.all(`SELECT substr(i.published_at,1,10) AS d, COALESCE(SUM(i.page_count),0) AS n FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?${s.sql} GROUP BY d`, [fromTs, toTs, ...s.params])),
    views: fill(await views()),
    reads: fill(await views('issue_read')),
    post_views: fill(await views('post')),
    new_followers: fill(await db.all(`SELECT substr(f.created_at,1,10) AS d, COUNT(*) AS n FROM follows f JOIN publications p ON p.id = f.publication_id WHERE f.created_at BETWEEN ? AND ?${s.sql} GROUP BY d`, [fromTs, toTs, ...s.params])),
    digital_sold: fill(await db.all(`SELECT substr(ac.redeemed_at,1,10) AS d, COUNT(*) AS n FROM access_codes ac JOIN publications p ON p.id = ac.publication_id WHERE ac.redeemed_at BETWEEN ? AND ?${s.sql} GROUP BY d`, [fromTs, toTs, ...s.params])),
    revenue_digital: fill(await db.all(`SELECT substr(ac.redeemed_at,1,10) AS d, COALESCE(SUM(ac.price_paid),0) AS n FROM access_codes ac JOIN publications p ON p.id = ac.publication_id WHERE ac.redeemed_at BETWEEN ? AND ?${s.sql} GROUP BY d`, [fromTs, toTs, ...s.params]))
  }
}

/** Main dashboard: KPIs with comparison to the previous equal-length period. */
analyticsRoutes.get('/summary', async (c) => {
  const { from, to } = dateRange(c, 365)
  const { pFrom, pTo } = previousRange(from, to)
  const cur = await kpis(c, from, to)
  const prev = await kpis(c, pFrom, pTo)
  return c.json({ from, to, prevFrom: pFrom, prevTo: pTo, current: cur, previous: prev, spark: await sparklines(c, from, to) })
})

/** Live board: what is happening right now. */
analyticsRoutes.get('/live', async (c) => {
  const db = c.get('db')
  const s = pubScope(c)
  const inProduction = await db.all(
    `SELECT i.id, i.number, i.title, i.status, i.planned_publish_at, i.created_at, p.id AS publication_id, p.title AS publication_title, p.theme_color,
       (SELECT COUNT(*) FROM issue_toc_items t WHERE t.issue_id = i.id) AS toc_total,
       (SELECT COUNT(*) FROM issue_toc_items t WHERE t.issue_id = i.id AND t.status = 'done') AS toc_done,
       (SELECT title FROM issue_stages st WHERE st.issue_id = i.id AND st.status = 'in_progress' ORDER BY st.sort_order LIMIT 1) AS current_stage,
       (SELECT MAX(created_at) FROM stage_events se WHERE se.issue_id = i.id) AS last_progress_at
     FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.deleted_at IS NULL AND i.status IN ('planning','in_production','changes_requested','awaiting_approval')${s.sql}
     ORDER BY i.status = 'awaiting_approval' DESC, last_progress_at DESC`,
    s.params
  )
  const feed = await db.all(
    `SELECT a.type, a.created_at, a.payload_json, a.issue_id, u.display_name AS actor_name, p.title AS publication_title, p.id AS publication_id, i.number AS issue_number
     FROM activity_events a JOIN publications p ON p.id = a.publication_id LEFT JOIN users u ON u.id = a.actor_user_id LEFT JOIN issues i ON i.id = a.issue_id
     WHERE a.type NOT IN ('follow','unfollow','library.add_free','comment.created','code.redeemed')${s.sql} ORDER BY a.created_at DESC LIMIT 40`,
    s.params
  )
  return c.json({ inProduction, feed, now: nowIso() })
})

/** Monthly trend series for charts. */
analyticsRoutes.get('/trends', async (c) => {
  const db = c.get('db')
  const s = pubScope(c)
  const { from, to } = dateRange(c, 365)
  const fromTs = from + 'T00:00:00.000Z'
  const toTs = to + 'T23:59:59.999Z'
  const published = await db.all(
    `SELECT substr(i.published_at,1,7) AS m, COUNT(*) AS n, SUM(i.page_count) AS pages FROM issues i JOIN publications p ON p.id = i.publication_id
     WHERE i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?${s.sql} GROUP BY m ORDER BY m`,
    [fromTs, toTs, ...s.params]
  )
  const views = await db.all(
    `SELECT substr(v.day,1,7) AS m, COUNT(*) AS n, SUM(CASE WHEN v.entity_type='issue_read' THEN 1 ELSE 0 END) AS reads, SUM(CASE WHEN v.entity_type='post' THEN 1 ELSE 0 END) AS post_views
     FROM view_events v JOIN publications p ON p.id = v.publication_id WHERE v.day BETWEEN ? AND ?${s.sql} GROUP BY m ORDER BY m`,
    [from, to, ...s.params]
  )
  const sales = await db.all(
    `SELECT substr(ac.redeemed_at,1,7) AS m, COUNT(*) AS n, COALESCE(SUM(ac.price_paid),0) AS revenue FROM access_codes ac JOIN publications p ON p.id = ac.publication_id
     WHERE ac.redeemed_at BETWEEN ? AND ?${s.sql} GROUP BY m ORDER BY m`,
    [fromTs, toTs, ...s.params]
  )
  const followers = await db.all(
    `SELECT substr(f.created_at,1,7) AS m, COUNT(*) AS n FROM follows f JOIN publications p ON p.id = f.publication_id WHERE f.created_at BETWEEN ? AND ?${s.sql} GROUP BY m ORDER BY m`,
    [fromTs, toTs, ...s.params]
  )
  const byFaculty = await db.all(
    `SELECT f.id, COALESCE(f.name, 'بدون دانشکده') AS name, COUNT(i.id) AS n, COALESCE(SUM(i.page_count),0) AS pages FROM issues i JOIN publications p ON p.id = i.publication_id LEFT JOIN faculties f ON f.id = p.faculty_id
     WHERE i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?${s.sql} GROUP BY f.id ORDER BY n DESC`,
    [fromTs, toTs, ...s.params]
  )
  const byCategory = await db.all(
    `SELECT cat.id, cat.name, COUNT(DISTINCT i.id) AS n, COUNT(DISTINCT p.id) AS pubs FROM issues i JOIN publications p ON p.id = i.publication_id JOIN publication_categories pc ON pc.publication_id = p.id
     JOIN categories cat ON cat.id = pc.category_id WHERE cat.type = 'subject' AND i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?${s.sql} GROUP BY cat.id ORDER BY n DESC LIMIT 12`,
    [fromTs, toTs, ...s.params]
  )
  const weekday = await db.all(
    `SELECT CAST(strftime('%w', v.day) AS INTEGER) AS d, COUNT(*) AS n FROM view_events v JOIN publications p ON p.id = v.publication_id WHERE v.day BETWEEN ? AND ?${s.sql} GROUP BY d ORDER BY d`,
    [from, to, ...s.params]
  )
  // Year-over-year (ROADMAP phase 8): the same window one year earlier, month keys shifted +1 year so they align.
  const shift = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`
  const bump = (rows: any[]) => rows.map((r) => ({ ...r, m: `${Number(String(r.m).slice(0, 4)) + 1}${String(r.m).slice(4)}` }))
  const yFrom = shift(from)
  const yTo = shift(to)
  const yoyPublished = bump(await db.all(
    `SELECT substr(i.published_at,1,7) AS m, COUNT(*) AS n FROM issues i JOIN publications p ON p.id = i.publication_id
     WHERE i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?${s.sql} GROUP BY m ORDER BY m`,
    [yFrom + 'T00:00:00.000Z', yTo + 'T23:59:59.999Z', ...s.params]
  ))
  const yoyViews = bump(await db.all(
    `SELECT substr(v.day,1,7) AS m, COUNT(*) AS n FROM view_events v JOIN publications p ON p.id = v.publication_id WHERE v.day BETWEEN ? AND ?${s.sql} GROUP BY m ORDER BY m`,
    [yFrom, yTo, ...s.params]
  ))
  // New publications registered per (Gregorian) year — whole history, scope-filtered (ROADMAP phase 7)
  const newPerYear = await db.all(
    `SELECT substr(p.created_at,1,4) AS y, COUNT(*) AS n FROM publications p WHERE p.deleted_at IS NULL${s.sql} GROUP BY y ORDER BY y`,
    s.params
  )
  // Two-range comparison (ROADMAP phase 7): daily cumulative curves aligned by day offset + regression slope per range
  let compare: unknown = null
  const from2 = c.req.query('from2')
  const to2 = c.req.query('to2')
  if (from2 && to2 && /^\d{4}-\d{2}-\d{2}$/.test(from2) && /^\d{4}-\d{2}-\d{2}$/.test(to2)) {
    const series = async (f: string, t: string) => {
      const pub = await db.all<{ d: string; n: number; pages: number }>(
        `SELECT substr(i.published_at,1,10) AS d, COUNT(*) AS n, COALESCE(SUM(i.page_count),0) AS pages FROM issues i JOIN publications p ON p.id = i.publication_id
         WHERE i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?${s.sql} GROUP BY d`,
        [f + 'T00:00:00.000Z', t + 'T23:59:59.999Z', ...s.params]
      )
      const vw = await db.all<{ d: string; n: number }>(
        `SELECT v.day AS d, COUNT(*) AS n FROM view_events v JOIN publications p ON p.id = v.publication_id WHERE v.day BETWEEN ? AND ?${s.sql} GROUP BY v.day`,
        [f, t, ...s.params]
      )
      const days = Math.min(731, Math.max(1, Math.round((new Date(t).getTime() - new Date(f).getTime()) / DAY) + 1))
      const idx = (d: string) => Math.round((new Date(d).getTime() - new Date(f).getTime()) / DAY)
      const cumIssues = new Array(days).fill(0)
      const cumPages = new Array(days).fill(0)
      const cumViews = new Array(days).fill(0)
      for (const r of pub) { const k = idx(r.d); if (k >= 0 && k < days) { cumIssues[k] += r.n; cumPages[k] += r.pages } }
      for (const r of vw) { const k = idx(r.d); if (k >= 0 && k < days) cumViews[k] += r.n }
      for (let k = 1; k < days; k++) { cumIssues[k] += cumIssues[k - 1]; cumPages[k] += cumPages[k - 1]; cumViews[k] += cumViews[k - 1] }
      const fit = (ys: number[]) => linearFit(ys.map((y, x) => ({ x, y })))
      return {
        from: f, to: t, days, issues: cumIssues, pages: cumPages, views: cumViews,
        slope: { issues: fit(cumIssues).slope * 30, pages: fit(cumPages).slope * 30, views: fit(cumViews).slope * 30 } // per 30 days
      }
    }
    const a1 = await series(from, to)
    const a2 = await series(from2, to2)
    const growth = (x: number, y: number) => (y ? Math.round(((x - y) / y) * 1000) / 10 : null)
    compare = { a: a1, b: a2, growth: { issues: growth(a1.slope.issues, a2.slope.issues), pages: growth(a1.slope.pages, a2.slope.pages), views: growth(a1.slope.views, a2.slope.views) } }
  }
  return c.json({ from, to, published, views, sales, followers, byFaculty, byCategory, weekday, yoy: { published: yoyPublished, views: yoyViews }, newPerYear, compare })
})

/**
 * Linear forecast to the end of the current academic term (ROADMAP phase 8).
 * Fits a least-squares line to the cumulative weekly counts of published issues / pages since the term start
 * and extrapolates to the term end. Also projects each publication from its own pace. Purely descriptive —
 * shown with r² and the number of observed weeks so the officer can judge how reliable it is.
 */
analyticsRoutes.get('/forecast', async (c) => {
  const db = c.get('db')
  const s = pubScope(c)
  const term = termBounds()
  const today = new Date().toISOString().slice(0, 10)
  const startMs = new Date(term.start + 'T00:00:00Z').getTime()
  const endMs = new Date(term.end + 'T23:59:59Z').getTime()
  const nowMs = Math.min(Date.now(), endMs)
  const WEEK = 7 * DAY
  const weeksElapsed = Math.max(1, Math.ceil((nowMs - startMs) / WEEK))
  const weeksTotal = Math.max(weeksElapsed, Math.ceil((endMs - startMs) / WEEK))
  const rows = await db.all<{ published_at: string; page_count: number | null; publication_id: string }>(
    `SELECT i.published_at, i.page_count, i.publication_id FROM issues i JOIN publications p ON p.id = i.publication_id
     WHERE i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?${s.sql}`,
    [term.start + 'T00:00:00.000Z', today + 'T23:59:59.999Z', ...s.params]
  )
  const weekly = Array.from({ length: weeksElapsed }, () => ({ issues: 0, pages: 0 }))
  for (const r of rows) {
    const w = Math.min(weeksElapsed - 1, Math.max(0, Math.floor((new Date(r.published_at).getTime() - startMs) / WEEK)))
    weekly[w].issues++
    weekly[w].pages += Number(r.page_count || 0)
  }
  let ci = 0, cp = 0
  const cumulative = weekly.map((w, idx) => ((ci += w.issues), (cp += w.pages), { week: idx + 1, issues: ci, pages: cp }))
  const project = (key: 'issues' | 'pages') => {
    const fit = linearFit(cumulative.map((p) => ({ x: p.week, y: p[key] })))
    const actual = cumulative[cumulative.length - 1]?.[key] ?? 0
    const projected = Math.max(actual, Math.round(fit.slope * weeksTotal + fit.intercept))
    // ~95% prediction interval at the term end: ŷ ± 2·se·sqrt(1 + 1/n + (x0 − x̄)² / Sxx) (needs n >= 3)
    const pts = cumulative.map((p) => ({ x: p.week, y: p[key] }))
    const n = pts.length
    let low = projected, high = projected
    if (n >= 3) {
      const xm = pts.reduce((a, p) => a + p.x, 0) / n
      const sxx = pts.reduce((a, p) => a + (p.x - xm) ** 2, 0) || 1
      const sse = pts.reduce((a, p) => a + (p.y - (fit.slope * p.x + fit.intercept)) ** 2, 0)
      const se = Math.sqrt(sse / (n - 2))
      const half = 2 * se * Math.sqrt(1 + 1 / n + (weeksTotal - xm) ** 2 / sxx)
      low = Math.max(actual, Math.round(projected - half))
      high = Math.max(low, Math.round(projected + half))
    }
    return { actual, projected, low, high, per_week: Math.round(fit.slope * 100) / 100, r2: Math.round(fit.r2 * 100) / 100 }
  }
  // Per publication: simple pace (count so far scaled to the whole term), active publications only.
  const pubs = await db.all<{ id: string; title: string; frequency: string | null }>(
    `SELECT p.id, p.title, p.frequency FROM publications p WHERE p.status = 'active' AND p.deleted_at IS NULL${s.sql} ORDER BY p.title`,
    s.params
  )
  const FREQ_DAYS: Record<string, number> = { monthly: 30, bimonthly: 60, quarterly: 90, biannual: 180 }
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.publication_id, (counts.get(r.publication_id) || 0) + 1)
  const termDays = (endMs - startMs) / DAY
  const publications = pubs.map((p) => {
    const actual = counts.get(p.id) || 0
    const projected = Math.round((actual / weeksElapsed) * weeksTotal)
    const expected = p.frequency && FREQ_DAYS[p.frequency] ? Math.max(1, Math.floor(termDays / FREQ_DAYS[p.frequency])) : null
    return { id: p.id, title: p.title, frequency: p.frequency, actual, projected, expected, behind: expected != null && projected < expected }
  })
  return c.json({
    term: { ...term, weeks_elapsed: weeksElapsed, weeks_total: weeksTotal },
    cumulative,
    issues: project('issues'),
    pages: project('pages'),
    publications
  })
})

/**
 * One-page printable scorecard of a publication for a date range (ROADMAP phase 8):
 * identity, KPIs vs the average of all (scoped) active publications, health score breakdown,
 * issues published in the range with cycle time, and team size. Officer/monitor roles only.
 */
analyticsRoutes.get('/scorecard/:id', async (c) => {
  const db = c.get('db')
  const s = pubScope(c)
  const { from, to } = dateRange(c, 365)
  const fromTs = from + 'T00:00:00.000Z'
  const toTs = to + 'T23:59:59.999Z'
  const pub = await db.first<any>(
    `SELECT p.id, p.title, p.slug, p.tagline, p.frequency, p.license_number, p.founded_at, p.status, p.theme_color, p.logo_key,
       a.name AS association_name, f.name AS faculty_name
     FROM publications p JOIN associations a ON a.id = p.association_id LEFT JOIN faculties f ON f.id = p.faculty_id
     WHERE p.id = ? AND p.deleted_at IS NULL${s.sql}`,
    [c.req.param('id'), ...s.params]
  )
  if (!pub) return c.json({ error: 'not_found', message: 'نشریه پیدا نشد' }, 404)
  const metric = (id: string | null) => {
    const w = id ? 'p.id = ?' : "p.status = 'active' AND p.deleted_at IS NULL" + s.sql
    const wp = id ? [id] : s.params
    return db.first<any>(
      `SELECT COUNT(*) AS n_pubs,
         SUM((SELECT COUNT(*) FROM issues i WHERE i.publication_id = p.id AND i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?)) AS published,
         SUM((SELECT COALESCE(SUM(page_count),0) FROM issues i WHERE i.publication_id = p.id AND i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?)) AS pages,
         SUM((SELECT COUNT(*) FROM view_events v WHERE v.publication_id = p.id AND v.day BETWEEN ? AND ?)) AS views,
         SUM((SELECT COUNT(*) FROM view_events v WHERE v.publication_id = p.id AND v.entity_type = 'issue_read' AND v.day BETWEEN ? AND ?)) AS reads,
         SUM((SELECT COUNT(*) FROM follows fo WHERE fo.publication_id = p.id AND fo.created_at BETWEEN ? AND ?)) AS new_followers,
         SUM((SELECT COUNT(*) FROM posts po WHERE po.publication_id = p.id AND po.published_at BETWEEN ? AND ?)) AS posts,
         SUM((SELECT COUNT(*) FROM access_codes ac WHERE ac.publication_id = p.id AND ac.redeemed_at BETWEEN ? AND ?)) AS digital_sold,
         SUM((SELECT COALESCE(SUM(quantity),0) FROM physical_sales ps WHERE ps.publication_id = p.id AND ps.sold_at BETWEEN ? AND ?)) AS print_sold,
         SUM((SELECT COUNT(*) FROM team_members tm WHERE tm.publication_id = p.id AND tm.is_active = 1)) AS members
       FROM publications p WHERE ${w}`,
      [fromTs, toTs, fromTs, toTs, from, to, from, to, fromTs, toTs, fromTs, toTs, fromTs, toTs, from, to, ...wp]
    )
  }
  const mine = await metric(pub.id)
  const all = await metric(null)
  const n = Math.max(1, Number(all?.n_pubs || 1))
  const keys = ['published', 'pages', 'views', 'reads', 'new_followers', 'posts', 'digital_sold', 'print_sold', 'members']
  const kpis = keys.map((k) => ({ key: k, value: Number(mine?.[k] || 0), average: Math.round((Number(all?.[k] || 0) / n) * 10) / 10 }))
  const issues = await db.all<any>(
    `SELECT i.id, i.number, i.title, i.page_count, i.created_at, i.published_at, i.planned_publish_at,
       (SELECT COUNT(*) FROM view_events v WHERE v.entity_id = i.id AND v.entity_type = 'issue_read') AS reads
     FROM issues i WHERE i.publication_id = ? AND i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ? ORDER BY i.published_at`,
    [pub.id, fromTs, toTs]
  )
  const roles = await db.all<any>(
    `SELECT r.role, u.display_name FROM publication_roles r JOIN users u ON u.id = r.user_id WHERE r.publication_id = ? AND r.ended_at IS NULL`,
    [pub.id]
  )
  const health = (await healthScores(db, [pub.id]))[pub.id] ?? null
  return c.json({
    from, to, generated_at: nowIso(), publication: pub, roles, health, kpis, n_publications: n,
    issues: issues.map((i) => ({ ...i, cycle_days: i.published_at ? Math.round((new Date(i.published_at).getTime() - new Date(i.created_at).getTime()) / DAY) : null, late: !!(i.planned_publish_at && i.published_at && i.published_at.slice(0, 10) > i.planned_publish_at.slice(0, 10)) }))
  })
})

/** Ranking table of publications on many metrics (officer only sees this — never teams). */
analyticsRoutes.get('/ranking', async (c) => {
  const db = c.get('db')
  const s = pubScope(c)
  const { from, to } = dateRange(c, 365)
  const fromTs = from + 'T00:00:00.000Z'
  const toTs = to + 'T23:59:59.999Z'
  const rows = await db.all<any>(
    `SELECT p.id, p.title, p.slug, p.theme_color, p.frequency, p.status, f.name AS faculty_name,
       (SELECT COUNT(*) FROM issues i WHERE i.publication_id = p.id AND i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?) AS published,
       (SELECT COALESCE(SUM(page_count),0) FROM issues i WHERE i.publication_id = p.id AND i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?) AS pages,
       (SELECT COUNT(*) FROM view_events v WHERE v.publication_id = p.id AND v.day BETWEEN ? AND ?) AS views,
       (SELECT COUNT(*) FROM view_events v WHERE v.publication_id = p.id AND v.entity_type = 'issue_read' AND v.day BETWEEN ? AND ?) AS reads,
       (SELECT COUNT(*) FROM follows fo WHERE fo.publication_id = p.id AND fo.unfollowed_at IS NULL) AS followers,
       (SELECT COUNT(*) FROM follows fo WHERE fo.publication_id = p.id AND fo.created_at BETWEEN ? AND ?) AS new_followers,
       (SELECT COUNT(*) FROM access_codes ac WHERE ac.publication_id = p.id AND ac.redeemed_at BETWEEN ? AND ?) AS digital_sold,
       (SELECT COALESCE(SUM(price_paid),0) FROM access_codes ac WHERE ac.publication_id = p.id AND ac.redeemed_at BETWEEN ? AND ?) AS revenue,
       (SELECT COALESCE(SUM(quantity),0) FROM physical_sales ps WHERE ps.publication_id = p.id AND ps.sold_at BETWEEN ? AND ?) AS print_sold,
       (SELECT COUNT(*) FROM posts po WHERE po.publication_id = p.id AND po.published_at BETWEEN ? AND ?) AS posts,
       (SELECT COUNT(*) FROM team_members tm WHERE tm.publication_id = p.id AND tm.is_active = 1) AS members,
       (SELECT MAX(published_at) FROM issues i WHERE i.publication_id = p.id AND i.status IN ('published','archived')) AS last_published_at
     FROM publications p LEFT JOIN faculties f ON f.id = p.faculty_id WHERE p.deleted_at IS NULL${s.sql}`,
    [fromTs, toTs, fromTs, toTs, from, to, from, to, fromTs, toTs, fromTs, toTs, fromTs, toTs, from, to, fromTs, toTs, ...s.params]
  )
  const health = await healthScores(db, rows.map((r) => r.id))
  // Organisational summary (ROADMAP phase 7): owners active in range (published an issue or a post),
  // pages/issues by owner kind and by faculty, most active faculties.
  const pubIssues = `FROM issues i JOIN publications p ON p.id = i.publication_id
     WHERE i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ? AND p.deleted_at IS NULL${s.sql}`
  const byOwnerKind = await db.all<any>(
    `SELECT COALESCE(a.kind, 'none') AS kind, COUNT(i.id) AS issues, COALESCE(SUM(i.page_count),0) AS pages,
       COUNT(DISTINCT p.association_id) AS owners
     FROM issues i JOIN publications p ON p.id = i.publication_id LEFT JOIN associations a ON a.id = p.association_id
     WHERE i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ? AND p.deleted_at IS NULL${s.sql} GROUP BY a.kind ORDER BY pages DESC`,
    [fromTs, toTs, ...s.params]
  )
  const activeOwners = await db.all<any>(
    `SELECT a.kind, COUNT(DISTINCT a.id) AS n FROM associations a JOIN publications p ON p.association_id = a.id
     WHERE p.deleted_at IS NULL${s.sql} AND (
       EXISTS (SELECT 1 FROM issues i WHERE i.publication_id = p.id AND i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?)
       OR EXISTS (SELECT 1 FROM posts po WHERE po.publication_id = p.id AND po.published_at BETWEEN ? AND ?))
     GROUP BY a.kind`,
    [...s.params, fromTs, toTs, fromTs, toTs]
  )
  const byFaculty = await db.all<any>(
    `SELECT f.id, COALESCE(f.name, 'بدون دانشکده') AS name, COUNT(i.id) AS issues, COALESCE(SUM(i.page_count),0) AS pages, COUNT(DISTINCT p.id) AS pubs
     FROM issues i JOIN publications p ON p.id = i.publication_id LEFT JOIN faculties f ON f.id = p.faculty_id
     WHERE i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ? AND p.deleted_at IS NULL${s.sql} GROUP BY f.id ORDER BY pages DESC`,
    [fromTs, toTs, ...s.params]
  )
  const totals = await db.first<any>(`SELECT COUNT(i.id) AS issues, COALESCE(SUM(i.page_count),0) AS pages ${pubIssues}`, [fromTs, toTs, ...s.params])
  return c.json({
    from,
    to,
    rows: rows.map((r) => ({ ...r, health: health[r.id] ?? null })),
    org: { totals, byOwnerKind, activeOwners, byFaculty },
    weights: await getWeights(db)
  })
})

/** Production speed: average days per stage and per issue, by publication. */
analyticsRoutes.get('/production', async (c) => {
  const db = c.get('db')
  const s = pubScope(c)
  const { from, to } = dateRange(c, 365)
  const fromTs = from + 'T00:00:00.000Z'
  const toTs = to + 'T23:59:59.999Z'
  const stages = await db.all(
    `SELECT st.key, st.title, COUNT(*) AS n, AVG(julianday(st.completed_at) - julianday(st.started_at)) AS avg_days,
       MIN(julianday(st.completed_at) - julianday(st.started_at)) AS min_days, MAX(julianday(st.completed_at) - julianday(st.started_at)) AS max_days
     FROM issue_stages st JOIN issues i ON i.id = st.issue_id JOIN publications p ON p.id = i.publication_id
     WHERE st.status = 'done' AND st.started_at IS NOT NULL AND st.completed_at IS NOT NULL AND st.completed_at BETWEEN ? AND ?${s.sql}
     GROUP BY st.key ORDER BY MIN(st.sort_order)`,
    [fromTs, toTs, ...s.params]
  )
  const cycle = await db.all(
    `SELECT p.id, p.title, COUNT(i.id) AS n, AVG(julianday(i.published_at) - julianday(i.created_at)) AS avg_cycle_days,
       SUM(CASE WHEN i.planned_publish_at IS NOT NULL AND substr(i.published_at,1,10) > i.planned_publish_at THEN 1 ELSE 0 END) AS late
     FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?${s.sql}
     GROUP BY p.id ORDER BY avg_cycle_days`,
    [fromTs, toTs, ...s.params]
  )
  const approvals = await db.first(
    `SELECT COUNT(*) AS n, AVG(julianday(a.decided_at) - julianday(a.requested_at)) AS avg_days, SUM(CASE WHEN a.decision = 'changes_requested' THEN 1 ELSE 0 END) AS changes
     FROM issue_approvals a JOIN issues i ON i.id = a.issue_id JOIN publications p ON p.id = i.publication_id WHERE a.decided_at BETWEEN ? AND ? AND a.decision IN ('approved','changes_requested')${s.sql}`,
    [fromTs, toTs, ...s.params]
  )
  // Median duration per stage (SQLite has no MEDIAN) + bottleneck heatmap rows: publication × stage avg days
  const durs = await db.all<{ key: string; pub: string; d: number }>(
    `SELECT st.key, p.title AS pub, julianday(st.completed_at) - julianday(st.started_at) AS d
     FROM issue_stages st JOIN issues i ON i.id = st.issue_id JOIN publications p ON p.id = i.publication_id
     WHERE st.status = 'done' AND st.started_at IS NOT NULL AND st.completed_at IS NOT NULL AND st.completed_at BETWEEN ? AND ?${s.sql}`,
    [fromTs, toTs, ...s.params]
  )
  const byKey: Record<string, number[]> = {}
  const heat: Record<string, Record<string, { sum: number; n: number }>> = {}
  for (const r of durs) {
    ;(byKey[r.key] ||= []).push(r.d)
    const cell = ((heat[r.pub] ||= {})[r.key] ||= { sum: 0, n: 0 })
    cell.sum += r.d
    cell.n++
  }
  const median = (xs: number[]) => {
    const a = [...xs].sort((x, y) => x - y)
    const m = a.length >> 1
    return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : null
  }
  const stagesOut = (stages as any[]).map((st) => ({ ...st, median_days: median(byKey[st.key] || []) }))
  const bottlenecks = Object.entries(heat).map(([pub, cells]) => ({
    publication: pub,
    cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, Math.round((v.sum / v.n) * 10) / 10]))
  }))
  // Production output and active people (ROADMAP phase 7): published vs in progress, who is doing the work
  const output = await db.first<any>(
    `SELECT SUM(CASE WHEN i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS published,
       SUM(CASE WHEN i.status IN ('planning','in_production','changes_requested','awaiting_approval') THEN 1 ELSE 0 END) AS in_progress
     FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.deleted_at IS NULL${s.sql}`,
    [fromTs, toTs, ...s.params]
  )
  const people = await db.all(
    `SELECT u.id, u.display_name, p.title AS publication_title, COUNT(*) AS actions, MAX(a.created_at) AS last_at
     FROM activity_events a JOIN users u ON u.id = a.actor_user_id JOIN publications p ON p.id = a.publication_id
     WHERE a.created_at BETWEEN ? AND ? AND a.type NOT IN ('follow','unfollow','library.add_free','comment.created','code.redeemed')${s.sql}
     GROUP BY u.id, p.id ORDER BY actions DESC LIMIT 30`,
    [fromTs, toTs, ...s.params]
  )
  // ROADMAP phase 7 production Gantt: issues currently in production, start → planned publish date
  const timeline = await db.all(
    `SELECT i.id, i.number, i.status, i.created_at, i.planned_publish_at, p.id AS publication_id, p.title AS publication_title
     FROM issues i JOIN publications p ON p.id = i.publication_id
     WHERE i.deleted_at IS NULL AND p.deleted_at IS NULL AND i.status IN ('planning','in_production','changes_requested','awaiting_approval')${s.sql}
     ORDER BY COALESCE(i.planned_publish_at, '9999') LIMIT 40`,
    s.params
  )
  return c.json({ from, to, stages: stagesOut, cycle, approvals, bottlenecks, output, people, timeline })
})

/** Publishing gaps: days between consecutive issues vs. declared frequency. */
analyticsRoutes.get('/gaps', async (c) => {
  const db = c.get('db')
  const s = pubScope(c)
  const pubs = await db.all<any>(`SELECT p.id, p.title, p.frequency, p.created_at FROM publications p WHERE p.deleted_at IS NULL AND p.status = 'active'${s.sql}`, s.params)
  const expected: Record<string, number> = { monthly: 30, bimonthly: 60, quarterly: 90, biannual: 180, irregular: 120 }
  const out = []
  for (const p of pubs) {
    const dates = (await db.all<{ d: string }>("SELECT published_at AS d FROM issues WHERE publication_id = ? AND status IN ('published','archived') AND published_at IS NOT NULL ORDER BY published_at", [p.id])).map((r) => r.d)
    const gaps: number[] = []
    for (let k = 1; k < dates.length; k++) gaps.push(Math.round((new Date(dates[k]).getTime() - new Date(dates[k - 1]).getTime()) / DAY))
    const last = dates[dates.length - 1] || null
    const since = last ? Math.round((Date.now() - new Date(last).getTime()) / DAY) : null
    // Concurrent factors (ROADMAP phase 7): what happened inside the longest gap (or the open gap since the last issue)
    const exp = expected[p.frequency] ?? 120
    let win: [string, string] | null = null
    if (gaps.length) {
      const k = gaps.indexOf(Math.max(...gaps))
      if (gaps[k] > exp * 1.5) win = [dates[k], dates[k + 1]]
    }
    if (last && since != null && since > exp * 1.5 && (!win || since > Math.max(...gaps))) win = [last, nowIso()]
    const factors: string[] = []
    if (win) {
      const dir = await db.first<{ n: number }>(
        "SELECT COUNT(*) AS n FROM publication_roles WHERE publication_id = ? AND role = 'managing_director' AND started_at > ? AND started_at <= ?",
        [p.id, win[0], win[1]]
      )
      if (dir?.n) factors.push('تغییر مدیرمسئول')
      const left = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM team_members WHERE publication_id = ? AND left_at > ? AND left_at <= ?', [p.id, win[0], win[1]])
      if (left?.n) factors.push(`ترک ${left.n} عضو`)
      const slow = await db.first<{ title: string; d: number }>(
        `SELECT st.title, MAX(julianday(COALESCE(st.completed_at, ?)) - julianday(st.started_at)) AS d FROM issue_stages st JOIN issues i ON i.id = st.issue_id
         WHERE i.publication_id = ? AND st.started_at IS NOT NULL AND st.started_at < ? AND COALESCE(st.completed_at, ?) > ?`,
        [win[1], p.id, win[1], win[1], win[0]]
      )
      if (slow?.title && slow.d > 30) factors.push(`مرحلهٔ طولانی «${slow.title}» (${Math.round(slow.d)} روز)`)
    }
    out.push({
      gap_window: win, factors,
      id: p.id, title: p.title, frequency: p.frequency, expected_days: expected[p.frequency] ?? 120, issues: dates.length,
      avg_gap: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null, max_gap: gaps.length ? Math.max(...gaps) : null,
      // ROADMAP phase 7: sequential intervals (1→2, 2→3, …), coefficient of variation, abnormal flags (> 1.5× expected)
      intervals: gaps.map((g, k) => ({ from: k + 1, to: k + 2, days: g, abnormal: g > exp * 1.5 })),
      cv: gaps.length > 1 ? (() => { const m = gaps.reduce((a, b) => a + b, 0) / gaps.length; const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - m) ** 2, 0) / gaps.length); return m ? Math.round((sd / m) * 100) / 100 : null })() : null,
      days_since_last: since, last_published_at: last, overdue: since != null && since > (expected[p.frequency] ?? 120)
    })
  }
  out.sort((a, b) => (b.days_since_last ?? 9999) - (a.days_since_last ?? 9999))
  return c.json({ rows: out })
})

/** Managing-director performance: output of each director during their own tenure (uses role history). */
const DIRECTOR_EXPECTED: Record<string, number> = { monthly: 30, bimonthly: 60, quarterly: 90, biannual: 180, irregular: 120 }

analyticsRoutes.get('/directors', async (c) => {
  const db = c.get('db')
  const s = pubScope(c)
  const tenures = await db.all<any>(
    `SELECT r.user_id, r.started_at, r.ended_at, u.display_name, p.id AS publication_id, p.title AS publication_title, p.frequency
     FROM publication_roles r JOIN users u ON u.id = r.user_id JOIN publications p ON p.id = r.publication_id
     WHERE r.role = 'managing_director' AND p.deleted_at IS NULL${s.sql} ORDER BY p.title, r.started_at`,
    s.params
  )
  const rows = []
  for (const t of tenures) {
    const end = t.ended_at || nowIso()
    const months = Math.max(1, (new Date(end).getTime() - new Date(t.started_at).getTime()) / (30 * DAY))
    const pub = await db.first<any>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(page_count),0) AS pages, AVG(julianday(published_at) - julianday(created_at)) AS cycle,
         SUM(CASE WHEN planned_publish_at IS NOT NULL AND substr(published_at,1,10) > planned_publish_at THEN 1 ELSE 0 END) AS late,
         AVG(CASE WHEN planned_publish_at IS NOT NULL AND substr(published_at,1,10) > planned_publish_at THEN julianday(substr(published_at,1,10)) - julianday(planned_publish_at) END) AS avg_late_days
       FROM issues
       WHERE publication_id = ? AND status IN ('published','archived') AND published_at BETWEEN ? AND ?`,
      [t.publication_id, t.started_at, end]
    )
    const views = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM view_events WHERE publication_id = ? AND day BETWEEN ? AND ?', [t.publication_id, t.started_at.slice(0, 10), end.slice(0, 10)])
    const sold = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM access_codes WHERE publication_id = ? AND redeemed_at BETWEEN ? AND ?', [t.publication_id, t.started_at, end])
    const followers = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM follows WHERE publication_id = ? AND created_at BETWEEN ? AND ?', [t.publication_id, t.started_at, end])
    rows.push({
      ...t, current: !t.ended_at, months: Math.round(months * 10) / 10, published: pub?.n ?? 0, pages: pub?.pages ?? 0,
      per_month: Math.round(((pub?.n ?? 0) / months) * 100) / 100, avg_cycle_days: pub?.cycle != null ? Math.round(pub.cycle) : null,
      views: views?.n ?? 0, digital_sold: sold?.n ?? 0, new_followers: followers?.n ?? 0,
      // ROADMAP phase 7: delay + fulfilment of the declared publication frequency during this tenure
      late: pub?.late ?? 0,
      avg_late_days: pub?.avg_late_days != null ? Math.round(pub.avg_late_days) : null,
      expected: Math.max(1, Math.floor((months * 30) / (DIRECTOR_EXPECTED[t.frequency] ?? 120))),
      fulfilment: Math.min(999, Math.round(((pub?.n ?? 0) / Math.max(1, Math.floor((months * 30) / (DIRECTOR_EXPECTED[t.frequency] ?? 120)))) * 100))
    })
  }
  return c.json({ rows })
})

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
    `SELECT p.title, COUNT(DISTINCT po.id) AS posts, (SELECT COUNT(*) FROM view_events v WHERE v.publication_id = p.id AND v.entity_type = 'post' AND v.day BETWEEN ? AND ?) AS views
     FROM publications p LEFT JOIN posts po ON po.publication_id = p.id AND po.published_at BETWEEN ? AND ? WHERE p.deleted_at IS NULL${s.sql} GROUP BY p.id ORDER BY views DESC`,
    [from, to, fromTs, toTs, ...s.params]
  )
  const moderation = await db.first(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN cm.status='pending' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN cm.status='approved' THEN 1 ELSE 0 END) AS approved,
       SUM(CASE WHEN cm.status IN ('rejected','spam') THEN 1 ELSE 0 END) AS rejected, AVG(CASE WHEN cm.moderated_at IS NOT NULL THEN (julianday(cm.moderated_at) - julianday(cm.created_at)) * 24 END) AS avg_hours
     FROM comments cm JOIN posts po ON po.id = cm.post_id JOIN publications p ON p.id = po.publication_id WHERE cm.is_team_reply = 0 AND cm.created_at BETWEEN ? AND ?${s.sql}`,
    [fromTs, toTs, ...s.params]
  )
  // Funnel (ROADMAP phase 6/8): explore post view -> issue page -> reading -> purchase (unique viewers per step)
  const uniq = async (type: string) =>
    Number((await db.first<{ n: number }>(`SELECT COUNT(DISTINCT v.viewer_hash) AS n FROM view_events v JOIN publications p ON p.id = v.publication_id WHERE v.entity_type = ? AND v.day BETWEEN ? AND ?${s.sql}`, [type, from, to, ...s.params]))?.n ?? 0)
  const bought = Number((await db.first<{ n: number }>(`SELECT COUNT(DISTINCT ac.redeemed_by) AS n FROM access_codes ac JOIN publications p ON p.id = ac.publication_id WHERE ac.redeemed_at BETWEEN ? AND ?${s.sql}`, [fromTs, toTs, ...s.params]))?.n ?? 0)
  // Weekday × hour heatmap (Tehran local time, UTC+03:30) and daily calendar heatmap (ROADMAP phase 7)
  const hourly = await db.all<{ d: number; h: number; n: number }>(
    `SELECT CAST(strftime('%w', datetime(v.created_at, '+210 minutes')) AS INTEGER) AS d, CAST(strftime('%H', datetime(v.created_at, '+210 minutes')) AS INTEGER) AS h, COUNT(*) AS n
     FROM view_events v JOIN publications p ON p.id = v.publication_id WHERE v.day BETWEEN ? AND ?${s.sql} GROUP BY d, h`,
    [from, to, ...s.params]
  )
  const calendar = await db.all<{ day: string; n: number }>(
    `SELECT v.day, COUNT(*) AS n FROM view_events v JOIN publications p ON p.id = v.publication_id WHERE v.day BETWEEN ? AND ?${s.sql} GROUP BY v.day ORDER BY v.day`,
    [from, to, ...s.params]
  )
  const funnel = [
    { key: 'post', label: 'دیدن پست اکسپلور', n: await uniq('post') },
    { key: 'post_read_full', label: 'کلیک «خواندن کامل»', n: await uniq('post_read_full') },
    { key: 'issue', label: 'ورود به صفحهٔ شماره', n: await uniq('issue') },
    { key: 'issue_read', label: 'شروع خواندن', n: await uniq('issue_read') },
    { key: 'purchase', label: 'خرید (بازخرید کد)', n: bought }
  ]
  // Public-space totals + most viewed categories/associations (ROADMAP phase 7)
  const totals = await db.first<{ views: number; uniq: number }>(
    `SELECT COUNT(*) AS views, COUNT(DISTINCT v.viewer_hash) AS uniq FROM view_events v JOIN publications p ON p.id = v.publication_id WHERE v.day BETWEEN ? AND ?${s.sql}`,
    [from, to, ...s.params]
  )
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

/** Rule-based insights (Phase 8). */
analyticsRoutes.get('/insights', async (c) => {
  const s = pubScope(c)
  const items = await computeInsights(c.get('db'), s)
  return c.json({ items })
})

analyticsRoutes.post('/insights/:key/dismiss', async (c) => {
  const u = c.get('user')!
  await c.get('db').run('INSERT OR REPLACE INTO insight_dismissals (insight_key, dismissed_by, dismissed_at) VALUES (?,?,?)', [c.req.param('key'), u.id, nowIso()])
  return c.json({ ok: true })
})

/** CSV export of the ranking (opened in Excel; UTF-8 BOM for Persian). */
analyticsRoutes.get('/export/ranking.csv', async (c) => {
  const db = c.get('db')
  const s = pubScope(c)
  const { from, to } = dateRange(c, 365)
  const rows = await db.all<any>(
    `SELECT p.title, f.name AS faculty, (SELECT COUNT(*) FROM issues i WHERE i.publication_id = p.id AND i.status IN ('published','archived') AND substr(i.published_at,1,10) BETWEEN ? AND ?) AS published,
       (SELECT COUNT(*) FROM view_events v WHERE v.publication_id = p.id AND v.day BETWEEN ? AND ?) AS views,
       (SELECT COUNT(*) FROM follows fo WHERE fo.publication_id = p.id AND fo.unfollowed_at IS NULL) AS followers,
       (SELECT COUNT(*) FROM access_codes ac WHERE ac.publication_id = p.id AND substr(ac.redeemed_at,1,10) BETWEEN ? AND ?) AS digital_sold
     FROM publications p LEFT JOIN faculties f ON f.id = p.faculty_id WHERE p.deleted_at IS NULL${s.sql} ORDER BY published DESC`,
    [from, to, from, to, from, to, ...s.params]
  )
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = '\uFEFF' + ['نشریه,دانشکده,شماره‌های منتشرشده,بازدید,دنبال‌کننده,فروش دیجیتال', ...rows.map((r) => [r.title, r.faculty, r.published, r.views, r.followers, r.digital_sold].map(esc).join(','))].join('\r\n')
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ranking-${from}-${to}.csv"` } })
})

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

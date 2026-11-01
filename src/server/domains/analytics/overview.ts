// Analytics domain module: summary, live board, trends, forecast, scorecard, ranking.
// Mounted by routes/analytics.ts (ROADMAP phase 17 split; parent middleware applies).
import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { dateRange, nowIso } from '../../lib/util'
import { getWeights, healthScores } from '../../insights'
import { linearFit, termBounds } from '../../../shared/fa'
import { DAY, kpis, previousRange, pubScope, pubViewsSql, rolledUntil, sparklines, viewSeries } from './service'

export const overviewRoutes = new Hono<AppEnv>()

/** Main dashboard: KPIs with comparison to the previous equal-length period. */
overviewRoutes.get('/summary', async (c) => {
  const { from, to } = dateRange(c, 365)
  const { pFrom, pTo } = previousRange(from, to)
  const cur = await kpis(c, from, to)
  const prev = await kpis(c, pFrom, pTo)
  return c.json({ from, to, prevFrom: pFrom, prevTo: pTo, current: cur, previous: prev, spark: await sparklines(c, from, to) })
})

/** Live board: what is happening right now. */
overviewRoutes.get('/live', async (c) => {
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
overviewRoutes.get('/trends', async (c) => {
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
  const views = (await viewSeries(c, from, to, 'substr(v.day,1,7)')).map((r) => ({ m: r.k, n: r.n, reads: r.reads, post_views: r.post_views }))
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
  const weekday = (await viewSeries(c, from, to, "CAST(strftime('%w', v.day) AS INTEGER)")).map((r) => ({ d: Number(r.k), n: r.n }))
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
  const yoyViews = bump((await viewSeries(c, yFrom, yTo, 'substr(v.day,1,7)')).map((r) => ({ m: r.k, n: r.n })))
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
      const vw = (await viewSeries(c, f, t, 'v.day')).map((r) => ({ d: String(r.k), n: r.n }))
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
overviewRoutes.get('/forecast', async (c) => {
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
overviewRoutes.get('/scorecard/:id', async (c) => {
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
  const until = await rolledUntil(c)
  const metric = (id: string | null) => {
    const w = id ? 'p.id = ?' : "p.status = 'active' AND p.deleted_at IS NULL" + s.sql
    const wp = id ? [id] : s.params
    return db.first<any>(
      `SELECT COUNT(*) AS n_pubs,
         SUM((SELECT COUNT(*) FROM issues i WHERE i.publication_id = p.id AND i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?)) AS published,
         SUM((SELECT COALESCE(SUM(page_count),0) FROM issues i WHERE i.publication_id = p.id AND i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?)) AS pages,
         SUM(${pubViewsSql()}) AS views,
         SUM(${pubViewsSql('issue_read')}) AS reads,
         SUM((SELECT COUNT(*) FROM follows fo WHERE fo.publication_id = p.id AND fo.created_at BETWEEN ? AND ?)) AS new_followers,
         SUM((SELECT COUNT(*) FROM posts po WHERE po.publication_id = p.id AND po.published_at BETWEEN ? AND ?)) AS posts,
         SUM((SELECT COUNT(*) FROM access_codes ac WHERE ac.publication_id = p.id AND ac.redeemed_at BETWEEN ? AND ?)) AS digital_sold,
         SUM((SELECT COALESCE(SUM(quantity),0) FROM physical_sales ps WHERE ps.publication_id = p.id AND ps.sold_at BETWEEN ? AND ?)) AS print_sold,
         SUM((SELECT COUNT(*) FROM team_members tm WHERE tm.publication_id = p.id AND tm.is_active = 1)) AS members
       FROM publications p WHERE ${w}`,
      [fromTs, toTs, fromTs, toTs, ...pubViewsParams(from, to, until), ...pubViewsParams(from, to, until), fromTs, toTs, fromTs, toTs, fromTs, toTs, from, to, ...wp]
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
overviewRoutes.get('/ranking', async (c) => {
  const db = c.get('db')
  const s = pubScope(c)
  const { from, to } = dateRange(c, 365)
  const fromTs = from + 'T00:00:00.000Z'
  const toTs = to + 'T23:59:59.999Z'
  const until = await rolledUntil(c)
  const rows = await db.all<any>(
    `SELECT p.id, p.title, p.slug, p.theme_color, p.frequency, p.status, f.name AS faculty_name,
       (SELECT COUNT(*) FROM issues i WHERE i.publication_id = p.id AND i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?) AS published,
       (SELECT COALESCE(SUM(page_count),0) FROM issues i WHERE i.publication_id = p.id AND i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?) AS pages,
       ${pubViewsSql()} AS views,
       ${pubViewsSql('issue_read')} AS reads,
       (SELECT COUNT(*) FROM follows fo WHERE fo.publication_id = p.id AND fo.unfollowed_at IS NULL) AS followers,
       (SELECT COUNT(*) FROM follows fo WHERE fo.publication_id = p.id AND fo.created_at BETWEEN ? AND ?) AS new_followers,
       (SELECT COUNT(*) FROM access_codes ac WHERE ac.publication_id = p.id AND ac.redeemed_at BETWEEN ? AND ?) AS digital_sold,
       (SELECT COALESCE(SUM(price_paid),0) FROM access_codes ac WHERE ac.publication_id = p.id AND ac.redeemed_at BETWEEN ? AND ?) AS revenue,
       (SELECT COALESCE(SUM(quantity),0) FROM physical_sales ps WHERE ps.publication_id = p.id AND ps.sold_at BETWEEN ? AND ?) AS print_sold,
       (SELECT COUNT(*) FROM posts po WHERE po.publication_id = p.id AND po.published_at BETWEEN ? AND ?) AS posts,
       (SELECT COUNT(*) FROM team_members tm WHERE tm.publication_id = p.id AND tm.is_active = 1) AS members,
       (SELECT MAX(published_at) FROM issues i WHERE i.publication_id = p.id AND i.status IN ('published','archived')) AS last_published_at
     FROM publications p LEFT JOIN faculties f ON f.id = p.faculty_id WHERE p.deleted_at IS NULL${s.sql}`,
    [fromTs, toTs, fromTs, toTs, ...pubViewsParams(from, to, until), ...pubViewsParams(from, to, until), fromTs, toTs, fromTs, toTs, fromTs, toTs, from, to, fromTs, toTs, ...s.params]
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

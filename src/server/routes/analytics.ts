import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../context'
import { MONITOR_ROLES } from '../context'
import { requireRole } from '../auth'
import { body, dateRange, nowIso, parseJson } from '../lib/util'
import { computeInsights, healthScores } from '../insights'
import { aiNarrative, aiAsk } from '../ai'

export const analyticsRoutes = new Hono<AppEnv>()

analyticsRoutes.use('*', async (c, next) => {
  requireRole(c, MONITOR_ROLES)
  await next()
})

/** Faculty supervisors are restricted to their own faculty. */
export function pubScope(c: Context<AppEnv>, alias = 'p') {
  const u = c.get('user')!
  const fac = c.req.query('faculty')
  if (u.system_role === 'faculty_supervisor') return { sql: ` AND ${alias}.faculty_id = ?`, params: [u.scope_faculty_id] as unknown[] }
  if (fac) return { sql: ` AND ${alias}.faculty_id = ?`, params: [fac] as unknown[] }
  return { sql: '', params: [] as unknown[] }
}

const DAY = 86400_000
function previousRange(from: string, to: string) {
  const len = new Date(to).getTime() - new Date(from).getTime() + DAY
  const pTo = new Date(new Date(from).getTime() - DAY).toISOString().slice(0, 10)
  const pFrom = new Date(new Date(from).getTime() - len).toISOString().slice(0, 10)
  return { pFrom, pTo }
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
    views: await one(`SELECT COUNT(*) AS n FROM view_events v JOIN publications p ON p.id = v.publication_id WHERE v.day BETWEEN ? AND ?${s.sql}`, [from, to, ...s.params]),
    reads: await one(`SELECT COUNT(*) AS n FROM view_events v JOIN publications p ON p.id = v.publication_id WHERE v.entity_type = 'issue_read' AND v.day BETWEEN ? AND ?${s.sql}`, [from, to, ...s.params]),
    post_views: await one(`SELECT COUNT(*) AS n FROM view_events v JOIN publications p ON p.id = v.publication_id WHERE v.entity_type = 'post' AND v.day BETWEEN ? AND ?${s.sql}`, [from, to, ...s.params]),
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

/** Main dashboard: KPIs with comparison to the previous equal-length period. */
analyticsRoutes.get('/summary', async (c) => {
  const { from, to } = dateRange(c, 365)
  const { pFrom, pTo } = previousRange(from, to)
  const cur = await kpis(c, from, to)
  const prev = await kpis(c, pFrom, pTo)
  return c.json({ from, to, prevFrom: pFrom, prevTo: pTo, current: cur, previous: prev })
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
    `SELECT COALESCE(f.name, 'بدون دانشکده') AS name, COUNT(i.id) AS n FROM issues i JOIN publications p ON p.id = i.publication_id LEFT JOIN faculties f ON f.id = p.faculty_id
     WHERE i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?${s.sql} GROUP BY f.id ORDER BY n DESC`,
    [fromTs, toTs, ...s.params]
  )
  const byCategory = await db.all(
    `SELECT cat.name, COUNT(DISTINCT i.id) AS n FROM issues i JOIN publications p ON p.id = i.publication_id JOIN publication_categories pc ON pc.publication_id = p.id
     JOIN categories cat ON cat.id = pc.category_id WHERE cat.type = 'subject' AND i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?${s.sql} GROUP BY cat.id ORDER BY n DESC LIMIT 12`,
    [fromTs, toTs, ...s.params]
  )
  const weekday = await db.all(
    `SELECT CAST(strftime('%w', v.day) AS INTEGER) AS d, COUNT(*) AS n FROM view_events v JOIN publications p ON p.id = v.publication_id WHERE v.day BETWEEN ? AND ?${s.sql} GROUP BY d ORDER BY d`,
    [from, to, ...s.params]
  )
  return c.json({ from, to, published, views, sales, followers, byFaculty, byCategory, weekday })
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
  return c.json({ from, to, rows: rows.map((r) => ({ ...r, health: health[r.id] ?? null })) })
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
  return c.json({ from, to, stages, cycle, approvals })
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
    out.push({
      id: p.id, title: p.title, frequency: p.frequency, expected_days: expected[p.frequency] ?? 120, issues: dates.length,
      avg_gap: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null, max_gap: gaps.length ? Math.max(...gaps) : null,
      days_since_last: since, last_published_at: last, overdue: since != null && since > (expected[p.frequency] ?? 120)
    })
  }
  out.sort((a, b) => (b.days_since_last ?? 9999) - (a.days_since_last ?? 9999))
  return c.json({ rows: out })
})

/** Managing-director performance: output of each director during their own tenure (uses role history). */
analyticsRoutes.get('/directors', async (c) => {
  const db = c.get('db')
  const s = pubScope(c)
  const tenures = await db.all<any>(
    `SELECT r.user_id, r.started_at, r.ended_at, u.display_name, p.id AS publication_id, p.title AS publication_title
     FROM publication_roles r JOIN users u ON u.id = r.user_id JOIN publications p ON p.id = r.publication_id
     WHERE r.role = 'managing_director' AND p.deleted_at IS NULL${s.sql} ORDER BY p.title, r.started_at`,
    s.params
  )
  const rows = []
  for (const t of tenures) {
    const end = t.ended_at || nowIso()
    const months = Math.max(1, (new Date(end).getTime() - new Date(t.started_at).getTime()) / (30 * DAY))
    const pub = await db.first<any>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(page_count),0) AS pages, AVG(julianday(published_at) - julianday(created_at)) AS cycle FROM issues
       WHERE publication_id = ? AND status IN ('published','archived') AND published_at BETWEEN ? AND ?`,
      [t.publication_id, t.started_at, end]
    )
    const views = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM view_events WHERE publication_id = ? AND day BETWEEN ? AND ?', [t.publication_id, t.started_at.slice(0, 10), end.slice(0, 10)])
    const sold = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM access_codes WHERE publication_id = ? AND redeemed_at BETWEEN ? AND ?', [t.publication_id, t.started_at, end])
    const followers = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM follows WHERE publication_id = ? AND created_at BETWEEN ? AND ?', [t.publication_id, t.started_at, end])
    rows.push({
      ...t, current: !t.ended_at, months: Math.round(months * 10) / 10, published: pub?.n ?? 0, pages: pub?.pages ?? 0,
      per_month: Math.round(((pub?.n ?? 0) / months) * 100) / 100, avg_cycle_days: pub?.cycle != null ? Math.round(pub.cycle) : null,
      views: views?.n ?? 0, digital_sold: sold?.n ?? 0, new_followers: followers?.n ?? 0
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
  return c.json({ from, to, top: top.map((r) => ({ ...r, image: parseJson<string[]>(r.images_json, [])[0] || null, images_json: undefined })), byPub, moderation })
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
  return c.json({ from, to, byIssue, channels })
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

analyticsRoutes.post('/ai/ask', async (c) => {
  const b = await body<{ question?: string }>(c)
  const { from, to } = dateRange(c, 365)
  const data = { from, to, kpis: await kpis(c, from, to) }
  return c.json(await aiAsk(c, String(b.question || '').slice(0, 500), data))
})

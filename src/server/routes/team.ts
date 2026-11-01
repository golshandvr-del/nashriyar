import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { requireUser, userPubRoles } from '../auth'
import { activity, cursorPage, dateRange, getSetting, inList, parseJson } from '../lib/util'
import { DEFAULT_STAGES, pub } from '../domains/team/service'
import { dashboardRoutes } from '../domains/team/dashboard'
import { membersRoutes } from '../domains/team/members'
import { issuesRoutes } from '../domains/team/issues'
import { salesRoutes } from '../domains/team/sales'
import { exploreRoutes } from '../domains/team/explore'
import { commentsRoutes } from '../domains/team/comments'
import { communityRoutes } from '../domains/team/community'
// re-exported: other modules historically imported the default production stages from this file
export { DEFAULT_STAGES }

export const teamRoutes = new Hono<AppEnv>()

// Every /api/team/:pubId/* request is checked: the user must hold one of the three main roles of THIS publication.
// Follower data is NEVER returned from this router (docs/ROLES.md rule 2).

teamRoutes.get('/my', async (c) => {
  const u = requireUser(c)
  return c.json({ publications: await userPubRoles(c, u.id) })
})

// domain module (ROADMAP phase 17): ../domains/team/dashboard
teamRoutes.route('/', dashboardRoutes)

// domain module (ROADMAP phase 17): ../domains/team/members
teamRoutes.route('/', membersRoutes)

// domain module (ROADMAP phase 17): ../domains/team/issues
teamRoutes.route('/', issuesRoutes)

// domain module (ROADMAP phase 17): ../domains/team/sales
teamRoutes.route('/', salesRoutes)

// domain module (ROADMAP phase 17): ../domains/team/explore
teamRoutes.route('/', exploreRoutes)

// domain module (ROADMAP phase 17): ../domains/team/comments
teamRoutes.route('/', commentsRoutes)

// domain module (ROADMAP phase 17): ../domains/team/community
teamRoutes.route('/', communityRoutes)

// ── Aggregate, non-competitive stats for the team's own publication (client decision #4) ──
// No ranks, no comparison with other publications, no follower numbers.
teamRoutes.get('/:pubId/stats', async (c) => {
  const { pub: p } = await pub(c)
  const db = c.get('db')
  const { from, to } = dateRange(c, 90)
  const daily = await db.all(
    `SELECT day, SUM(CASE WHEN entity_type = 'publication' THEN 1 ELSE 0 END) AS page_views, SUM(CASE WHEN entity_type = 'issue' THEN 1 ELSE 0 END) AS issue_views,
       SUM(CASE WHEN entity_type = 'issue_read' THEN 1 ELSE 0 END) AS reads, SUM(CASE WHEN entity_type = 'post' THEN 1 ELSE 0 END) AS post_views
     FROM view_events WHERE publication_id = ? AND day BETWEEN ? AND ? GROUP BY day ORDER BY day`,
    [p.id, from, to]
  )
  const byIssue = await db.all(
    `SELECT i.id, i.number, i.title, i.pricing,
       (SELECT COUNT(*) FROM view_events v WHERE v.entity_type = 'issue' AND v.entity_id = i.id AND v.day BETWEEN ? AND ?) AS views,
       (SELECT COUNT(*) FROM view_events v WHERE v.entity_type = 'issue_read' AND v.entity_id = i.id AND v.day BETWEEN ? AND ?) AS reads,
       (SELECT COUNT(*) FROM access_codes ac WHERE ac.issue_id = i.id AND ac.redeemed_at IS NOT NULL) AS digital_sold,
       (SELECT COALESCE(SUM(quantity), 0) FROM physical_sales ps WHERE ps.issue_id = i.id) AS print_sold
     FROM issues i WHERE i.publication_id = ? AND i.status = 'published' AND i.deleted_at IS NULL ORDER BY i.number DESC`,
    [from, to, from, to, p.id]
  )
  const topPosts = await db.all<any>(
    `SELECT po.id, po.images_json, po.caption, COUNT(v.id) AS views FROM posts po LEFT JOIN view_events v ON v.entity_type = 'post' AND v.entity_id = po.id AND v.day BETWEEN ? AND ?
     WHERE po.publication_id = ? AND po.status = 'published' GROUP BY po.id ORDER BY views DESC LIMIT 6`,
    [from, to, p.id]
  )
  const totals = daily.reduce((a: any, d: any) => ({ page_views: a.page_views + d.page_views, issue_views: a.issue_views + d.issue_views, reads: a.reads + d.reads, post_views: a.post_views + d.post_views }), { page_views: 0, issue_views: 0, reads: 0, post_views: 0 })
  const avgPercent = await db.first<{ v: number }>(
    'SELECT AVG(rp.percent) AS v FROM reading_progress rp JOIN issues i ON i.id = rp.issue_id WHERE i.publication_id = ?',
    [p.id]
  )
  return c.json({
    from, to, totals, daily, byIssue,
    topPosts: topPosts.map((r) => ({ ...r, image: parseJson<string[]>(r.images_json, [])[0] || null, images_json: undefined })),
    avg_read_percent: Math.round(avgPercent?.v ?? 0)
  })
})

teamRoutes.get('/:pubId/activity', async (c) => {
  const { pub: p } = await pub(c)
  // ROADMAP phase 17: keyset pagination (?cursor, ?limit ≤ 200, default 100)
  const pg = cursorPage(c, { col: 'a.created_at', idCol: 'a.id', def: 100, max: 200 })
  const rows = await c.get('db').all<any>(
    `SELECT a.id, a.type, a.payload_json, a.created_at, a.issue_id, u.display_name AS actor_name, i.number AS issue_number
     FROM activity_events a LEFT JOIN users u ON u.id = a.actor_user_id LEFT JOIN issues i ON i.id = a.issue_id
     WHERE a.publication_id = ? AND a.type NOT IN ('follow','unfollow')${pg.and} ORDER BY ${pg.order} LIMIT ${pg.fetch}`,
    [p.id, ...pg.params]
  )
  const { rows: items, next_cursor } = pg.finish(rows, (r) => [r.created_at, r.id])
  return c.json({ items, next_cursor })
})

teamRoutes.get('/:pubId/search-issues', async (c) => {
  const { pub: p } = await pub(c)
  const ids = (c.req.query('ids') || '').split(',').filter(Boolean).slice(0, 50)
  const rows = await c.get('db').all(`SELECT id, number, title FROM issues WHERE publication_id = ? AND id IN (${inList(ids)})`, [p.id, ...ids])
  return c.json({ issues: rows })
})

export const _settingsUsed = getSetting

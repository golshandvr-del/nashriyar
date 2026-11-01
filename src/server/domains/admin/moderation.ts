// Admin domain module: moderation oversight (posts, comments, reports).
// Mounted by routes/admin.ts (ROADMAP phase 17 split; parent middleware applies).
import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { audit, body, cursorPage, notFound, notify, nowIso, oneOf, parseJson } from '../../lib/util'
import { admin } from './service'

export const moderationRoutes = new Hono<AppEnv>()

// ───────── Moderation oversight ─────────
moderationRoutes.get('/posts', async (c) => {
  admin(c)
  const status = c.req.query('status') || ''
  // ROADMAP phase 17: keyset pagination (?cursor, ?limit ≤ 200)
  const pg = cursorPage(c, { col: 'po.created_at', idCol: 'po.id', def: 200, max: 200 })
  const rows = await c.get('db').all<any>(
    `SELECT po.id, po.caption, po.images_json, po.status, po.is_story, po.published_at, po.created_at, p.title AS publication_title, i.title AS source_issue_title, i.number AS source_issue_number,
       (SELECT COUNT(*) FROM reports r WHERE r.entity_type = 'post' AND r.entity_id = po.id AND r.status = 'open') AS open_reports
     FROM posts po JOIN publications p ON p.id = po.publication_id JOIN issues i ON i.id = po.source_issue_id
     WHERE ${status ? 'po.status = ?' : '1 = 1'}${pg.and} ORDER BY ${pg.order} LIMIT ${pg.fetch}`,
    [...(status ? [status] : []), ...pg.params]
  )
  const { rows: page, next_cursor } = pg.finish(rows, (r) => [r.created_at, r.id])
  return c.json({ posts: page.map((r) => ({ ...r, images: parseJson(r.images_json, []), images_json: undefined })), next_cursor })
})

moderationRoutes.post('/posts/:id/visibility', async (c) => {
  const u = admin(c)
  const b = await body<{ hidden?: boolean; reason?: string }>(c)
  const db = c.get('db')
  const po = await db.first<any>('SELECT id, status, publication_id FROM posts WHERE id = ?', [c.req.param('id')])
  if (!po) throw notFound('پست یافت نشد')
  const next = b.hidden ? 'hidden_by_admin' : 'published'
  await db.run('UPDATE posts SET status = ? WHERE id = ?', [next, po.id])
  await audit(db, u.id, 'post.visibility', 'post', po.id, { status: po.status }, { status: next, reason: b.reason || null })
  const holders = await db.all<{ user_id: string }>('SELECT user_id FROM publication_roles WHERE publication_id = ? AND ended_at IS NULL', [po.publication_id])
  if (b.hidden) for (const h of holders) await notify(db, h.user_id, 'post.hidden', `یک پست شما توسط مسئول نشریات پنهان شد${b.reason ? ': ' + b.reason : ''}`, `/team/${po.publication_id}/explore`)
  return c.json({ ok: true })
})

moderationRoutes.get('/comments', async (c) => {
  admin(c)
  const status = oneOf(c.req.query('status'), ['pending', 'approved', 'rejected', 'spam'] as const, 'وضعیت', 'pending')
  // ROADMAP phase 17: keyset pagination (?cursor, ?limit ≤ 200)
  const pg = cursorPage(c, { col: 'cm.created_at', idCol: 'cm.id', def: 200, max: 200 })
  const rows = await c.get('db').all<any>(
    `SELECT cm.id, cm.body, cm.status, cm.flagged, cm.created_at, u.display_name AS author, u.student_number, p.title AS publication_title, cm.post_id
     FROM comments cm JOIN posts po ON po.id = cm.post_id JOIN publications p ON p.id = po.publication_id LEFT JOIN users u ON u.id = cm.user_id
     WHERE cm.status = ?${pg.and} ORDER BY ${pg.order} LIMIT ${pg.fetch}`,
    [status, ...pg.params]
  )
  const { rows: comments, next_cursor } = pg.finish(rows, (r) => [r.created_at, r.id])
  return c.json({ comments, next_cursor })
})

moderationRoutes.post('/comments/:id', async (c) => {
  const u = admin(c)
  const b = await body<{ action?: string }>(c)
  const action = oneOf(b.action, ['approve', 'reject', 'spam'] as const, 'اقدام')
  const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'spam'
  await c.get('db').run('UPDATE comments SET status = ?, moderated_by = ?, moderated_at = ? WHERE id = ?', [status, u.id, nowIso(), c.req.param('id')])
  await audit(c.get('db'), u.id, 'comment.' + action, 'comment', c.req.param('id'))
  return c.json({ ok: true })
})

moderationRoutes.get('/reports', async (c) => {
  admin(c)
  // ROADMAP phase 17: keyset pagination; open reports first, then newest — one composite sort key keeps that order
  const SK = "(CASE WHEN r.status = 'open' THEN '1' ELSE '0' END || r.created_at)"
  const pg = cursorPage(c, { col: SK, idCol: 'r.id', def: 200, max: 200 })
  const rows = await c.get('db').all<any>(
    `SELECT r.*, ${SK} AS sort_key, u.display_name AS reporter_name FROM reports r LEFT JOIN users u ON u.id = r.reporter_user_id WHERE 1 = 1${pg.and} ORDER BY ${pg.order} LIMIT ${pg.fetch}`,
    pg.params
  )
  const { rows: page, next_cursor } = pg.finish(rows, (r) => [r.sort_key, r.id])
  return c.json({ reports: page.map(({ sort_key, ...r }) => r), next_cursor })
})

moderationRoutes.post('/reports/:id', async (c) => {
  const u = admin(c)
  const b = await body<{ status?: string }>(c)
  const status = oneOf(b.status, ['resolved', 'dismissed', 'open'] as const, 'وضعیت')
  await c.get('db').run('UPDATE reports SET status = ?, handled_by = ? WHERE id = ?', [status, u.id, c.req.param('id')])
  await audit(c.get('db'), u.id, 'report.' + status, 'report', c.req.param('id'))
  return c.json({ ok: true })
})

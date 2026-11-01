// Team domain module: comment moderation (comments appear only after approval).
// Mounted by routes/team.ts (ROADMAP phase 17 split; parent middleware applies).
import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { newId } from '../../lib/crypto'
import { activity, body, cursorPage, notFound, notify, nowIso, oneOf, parseJson, str } from '../../lib/util'
import { aiCommentLabels, getProvider, ruleCommentLabel } from '../../ai'
import { flagComment } from '../../lib/moderation'
import { pub } from './service'

export const commentsRoutes = new Hono<AppEnv>()

// ── Comment moderation (comments appear only after approval) ──
commentsRoutes.get('/:pubId/comments', async (c) => {
  const { pub: p } = await pub(c)
  const status = oneOf(c.req.query('status'), ['pending', 'approved', 'rejected', 'spam'] as const, 'وضعیت', 'pending')
  // ROADMAP phase 17: keyset pagination (?cursor, ?limit ≤ 200)
  const pg = cursorPage(c, { col: 'cm.created_at', idCol: 'cm.id', def: 200, max: 200 })
  const rows = await c.get('db').all<any>(
    `SELECT cm.id, cm.body, cm.status, cm.flagged, cm.created_at, cm.parent_id, cm.is_team_reply, cm.post_id, po.images_json, po.caption, u.display_name AS author
     FROM comments cm JOIN posts po ON po.id = cm.post_id LEFT JOIN users u ON u.id = cm.user_id WHERE po.publication_id = ? AND cm.status = ?${pg.and} ORDER BY ${pg.order} LIMIT ${pg.fetch}`,
    [p.id, status, ...pg.params]
  )
  const { rows: page, next_cursor } = pg.finish(rows, (r) => [r.created_at, r.id])
  return c.json({
    next_cursor,
    comments: page.map((r) => {
      // Rule hint for the moderator (ROADMAP phase 10): a label only — the decision always stays with the team.
      const reasons = r.status === 'pending' && !r.is_team_reply ? flagComment(String(r.body || '')).reasons : []
      return { ...r, image: parseJson<string[]>(r.images_json, [])[0] || null, images_json: undefined, hint: reasons.length ? { label: ruleCommentLabel(reasons), reasons, source: 'rule' } : null }
    })
  })
})

/** Optional AI labels for the pending queue (on demand, never automatic). Only comment text is sent, redacted. */
commentsRoutes.post('/:pubId/comments/ai-hints', async (c) => {
  const { pub: p } = await pub(c)
  const rows = await c.get('db').all<{ id: string; body: string }>(
    "SELECT cm.id, cm.body FROM comments cm JOIN posts po ON po.id = cm.post_id WHERE po.publication_id = ? AND cm.status = 'pending' AND cm.is_team_reply = 0 ORDER BY cm.created_at DESC LIMIT 30",
    [p.id]
  )
  const enabled = (await getProvider(c)).enabled
  const labels = enabled ? await aiCommentLabels(c, rows) : {}
  return c.json({ enabled, labels })
})

commentsRoutes.post('/:pubId/comments/:cid', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const db = c.get('db')
  const cm = await db.first<any>('SELECT cm.* FROM comments cm JOIN posts po ON po.id = cm.post_id WHERE cm.id = ? AND po.publication_id = ?', [c.req.param('cid'), p.id])
  if (!cm) throw notFound('نظر یافت نشد')
  const b = await body<{ action?: string; reason?: string; reply?: string }>(c)
  const action = oneOf(b.action, ['approve', 'reject', 'spam', 'reply'] as const, 'اقدام')
  const now = nowIso()
  if (action === 'reply') {
    await db.run("INSERT INTO comments (id, post_id, user_id, parent_id, is_team_reply, body, status, moderated_by, moderated_at, created_at) VALUES (?,?,?,?,1,?, 'approved', ?, ?, ?)", [
      newId(), cm.post_id, user.id, cm.id, str(b.reply, 'متن پاسخ', { min: 2, max: 1000 }), user.id, now, now
    ])
    if (cm.status === 'pending') await db.run("UPDATE comments SET status = 'approved', moderated_by = ?, moderated_at = ? WHERE id = ?", [user.id, now, cm.id])
  } else {
    const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'spam'
    await db.run('UPDATE comments SET status = ?, moderated_by = ?, moderated_at = ?, reject_reason = ? WHERE id = ?', [status, user.id, now, status === 'rejected' ? str(b.reason, 'دلیل', { max: 200, optional: true }) : null, cm.id])
    if (cm.user_id && status !== 'spam') await notify(db, cm.user_id, 'comment.' + status, status === 'approved' ? 'نظر شما تأیید و منتشر شد' : 'نظر شما تأیید نشد', `/post/${cm.post_id}`)
  }
  await activity(db, user.id, 'comment.' + action, p.id, null, { id: cm.id })
  return c.json({ ok: true })
})

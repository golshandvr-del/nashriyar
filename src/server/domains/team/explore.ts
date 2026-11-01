// Team domain module: explore posts, stories, highlights (every post cites its source issue + section).
// Mounted by routes/team.ts (ROADMAP phase 17 split; parent middleware applies).
import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { newId } from '../../lib/crypto'
import { activity, addHours, bad, body, HttpError, notFound, notify, nowIso, oneOf, parseJson, str } from '../../lib/util'
import { pub } from './service'

export const exploreRoutes = new Hono<AppEnv>()

// ───────── Explore: posts, stories, highlights (every post MUST cite its source issue + section) ─────────
exploreRoutes.get('/:pubId/posts', async (c) => {
  const { pub: p } = await pub(c)
  const rows = await c.get('db').all<any>(
    `SELECT po.*, i.number AS source_issue_number, i.title AS source_issue_title, t.title AS source_toc_title,
       (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = po.id AND cm.status = 'pending') AS pending_comments
     FROM posts po JOIN issues i ON i.id = po.source_issue_id LEFT JOIN issue_toc_items t ON t.id = po.source_toc_item_id
     WHERE po.publication_id = ? ORDER BY po.created_at DESC LIMIT 300`,
    [p.id]
  )
  const highlights = await c.get('db').all<any>('SELECT h.*, (SELECT COUNT(*) FROM highlight_items hi WHERE hi.highlight_id = h.id) AS item_count FROM highlights h WHERE h.publication_id = ? ORDER BY sort_order', [p.id])
  const items = await c.get('db').all('SELECT hi.* FROM highlight_items hi JOIN highlights h ON h.id = hi.highlight_id WHERE h.publication_id = ?', [p.id])
  return c.json({ posts: rows.map((r) => ({ ...r, images: parseJson(r.images_json, []) })), highlights, highlight_items: items })
})

exploreRoutes.post('/:pubId/posts', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const db = c.get('db')
  const b = await body<any>(c)
  const images: string[] = (Array.isArray(b.images) ? b.images : []).filter((k: any) => typeof k === 'string' && k.startsWith(`pub/${p.id}/`)).slice(0, 10)
  if (!images.length) throw bad('اکسپلور فقط تصویری است؛ حداقل یک تصویر بارگذاری کنید')
  const src = await db.first<any>("SELECT id FROM issues WHERE id = ? AND publication_id = ? AND status = 'published' AND deleted_at IS NULL", [b.source_issue_id, p.id])
  if (!src) throw bad('منبع پست الزامی است: یک شمارهٔ منتشرشده از همین نشریه انتخاب کنید')
  const toc = await db.first('SELECT id FROM issue_toc_items WHERE id = ? AND issue_id = ?', [b.source_toc_item_id, src.id])
  if (!toc) throw bad('منبع پست الزامی است: بخش مربوط از فهرست مطالب آن شماره را انتخاب کنید')
  const isStory = b.is_story ? 1 : 0
  const id = newId()
  const now = nowIso()
  const status = b.draft ? 'draft' : 'published'
  // scheduled publishing (ROADMAP phase 6): a future publish_at keeps the post invisible until then (public queries filter published_at <= now)
  let publishAt = now
  if (b.publish_at && !isStory) {
    const t = Date.parse(String(b.publish_at))
    if (!Number.isFinite(t)) throw bad('زمان انتشار نامعتبر است')
    if (t > Date.now() + 90 * 86400_000) throw bad('زمان‌بندی حداکثر تا ۹۰ روز آینده ممکن است')
    if (t > Date.now()) publishAt = new Date(t).toISOString()
  }
  await db.run(
    'INSERT INTO posts (id, publication_id, kind, caption, images_json, source_issue_id, source_toc_item_id, is_story, expires_at, status, published_at, created_by, created_at, alt_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, p.id, images.length > 1 ? 'carousel' : 'image', str(b.caption, 'متن پست', { max: 2200, optional: true }), JSON.stringify(images), src.id, b.source_toc_item_id, isStory,
      isStory ? addHours(24) : null, status, status === 'published' ? publishAt : null, user.id, now, altJson(b.alt, images.length)]
  )
  await activity(db, user.id, isStory ? 'story.published' : 'post.published', p.id, src.id, { id, scheduled: publishAt !== now ? publishAt : undefined })
  // in-app notification to followers for immediately-published posts (ROADMAP phase 6); identities never exposed to the team
  if (status === 'published' && publishAt === now && !isStory) {
    const followers = await db.all<{ user_id: string }>('SELECT user_id FROM follows WHERE publication_id = ? AND unfollowed_at IS NULL LIMIT 2000', [p.id])
    for (const f of followers) await notify(db, f.user_id, 'post.published', `پست تازه از ${p.title}`, `/post/${id}`)
  }
  return c.json({ ok: true, id, published_at: status === 'published' ? publishAt : null })
})

exploreRoutes.put('/:pubId/posts/:postId', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const db = c.get('db')
  const po = await db.first<any>('SELECT * FROM posts WHERE id = ? AND publication_id = ?', [c.req.param('postId'), p.id])
  if (!po) throw notFound('پست یافت نشد')
  if (po.status === 'hidden_by_admin') throw forbiddenAdmin()
  const b = await body<any>(c)
  const status = b.status ? oneOf(b.status, ['draft', 'published', 'hidden_by_team'] as const, 'وضعیت') : po.status
  await db.run('UPDATE posts SET caption = ?, status = ?, published_at = COALESCE(published_at, CASE WHEN ? = \'published\' THEN ? END) WHERE id = ?', [
    b.caption !== undefined ? str(b.caption, 'متن پست', { max: 2200, optional: true }) : po.caption, status, status, nowIso(), po.id
  ])
  await activity(db, user.id, 'post.updated', p.id, po.source_issue_id, { id: po.id, status })
  return c.json({ ok: true })
})

/** Image alt texts (ROADMAP phase 6 accessibility): aligned with images_json; null when none provided. */
function altJson(v: unknown, n: number): string | null {
  if (!Array.isArray(v)) return null
  const out = v.slice(0, n).map((x) => (typeof x === 'string' ? x.trim().slice(0, 300) : ''))
  return out.some(Boolean) ? JSON.stringify(out) : null
}

function forbiddenAdmin() {
  return new HttpError(403, 'این پست توسط مسئول نشریات پنهان شده و قابل تغییر نیست')
}

exploreRoutes.post('/:pubId/highlights', async (c) => {
  const { pub: p } = await pub(c, true)
  const b = await body<any>(c)
  const id = newId()
  const db = c.get('db')
  const max = await db.first<{ n: number }>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM highlights WHERE publication_id = ?', [p.id])
  await db.run('INSERT INTO highlights (id, publication_id, title, sort_order, created_at) VALUES (?,?,?,?,?)', [id, p.id, str(b.title, 'عنوان هایلایت', { max: 40 }), max?.n ?? 0, nowIso()])
  return c.json({ ok: true, id })
})

exploreRoutes.put('/:pubId/highlights/:hid', async (c) => {
  const { pub: p } = await pub(c, true)
  const db = c.get('db')
  const h = await db.first('SELECT id FROM highlights WHERE id = ? AND publication_id = ?', [c.req.param('hid'), p.id])
  if (!h) throw notFound('هایلایت یافت نشد')
  const b = await body<{ title?: string; post_ids?: string[] }>(c)
  if (b.title) await db.run('UPDATE highlights SET title = ? WHERE id = ?', [str(b.title, 'عنوان', { max: 40 }), c.req.param('hid')])
  if (Array.isArray(b.post_ids)) {
    const valid = new Set((await db.all<{ id: string }>('SELECT id FROM posts WHERE publication_id = ?', [p.id])).map((r) => r.id))
    const stmts: { sql: string; params: unknown[] }[] = [{ sql: 'DELETE FROM highlight_items WHERE highlight_id = ?', params: [c.req.param('hid')] }]
    for (const pid of b.post_ids.slice(0, 100)) if (valid.has(pid)) stmts.push({ sql: 'INSERT OR IGNORE INTO highlight_items (highlight_id, post_id) VALUES (?,?)', params: [c.req.param('hid'), pid] })
    await db.batch(stmts)
  }
  return c.json({ ok: true })
})

exploreRoutes.delete('/:pubId/highlights/:hid', async (c) => {
  const { pub: p } = await pub(c, true)
  const db = c.get('db')
  await db.batch([
    { sql: 'DELETE FROM highlight_items WHERE highlight_id IN (SELECT id FROM highlights WHERE id = ? AND publication_id = ?)', params: [c.req.param('hid'), p.id] },
    { sql: 'DELETE FROM highlights WHERE id = ? AND publication_id = ?', params: [c.req.param('hid'), p.id] }
  ])
  return c.json({ ok: true })
})

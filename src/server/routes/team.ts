import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { requireUser, userPubRoles } from '../auth'
import { generatePurchaseCode, newId, normalizePurchaseCode, sha256 } from '../lib/crypto'
import { activity, addHours, audit, bad, body, cursorPage, dateRange, getSetting, HttpError, inList, int, notFound, notify, nowIso, oneOf, parseJson, str } from '../lib/util'
import { toEnDigits } from '../../shared/fa'
import { requireFeature } from '../lib/features'
import { aiCommentLabels, getProvider, ruleCommentLabel } from '../ai'
import { flagComment } from '../lib/moderation'
import { traceCode } from './reader'
import { DEFAULT_STAGES, issueOf, pub } from '../domains/team/service'
import { dashboardRoutes } from '../domains/team/dashboard'
import { membersRoutes } from '../domains/team/members'
import { issuesRoutes } from '../domains/team/issues'
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

// ───────── Purchase codes (no payment gateway; raw code shown once, only hash stored) ─────────
teamRoutes.get('/:pubId/codes', async (c) => {
  const { pub: p } = await pub(c)
  const issueId = c.req.query('issue')
  const params: unknown[] = [p.id]
  let w = ''
  if (issueId) (w = ' AND ac.issue_id = ?'), params.push(issueId)
  const now = nowIso()
  // ROADMAP phase 17: keyset pagination (?cursor, ?limit ≤ 500)
  const pg = cursorPage(c, { col: 'ac.created_at', idCol: 'ac.id', def: 500, max: 500 })
  const rows = await c.get('db').all<any>(
    `SELECT ac.id, ac.issue_id, ac.code_last4, ac.bound_student_number, ac.price_paid, ac.channel, ac.note, ac.created_at, ac.expires_at, ac.redeemed_at, ac.revoked_at,
       i.number AS issue_number, i.title AS issue_title, u.display_name AS redeemed_by_name, u.student_number AS redeemed_by_sn
     FROM access_codes ac JOIN issues i ON i.id = ac.issue_id LEFT JOIN users u ON u.id = ac.redeemed_by WHERE ac.publication_id = ?${w}${pg.and} ORDER BY ${pg.order} LIMIT ${pg.fetch}`,
    [...params, ...pg.params]
  )
  const { rows: page, next_cursor } = pg.finish(rows, (r) => [r.created_at, r.id])
  return c.json({
    codes: page.map((r) => ({ ...r, state: r.revoked_at ? 'revoked' : r.redeemed_at ? 'redeemed' : r.expires_at <= now ? 'expired' : 'active' })),
    next_cursor
  })
})

teamRoutes.post('/:pubId/codes', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const db = c.get('db')
  const b = await body<any>(c)
  const i = await issueOf(c, p.id, str(b.issue_id, 'شماره', { max: 40 }))
  if (i.status !== 'published') throw bad('کد خرید فقط برای شمارهٔ منتشرشده ساخته می‌شود')
  if (i.pricing !== 'paid') throw bad('این شماره رایگان است و نیازی به کد ندارد')
  const count = int(b.count ?? 1, 'تعداد', { min: 1, max: 100 })!
  const ttlHours = Math.min(24, int(b.ttl_hours ?? i.code_ttl_hours ?? 24, 'مدت اعتبار (ساعت)', { min: 1, max: 24 })!)
  const bound = b.student_number ? toEnDigits(String(b.student_number)).replace(/\D/g, '') : null
  if (bound && count > 1) throw bad('کد متصل به شماره دانشجویی فقط به‌صورت تکی ساخته می‌شود')
  const channel = oneOf(b.channel, ['card_to_card', 'cash', 'gift', 'other'] as const, 'روش پرداخت', 'card_to_card')
  const price = b.price_paid === '' || b.price_paid == null ? i.price_digital : int(b.price_paid, 'مبلغ', { min: 0, max: 100_000_000 })
  const now = nowIso()
  const expires = addHours(ttlHours)
  const codes: string[] = []
  const stmts: { sql: string; params: unknown[] }[] = []
  for (let k = 0; k < count; k++) {
    const code = generatePurchaseCode()
    codes.push(code)
    const norm = normalizePurchaseCode(code)
    stmts.push({
      sql: 'INSERT INTO access_codes (id, issue_id, publication_id, code_hash, code_last4, bound_student_number, price_paid, channel, note, created_by, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      params: [newId(), i.id, p.id, await sha256(norm), norm.slice(-4), bound, price, channel, str(b.note, 'یادداشت', { max: 200, optional: true }), user.id, now, expires]
    })
  }
  await db.batch(stmts)
  await activity(db, user.id, 'codes.created', p.id, i.id, { count, ttlHours })
  await audit(db, user.id, 'codes.create', 'issue', i.id, null, { count, ttlHours, bound: !!bound })
  return c.json({ ok: true, codes, expires_at: expires, issue: { id: i.id, number: i.number, title: i.title } })
})

teamRoutes.post('/:pubId/codes/:codeId/revoke', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const db = c.get('db')
  const r = await db.run('UPDATE access_codes SET revoked_at = ? WHERE id = ? AND publication_id = ? AND redeemed_at IS NULL AND revoked_at IS NULL', [nowIso(), c.req.param('codeId'), p.id])
  if (!r.changes) throw bad('این کد قابل ابطال نیست (استفاده‌شده یا قبلاً باطل‌شده)')
  await audit(db, user.id, 'codes.revoke', 'access_code', c.req.param('codeId'))
  return c.json({ ok: true })
})

/**
 * Resolve an invisible-watermark code found in a leaked page image (ROADMAP phase 5).
 * Stateless: recompute HMAC(user|issue) for everyone who could read this issue and compare.
 */
teamRoutes.post('/:pubId/issues/:issueId/trace', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  const b = await body<{ code?: string }>(c)
  const code = str(b.code, 'کد ردیابی', { max: 16 }).toLowerCase().replace(/[^0-9a-f]/g, '')
  if (code.length !== 8) throw bad('کد ردیابی باید ۸ نویسهٔ هگز باشد')
  const db = c.get('db')
  const readers = await db.all<{ id: string; student_number: string | null; username: string; display_name: string | null }>(
    `SELECT u.id, u.student_number, u.username, u.display_name FROM users u WHERE u.id IN (
       SELECT user_id FROM entitlements WHERE issue_id = ? UNION SELECT user_id FROM reading_progress WHERE issue_id = ?)`,
    [i.id, i.id]
  )
  const secret = c.get('deps').secret
  let match: (typeof readers)[number] | null = null
  for (const r of readers) if ((await traceCode(secret, r.id, i.id)) === code) { match = r; break }
  await audit(db, user.id, 'watermark.trace', 'issue', i.id, null, { code, found: !!match })
  return c.json({ ok: true, checked: readers.length, match: match && { student_number: match.student_number, username: match.username, display_name: match.display_name } })
})

/** Revoke a reader's access to an issue (abuse handling). */
teamRoutes.post('/:pubId/issues/:issueId/revoke-reader', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  const b = await body<{ student_number?: string; reason?: string }>(c)
  const sn = toEnDigits(str(b.student_number, 'شماره دانشجویی', { max: 20 }))
  const db = c.get('db')
  const u = await db.first<{ id: string }>('SELECT id FROM users WHERE student_number = ?', [sn])
  if (!u) throw notFound('کاربری با این شماره دانشجویی یافت نشد')
  const r = await db.run('UPDATE entitlements SET revoked_at = ? WHERE user_id = ? AND issue_id = ? AND revoked_at IS NULL', [nowIso(), u.id, i.id])
  if (!r.changes) throw bad('این کاربر دسترسی فعالی به این شماره ندارد')
  await audit(db, user.id, 'entitlement.revoke', 'issue', i.id, null, { student_number: sn, reason: b.reason || null })
  return c.json({ ok: true })
})

teamRoutes.get('/:pubId/physical-sales', async (c) => {
  const { pub: p } = await pub(c)
  // ROADMAP phase 17: keyset pagination (?cursor, ?limit ≤ 300)
  const pg = cursorPage(c, { col: 'ps.sold_at', idCol: 'ps.id', def: 300, max: 300 })
  const rows = await c.get('db').all<any>(
    `SELECT ps.*, i.number AS issue_number, i.title AS issue_title FROM physical_sales ps JOIN issues i ON i.id = ps.issue_id WHERE ps.publication_id = ?${pg.and} ORDER BY ${pg.order} LIMIT ${pg.fetch}`,
    [p.id, ...pg.params]
  )
  const { rows: sales, next_cursor } = pg.finish(rows, (r) => [r.sold_at, r.id])
  return c.json({ sales, next_cursor })
})

teamRoutes.post('/:pubId/physical-sales', async (c) => {
  await requireFeature(c.get('db'), 'physical_sales')
  const { pub: p, user } = await pub(c, true)
  const b = await body<any>(c)
  const i = await issueOf(c, p.id, str(b.issue_id, 'شماره', { max: 40 }))
  const id = newId()
  await c.get('db').run('INSERT INTO physical_sales (id, issue_id, publication_id, quantity, unit_price, sold_at, channel, recorded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [
    id, i.id, p.id, int(b.quantity, 'تعداد', { min: 1, max: 100000 }), int(b.unit_price ?? i.price_print, 'قیمت واحد', { min: 0, max: 100_000_000, optional: true }),
    str(b.sold_at, 'تاریخ فروش', { max: 10, optional: true }) || nowIso().slice(0, 10), str(b.channel, 'محل فروش', { max: 60, optional: true }), user.id, nowIso()
  ])
  await activity(c.get('db'), user.id, 'physical_sale.recorded', p.id, i.id, { qty: b.quantity })
  return c.json({ ok: true, id })
})

teamRoutes.delete('/:pubId/physical-sales/:id', async (c) => {
  const { pub: p, user } = await pub(c, true)
  await c.get('db').run('DELETE FROM physical_sales WHERE id = ? AND publication_id = ?', [c.req.param('id'), p.id])
  await audit(c.get('db'), user.id, 'physical_sale.delete', 'physical_sale', c.req.param('id'))
  return c.json({ ok: true })
})

// ───────── Explore: posts, stories, highlights (every post MUST cite its source issue + section) ─────────
teamRoutes.get('/:pubId/posts', async (c) => {
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

teamRoutes.post('/:pubId/posts', async (c) => {
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

teamRoutes.put('/:pubId/posts/:postId', async (c) => {
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

teamRoutes.post('/:pubId/highlights', async (c) => {
  const { pub: p } = await pub(c, true)
  const b = await body<any>(c)
  const id = newId()
  const db = c.get('db')
  const max = await db.first<{ n: number }>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM highlights WHERE publication_id = ?', [p.id])
  await db.run('INSERT INTO highlights (id, publication_id, title, sort_order, created_at) VALUES (?,?,?,?,?)', [id, p.id, str(b.title, 'عنوان هایلایت', { max: 40 }), max?.n ?? 0, nowIso()])
  return c.json({ ok: true, id })
})

teamRoutes.put('/:pubId/highlights/:hid', async (c) => {
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

teamRoutes.delete('/:pubId/highlights/:hid', async (c) => {
  const { pub: p } = await pub(c, true)
  const db = c.get('db')
  await db.batch([
    { sql: 'DELETE FROM highlight_items WHERE highlight_id IN (SELECT id FROM highlights WHERE id = ? AND publication_id = ?)', params: [c.req.param('hid'), p.id] },
    { sql: 'DELETE FROM highlights WHERE id = ? AND publication_id = ?', params: [c.req.param('hid'), p.id] }
  ])
  return c.json({ ok: true })
})

// ── Comment moderation (comments appear only after approval) ──
teamRoutes.get('/:pubId/comments', async (c) => {
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
teamRoutes.post('/:pubId/comments/ai-hints', async (c) => {
  const { pub: p } = await pub(c)
  const rows = await c.get('db').all<{ id: string; body: string }>(
    "SELECT cm.id, cm.body FROM comments cm JOIN posts po ON po.id = cm.post_id WHERE po.publication_id = ? AND cm.status = 'pending' AND cm.is_team_reply = 0 ORDER BY cm.created_at DESC LIMIT 30",
    [p.id]
  )
  const enabled = (await getProvider(c)).enabled
  const labels = enabled ? await aiCommentLabels(c, rows) : {}
  return c.json({ enabled, labels })
})

teamRoutes.post('/:pubId/comments/:cid', async (c) => {
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

// ── Recruitment calls ──
teamRoutes.get('/:pubId/recruitment', async (c) => {
  const { pub: p } = await pub(c)
  return c.json({ calls: await c.get('db').all('SELECT * FROM recruitment_calls WHERE publication_id = ? ORDER BY created_at DESC', [p.id]) })
})

teamRoutes.post('/:pubId/recruitment', async (c) => {
  const { pub: p } = await pub(c, true)
  const b = await body<any>(c)
  const id = newId()
  await c.get('db').run('INSERT INTO recruitment_calls (id, publication_id, title, roles_needed, body, contact, open_until, created_at) VALUES (?,?,?,?,?,?,?,?)', [
    id, p.id, str(b.title, 'عنوان', { max: 120 }), str(b.roles_needed, 'نقش‌های مورد نیاز', { max: 300, optional: true }), str(b.body, 'توضیحات', { max: 3000, optional: true }),
    str(b.contact, 'راه ارتباط', { max: 120, optional: true }), b.open_until || null, nowIso()
  ])
  return c.json({ ok: true, id })
})

teamRoutes.delete('/:pubId/recruitment/:id', async (c) => {
  const { pub: p } = await pub(c, true)
  await c.get('db').run('DELETE FROM recruitment_calls WHERE id = ? AND publication_id = ?', [c.req.param('id'), p.id])
  return c.json({ ok: true })
})

// ── Certificates of collaboration ──
teamRoutes.post('/:pubId/issues/:issueId/certificates', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const db = c.get('db')
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  if (i.status !== 'published') throw bad('گواهی همکاری فقط برای شمارهٔ منتشرشده صادر می‌شود')
  const members = await db.all<{ team_member_id: string; roles: string }>(
    `SELECT team_member_id, GROUP_CONCAT(production_role, '، ') AS roles FROM issue_members WHERE issue_id = ? GROUP BY team_member_id`,
    [i.id]
  )
  let created = 0
  for (const m of members) {
    if (await db.first('SELECT 1 FROM certificates WHERE team_member_id = ? AND issue_id = ?', [m.team_member_id, i.id])) continue
    const code = 'C' + newId().slice(-9).toUpperCase()
    await db.run('INSERT INTO certificates (id, verify_code, team_member_id, issue_id, roles, issued_at) VALUES (?,?,?,?,?,?)', [newId(), code, m.team_member_id, i.id, m.roles, nowIso()])
    created++
  }
  await activity(db, user.id, 'certificates.issued', p.id, i.id, { created })
  const list = await db.all(
    'SELECT ce.verify_code, ce.roles, ce.issued_at, tm.full_name FROM certificates ce JOIN team_members tm ON tm.id = ce.team_member_id WHERE ce.issue_id = ? ORDER BY tm.full_name',
    [i.id]
  )
  return c.json({ ok: true, created, certificates: list })
})

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

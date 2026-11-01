// Team domain module: purchase codes, reader tracing/revocation, physical sales.
// Mounted by routes/team.ts (ROADMAP phase 17 split; parent middleware applies).
import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { generatePurchaseCode, newId, normalizePurchaseCode, sha256 } from '../../lib/crypto'
import { activity, addHours, audit, bad, body, cursorPage, int, notFound, nowIso, oneOf, str } from '../../lib/util'
import { toEnDigits } from '../../../shared/fa'
import { requireFeature } from '../../lib/features'
import { traceCode } from '../../routes/reader'
import { issueOf, pub } from './service'

export const salesRoutes = new Hono<AppEnv>()

// ───────── Purchase codes (no payment gateway; raw code shown once, only hash stored) ─────────
salesRoutes.get('/:pubId/codes', async (c) => {
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

salesRoutes.post('/:pubId/codes', async (c) => {
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

salesRoutes.post('/:pubId/codes/:codeId/revoke', async (c) => {
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
salesRoutes.post('/:pubId/issues/:issueId/trace', async (c) => {
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
salesRoutes.post('/:pubId/issues/:issueId/revoke-reader', async (c) => {
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

salesRoutes.get('/:pubId/physical-sales', async (c) => {
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

salesRoutes.post('/:pubId/physical-sales', async (c) => {
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

salesRoutes.delete('/:pubId/physical-sales/:id', async (c) => {
  const { pub: p, user } = await pub(c, true)
  await c.get('db').run('DELETE FROM physical_sales WHERE id = ? AND publication_id = ?', [c.req.param('id'), p.id])
  await audit(c.get('db'), user.id, 'physical_sale.delete', 'physical_sale', c.req.param('id'))
  return c.json({ ok: true })
})

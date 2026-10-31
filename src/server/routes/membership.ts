// Team membership requests (ROADMAP phase 15): a student asks to join a publication team with a requested production
// role; the managing director / editor-in-chief of that publication or the publications officer approves or rejects.
// Approval links the account to a team member record (existing record with the same student number, or a new one).
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../context'
import type { Db } from '../adapters/db'
import { requireUser } from '../auth'
import { newId } from '../lib/crypto'
import { activity, audit, bad, body, HttpError, notFound, notify, nowIso, oneOf, str } from '../lib/util'
import { normalizeFa } from '../../shared/fa'

export const membershipRoutes = new Hono<AppEnv>()

const DECIDER_ROLES = ['managing_director', 'editor_in_chief']
const MAX_PENDING = 3

const isAdminRole = (r: string) => r === 'super_admin' || r === 'pub_officer'

/** Publications a user may pick when asking to join: searchable, filterable by faculty, association and subject. */
export async function joinablePublications(db: Db, f: { q?: string; faculty?: string; association?: string; category?: string }) {
  const where = ["p.deleted_at IS NULL", "p.status = 'active'"]
  const params: unknown[] = []
  const q = normalizeFa(f.q || '').trim()
  if (q) (where.push('(p.title LIKE ? OR p.search_text LIKE ? OR a.name LIKE ?)'), params.push(`%${q}%`, `%${q}%`, `%${q}%`))
  if (f.faculty) (where.push('p.faculty_id = ?'), params.push(f.faculty))
  if (f.association) (where.push('p.association_id = ?'), params.push(f.association))
  if (f.category) (where.push('EXISTS (SELECT 1 FROM publication_categories pc WHERE pc.publication_id = p.id AND pc.category_id = ?)'), params.push(f.category))
  return db.all(
    `SELECT p.id, p.title, p.slug, p.tagline, p.theme_color, p.faculty_id, f.name AS faculty_name, a.id AS association_id, a.name AS association_name, a.kind AS association_kind
       FROM publications p JOIN associations a ON a.id = p.association_id LEFT JOIN faculties f ON f.id = p.faculty_id
      WHERE ${where.join(' AND ')} ORDER BY p.title LIMIT 200`,
    params
  )
}

/** Validates and stores one membership request; shared by POST /requests and the two-path registration. */
export async function createMembershipRequest(db: Db, userId: string, b: { publication_id?: string; role_name?: string; message?: string }) {
  const pubId = str(b.publication_id, 'نشریه', { max: 40 })
  const p = await db.first<{ id: string; title: string }>("SELECT id, title FROM publications WHERE id = ? AND deleted_at IS NULL AND status = 'active'", [pubId])
  if (!p) throw bad('نشریهٔ انتخاب‌شده فعال نیست')
  const roles = await db.all<{ name: string }>('SELECT name FROM production_roles ORDER BY sort_order, name')
  const roleName = str(b.role_name, 'سمت درخواستی', { max: 60, optional: true }) || null
  if (roleName && roles.length && !roles.some((r) => r.name === roleName)) throw bad('سمت درخواستی در فهرست نقش‌های تعریف‌شده نیست')
  const message = str(b.message, 'پیام', { max: 500, optional: true }) || null
  if (await db.first("SELECT id FROM membership_requests WHERE user_id = ? AND publication_id = ? AND status = 'pending'", [userId, p.id]))
    throw bad('برای این نشریه درخواست در انتظار دارید')
  const u = await db.first<{ student_number: string | null }>('SELECT student_number FROM users WHERE id = ?', [userId])
  if (u?.student_number && (await db.first('SELECT id FROM team_members WHERE publication_id = ? AND is_active = 1 AND (user_id = ? OR student_number = ?)', [p.id, userId, u.student_number])))
    throw bad('شما هم‌اکنون عضو تیم این نشریه هستید')
  const pending = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM membership_requests WHERE user_id = ? AND status = 'pending'", [userId])
  if ((pending?.n ?? 0) >= MAX_PENDING) throw bad(`حداکثر ${MAX_PENDING} درخواست در انتظار مجاز است`)
  const id = newId()
  await db.run('INSERT INTO membership_requests (id, user_id, publication_id, role_name, message, status, created_at) VALUES (?,?,?,?,?,?,?)', [
    id, userId, p.id, roleName, message, 'pending', nowIso()
  ])
  const deciders = await db.all<{ user_id: string }>(
    `SELECT DISTINCT user_id FROM publication_roles WHERE publication_id = ? AND ended_at IS NULL AND role IN (${DECIDER_ROLES.map(() => '?').join(',')})`,
    [p.id, ...DECIDER_ROLES]
  )
  for (const d of deciders) await notify(db, d.user_id, 'membership.requested', `درخواست عضویت تازه در تیم «${p.title}»`, `/team/${p.id}/members?tab=requests`)
  await activity(db, userId, 'membership.requested', p.id, null, { id, role: roleName })
  return { id, publication: p }
}

/** Who may decide on a publication's requests: admins, or its managing director / editor-in-chief. */
async function canDecide(c: Context<AppEnv>, pubId: string) {
  const u = requireUser(c)
  if (isAdminRole(u.system_role)) return u
  const r = await c.get('db').first(
    `SELECT id FROM publication_roles WHERE user_id = ? AND publication_id = ? AND ended_at IS NULL AND role IN (${DECIDER_ROLES.map(() => '?').join(',')})`,
    [u.id, pubId, ...DECIDER_ROLES]
  )
  if (!r) throw new HttpError(403, 'فقط مدیرمسئول، سردبیر یا مسئول نشریات می‌تواند درخواست‌ها را بررسی کند')
  return u
}

// ───── public: picker data for the registration form ─────
membershipRoutes.get('/options', async (c) => {
  const db = c.get('db')
  const [publications, roles, faculties, associations, categories] = await Promise.all([
    joinablePublications(db, { q: c.req.query('q'), faculty: c.req.query('faculty'), association: c.req.query('association'), category: c.req.query('category') }),
    db.all('SELECT id, name FROM production_roles ORDER BY sort_order, name'),
    db.all('SELECT id, name FROM faculties WHERE is_active = 1 ORDER BY sort_order, name'),
    db.all('SELECT id, name, kind, faculty_id FROM associations WHERE is_active = 1 ORDER BY name'),
    db.all("SELECT id, name FROM categories WHERE type = 'subject' ORDER BY sort_order, name").catch(() => [])
  ])
  return c.json({ publications, roles, faculties, associations, categories })
})

// ───── the requester ─────
membershipRoutes.get('/mine', async (c) => {
  const u = requireUser(c)
  const rows = await c.get('db').all(
    `SELECT r.id, r.status, r.role_name, r.message, r.decision_note, r.created_at, r.decided_at, p.id AS publication_id, p.title, p.slug
       FROM membership_requests r JOIN publications p ON p.id = r.publication_id WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 50`,
    [u.id]
  )
  return c.json({ requests: rows })
})

membershipRoutes.post('/requests', async (c) => {
  const u = requireUser(c)
  const r = await createMembershipRequest(c.get('db'), u.id, await body(c))
  return c.json({ ok: true, id: r.id })
})

membershipRoutes.delete('/requests/:id', async (c) => {
  const u = requireUser(c)
  const r = await c.get('db').run("UPDATE membership_requests SET status = 'cancelled', decided_at = ? WHERE id = ? AND user_id = ? AND status = 'pending'", [
    nowIso(), c.req.param('id'), u.id
  ])
  if (!r.changes) throw notFound('درخواست در انتظاری یافت نشد')
  return c.json({ ok: true })
})

// ───── deciders ─────
membershipRoutes.get('/queue', async (c) => {
  const u = requireUser(c)
  const db = c.get('db')
  const pubId = c.req.query('publication_id')
  const status = c.req.query('status') || 'pending'
  if (pubId) await canDecide(c, pubId)
  else if (!isAdminRole(u.system_role)) throw new HttpError(403, 'نشریه را مشخص کنید')
  const where = ['1=1']
  const params: unknown[] = []
  if (pubId) (where.push('r.publication_id = ?'), params.push(pubId))
  if (status !== 'all') (where.push('r.status = ?'), params.push(oneOf(status, ['pending', 'approved', 'rejected', 'cancelled'] as const, 'وضعیت')))
  const rows = await db.all(
    `SELECT r.id, r.status, r.role_name, r.message, r.decision_note, r.created_at, r.decided_at, r.publication_id, p.title AS publication_title,
            us.id AS user_id, us.display_name, us.username, us.student_number, us.degree, us.entry_year, us.profile_completed_at, f.name AS faculty_name, m.name AS major_name,
            d.display_name AS decided_by_name
       FROM membership_requests r JOIN publications p ON p.id = r.publication_id JOIN users us ON us.id = r.user_id
       LEFT JOIN faculties f ON f.id = us.faculty_id LEFT JOIN majors m ON m.id = us.major_id LEFT JOIN users d ON d.id = r.decided_by
      WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC LIMIT 300`,
    params
  )
  return c.json({ requests: rows })
})

membershipRoutes.post('/requests/:id/decide', async (c) => {
  const db = c.get('db')
  const req = await db.first<any>('SELECT * FROM membership_requests WHERE id = ?', [c.req.param('id')])
  if (!req) throw notFound('درخواست یافت نشد')
  const u = await canDecide(c, req.publication_id)
  if (req.status !== 'pending') throw bad('این درخواست قبلاً بررسی شده است')
  const b = await body<{ decision?: string; note?: string; role_name?: string }>(c)
  const decision = oneOf(b.decision, ['approve', 'reject'] as const, 'تصمیم')
  const note = str(b.note, 'یادداشت', { max: 300, optional: true }) || null
  const p = await db.first<{ id: string; title: string }>('SELECT id, title FROM publications WHERE id = ?', [req.publication_id])
  const now = nowIso()
  if (decision === 'reject') {
    await db.run("UPDATE membership_requests SET status = 'rejected', decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?", [u.id, now, note, req.id])
    await notify(db, req.user_id, 'membership.rejected', `درخواست عضویت شما در «${p?.title}» پذیرفته نشد${note ? `: ${note}` : ''}`, '/settings')
    await audit(db, u.id, 'membership.rejected', 'membership_request', req.id)
    return c.json({ ok: true })
  }
  const who = await db.first<any>('SELECT id, display_name, student_number, faculty_id, major_id, phone FROM users WHERE id = ? AND deleted_at IS NULL', [req.user_id])
  if (!who) throw bad('حساب درخواست‌دهنده دیگر وجود ندارد')
  const role = str(b.role_name, 'سمت', { max: 60, optional: true }) || req.role_name || null
  // link an existing record (same account or same student number) before creating a new one
  const existing = await db.first<{ id: string }>(
    'SELECT id FROM team_members WHERE publication_id = ? AND (user_id = ? OR (user_id IS NULL AND ? IS NOT NULL AND student_number = ?)) ORDER BY is_active DESC LIMIT 1',
    [req.publication_id, who.id, who.student_number, who.student_number]
  )
  const memberId = existing?.id || newId()
  const stmts: { sql: string; params: unknown[] }[] = []
  if (existing)
    stmts.push({
      sql: 'UPDATE team_members SET user_id = ?, is_active = 1, left_at = NULL, default_role = COALESCE(?, default_role), full_name = ? WHERE id = ?',
      params: [who.id, role, who.display_name, memberId]
    })
  else
    stmts.push({
      sql: 'INSERT INTO team_members (id, publication_id, user_id, full_name, student_number, faculty_id, major_id, default_role, phone, joined_at, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)',
      params: [memberId, req.publication_id, who.id, who.display_name, who.student_number, who.faculty_id, who.major_id, role, who.phone, now.slice(0, 10), now]
    })
  stmts.push({
    sql: "UPDATE membership_requests SET status = 'approved', decided_by = ?, decided_at = ?, decision_note = ?, team_member_id = ?, role_name = ? WHERE id = ?",
    params: [u.id, now, note, memberId, role, req.id]
  })
  await db.batch(stmts)
  await notify(db, req.user_id, 'membership.approved', `به تیم «${p?.title}» خوش آمدید${role ? ` (سمت: ${role})` : ''}`, '/desk')
  await activity(db, u.id, 'member.added', req.publication_id, null, { id: memberId, name: who.display_name, via: 'request' })
  await audit(db, u.id, 'membership.approved', 'membership_request', req.id, null, { team_member_id: memberId, role })
  return c.json({ ok: true, team_member_id: memberId })
})

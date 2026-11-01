// Admin domain module: system users (staff & students).
// Mounted by routes/admin.ts (ROADMAP phase 17 split; parent middleware applies).
import { Hono } from 'hono'
import type { AppEnv, SystemRole } from '../../context'
import { hashPassword, newId, tempPassword } from '../../lib/crypto'
import { audit, bad, body, cursorPage, int, notFound, nowIso, oneOf, str } from '../../lib/util'
import { normalizeFa, toEnDigits } from '../../../shared/fa'
import { PUB_ROLES, admin } from './service'

export const usersRoutes = new Hono<AppEnv>()

// ───────── Users (system staff & students) ─────────
usersRoutes.get('/users', async (c) => {
  admin(c)
  const role = c.req.query('role')
  const q = normalizeFa(c.req.query('q') || '')
  const where = ['u.deleted_at IS NULL']
  const params: unknown[] = []
  if (role) (where.push('u.system_role = ?'), params.push(role))
  if (q) (where.push('(u.display_name LIKE ? OR u.username LIKE ? OR u.student_number LIKE ?)'), params.push(`%${q}%`, `%${q}%`, `%${q}%`))
  // ROADMAP phase 15 filters: publication role, production role (officer-defined), publication, faculty, gender, degree, entry year.
  // "Team" = holds a publication role OR is linked to an active team member record.
  const f = (k: string) => c.req.query(k) || ''
  const team = `(EXISTS (SELECT 1 FROM publication_roles r WHERE r.user_id = u.id AND r.ended_at IS NULL${f('publication_id') ? ' AND r.publication_id = ?' : ''})
     OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id = u.id AND tm.is_active = 1${f('publication_id') ? ' AND tm.publication_id = ?' : ''}))`
  if (f('category') === 'team' || f('publication_id')) (where.push(team), f('publication_id') && params.push(f('publication_id'), f('publication_id')))
  if (f('pub_role')) (where.push('EXISTS (SELECT 1 FROM publication_roles r WHERE r.user_id = u.id AND r.ended_at IS NULL AND r.role = ?)'), params.push(oneOf(f('pub_role'), PUB_ROLES, 'سمت نشریه')))
  if (f('production_role')) (where.push('EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id = u.id AND tm.is_active = 1 AND tm.default_role = ?)'), params.push(f('production_role')))
  if (f('faculty_id')) (where.push('u.faculty_id = ?'), params.push(f('faculty_id')))
  if (f('degree')) (where.push('u.degree = ?'), params.push(oneOf(f('degree'), ['associate', 'bachelor', 'master', 'phd'] as const, 'مقطع')))
  if (f('entry_year')) (where.push('u.entry_year = ?'), params.push(int(f('entry_year'), 'سال ورود', { min: 1300, max: 1500 })))
  // gender is a consented sensitive field: filtering by it is officer-only and only matches people who consented
  if (f('gender')) (where.push('u.gender = ? AND u.profile_consent_at IS NOT NULL'), params.push(oneOf(f('gender'), ['male', 'female'] as const, 'جنسیت')))
  const db = c.get('db')
  // ROADMAP phase 17: keyset pagination (?cursor, ?limit ≤ 300)
  const pg = cursorPage(c, { col: 'u.created_at', idCol: 'u.id', def: 300, max: 300 })
  const rows = await db.all<any>(
    `SELECT u.id, u.username, u.display_name, u.student_number, u.system_role, u.status, u.scope_faculty_id, u.last_login_at, u.created_at, u.must_change_password, u.totp_enabled, f.name AS faculty_name,
       u.degree, u.entry_year,
       (SELECT GROUP_CONCAT(p.title, '، ') FROM publication_roles r JOIN publications p ON p.id = r.publication_id WHERE r.user_id = u.id AND r.ended_at IS NULL) AS publications,
       (SELECT GROUP_CONCAT(r.role) FROM publication_roles r WHERE r.user_id = u.id AND r.ended_at IS NULL) AS pub_roles,
       (SELECT GROUP_CONCAT(p.title || COALESCE(' · ' || tm.default_role, ''), '، ') FROM team_members tm JOIN publications p ON p.id = tm.publication_id WHERE tm.user_id = u.id AND tm.is_active = 1) AS memberships
     FROM users u LEFT JOIN faculties f ON f.id = u.faculty_id WHERE ${where.join(' AND ')}${pg.and} ORDER BY ${pg.order} LIMIT ${pg.fetch}`,
    [...params, ...pg.params]
  )
  const { rows: users, next_cursor } = pg.finish(rows, (r) => [r.created_at, r.id])
  // filter options: production roles in the officer-defined display order
  const production_roles = await db.all('SELECT id, name FROM production_roles ORDER BY sort_order, name')
  return c.json({ users, production_roles, next_cursor })
})

usersRoutes.post('/users', async (c) => {
  const u = admin(c)
  const b = await body<any>(c)
  const allowed: SystemRole[] = u.system_role === 'super_admin' ? ['pub_officer', 'faculty_supervisor', 'analyst'] : ['faculty_supervisor', 'analyst']
  const role = oneOf(b.system_role, allowed, 'نقش')
  const db = c.get('db')
  const username = toEnDigits(str(b.username, 'نام کاربری', { min: 3, max: 40 })).toLowerCase()
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw bad('نام کاربری فقط حروف لاتین، عدد و . _ - مجاز است')
  if (await db.first('SELECT 1 FROM users WHERE username = ?', [username])) throw bad('این نام کاربری قبلاً استفاده شده است')
  if (role === 'faculty_supervisor' && !b.scope_faculty_id) throw bad('برای ناظر دانشکده، دانشکده را انتخاب کنید')
  const pw = tempPassword()
  const id = newId()
  const name = str(b.display_name, 'نام', { min: 2, max: 80 })
  await db.run('INSERT INTO users (id, username, display_name, password_hash, must_change_password, system_role, scope_faculty_id, created_at) VALUES (?,?,?,?,1,?,?,?)', [
    id, username, name, await hashPassword(pw), role, role === 'faculty_supervisor' ? b.scope_faculty_id : null, nowIso()
  ])
  await audit(db, u.id, 'user.create', 'user', id, null, { username, role })
  return c.json({ ok: true, id, credentials: { name, username, password: pw } })
})

usersRoutes.post('/users/:id/status', async (c) => {
  const u = admin(c)
  const b = await body<{ status?: string }>(c)
  const status = oneOf(b.status, ['active', 'suspended'] as const, 'وضعیت')
  const db = c.get('db')
  const t = await db.first<any>('SELECT id, system_role FROM users WHERE id = ?', [c.req.param('id')])
  if (!t) throw notFound('کاربر یافت نشد')
  if (t.id === u.id) throw bad('نمی‌توانید حساب خودتان را غیرفعال کنید')
  if (['super_admin', 'pub_officer'].includes(t.system_role) && u.system_role !== 'super_admin') throw bad('دسترسی ندارید')
  await db.run('UPDATE users SET status = ? WHERE id = ?', [status, t.id])
  if (status === 'suspended') await db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), t.id])
  await audit(db, u.id, 'user.status', 'user', t.id, null, { status })
  return c.json({ ok: true })
})

usersRoutes.get('/team-users', async (c) => {
  admin(c)
  const rows = await c.get('db').all("SELECT id, username, display_name FROM users WHERE system_role = 'team' AND deleted_at IS NULL ORDER BY display_name")
  return c.json({ users: rows })
})

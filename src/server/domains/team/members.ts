// Team domain module: publication members (no follower data — docs/ROLES.md rule 2).
// Mounted by routes/team.ts (ROADMAP phase 17 split; parent middleware applies).
import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { newId } from '../../lib/crypto'
import { activity, body, notFound, nowIso, str } from '../../lib/util'
import { toEnDigits } from '../../../shared/fa'
import { pub } from './service'

export const membersRoutes = new Hono<AppEnv>()

// ───────── Members ─────────
membersRoutes.get('/:pubId/members', async (c) => {
  const { pub: p } = await pub(c)
  const db = c.get('db')
  const members = await db.all(
    `SELECT tm.*, f.name AS faculty_name, m.name AS major_name,
       (SELECT COUNT(DISTINCT im.issue_id) FROM issue_members im WHERE im.team_member_id = tm.id) AS issue_count,
       (SELECT COUNT(*) FROM toc_assignments ta WHERE ta.team_member_id = tm.id) AS section_count
     FROM team_members tm LEFT JOIN faculties f ON f.id = tm.faculty_id LEFT JOIN majors m ON m.id = tm.major_id
     WHERE tm.publication_id = ? ORDER BY tm.is_active DESC, tm.full_name`,
    [p.id]
  )
  const roles = await db.all('SELECT id, name FROM production_roles ORDER BY sort_order, name')
  return c.json({ members, roles })
})

function memberFields(b: any) {
  return {
    full_name: str(b.full_name, 'نام و نام خانوادگی', { min: 2, max: 80 }),
    student_number: toEnDigits(str(b.student_number, 'شماره دانشجویی', { max: 20, optional: true })),
    faculty_id: b.faculty_id || null,
    major_id: b.major_id || null,
    default_role: str(b.default_role, 'نقش پیش‌فرض', { max: 120, optional: true }),
    phone: toEnDigits(str(b.phone, 'تلفن', { max: 20, optional: true })),
    joined_at: str(b.joined_at, 'تاریخ پیوستن', { max: 10, optional: true }) || null
  }
}

membersRoutes.post('/:pubId/members', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const f = memberFields(await body(c))
  const id = newId()
  const db = c.get('db')
  await db.run(
    'INSERT INTO team_members (id, publication_id, full_name, student_number, faculty_id, major_id, default_role, phone, joined_at, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?)',
    [id, p.id, f.full_name, f.student_number || null, f.faculty_id, f.major_id, f.default_role, f.phone, f.joined_at || nowIso().slice(0, 10), nowIso()]
  )
  await activity(db, user.id, 'member.added', p.id, null, { id, name: f.full_name })
  return c.json({ ok: true, id })
})

membersRoutes.put('/:pubId/members/:id', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const b = await body<any>(c)
  const f = memberFields(b)
  const db = c.get('db')
  const active = b.is_active === false || b.is_active === 0 ? 0 : 1
  const r = await db.run(
    `UPDATE team_members SET full_name = ?, student_number = ?, faculty_id = ?, major_id = ?, default_role = ?, phone = ?, joined_at = COALESCE(?, joined_at),
       is_active = ?, left_at = CASE WHEN ? = 0 THEN COALESCE(left_at, ?) ELSE NULL END WHERE id = ? AND publication_id = ?`,
    [f.full_name, f.student_number || null, f.faculty_id, f.major_id, f.default_role, f.phone, f.joined_at, active, active, nowIso().slice(0, 10), c.req.param('id'), p.id]
  )
  if (!r.changes) throw notFound('عضو یافت نشد')
  await activity(db, user.id, active ? 'member.updated' : 'member.deactivated', p.id, null, { id: c.req.param('id') })
  return c.json({ ok: true })
})

membersRoutes.get('/:pubId/members/:id', async (c) => {
  const { pub: p } = await pub(c)
  const db = c.get('db')
  const m = await db.first('SELECT * FROM team_members WHERE id = ? AND publication_id = ?', [c.req.param('id'), p.id])
  if (!m) throw notFound('عضو یافت نشد')
  const issues = await db.all(
    `SELECT i.id, i.number, i.title, i.status, im.production_role FROM issue_members im JOIN issues i ON i.id = im.issue_id WHERE im.team_member_id = ? AND i.deleted_at IS NULL ORDER BY i.number DESC`,
    [c.req.param('id')]
  )
  const sections = await db.all(
    `SELECT t.id, t.title, t.status, ta.role, i.number AS issue_number, i.title AS issue_title FROM toc_assignments ta JOIN issue_toc_items t ON t.id = ta.toc_item_id
     JOIN issues i ON i.id = t.issue_id WHERE ta.team_member_id = ? ORDER BY i.number DESC, t.sort_order`,
    [c.req.param('id')]
  )
  return c.json({ member: m, issues, sections })
})

// Admin domain module: publishing approvals, issue detail/archive, people registry.
// Mounted by routes/admin.ts (ROADMAP phase 17 split; parent middleware applies).
import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { ADMIN_ROLES } from '../../context'
import { requireRole } from '../../auth'
import { newId } from '../../lib/crypto'
import { activity, audit, bad, body, cursorPage, getSetting, inList, notFound, notify, nowIso, oneOf, str } from '../../lib/util'
import { normalizeFa } from '../../../shared/fa'
import { admin, monitor, scope } from './service'

export const approvalsRoutes = new Hono<AppEnv>()

// ───────── Publishing approvals (mandatory — client decision #3) ─────────
approvalsRoutes.get('/approvals', async (c) => {
  const u = requireRole(c, ['super_admin', 'pub_officer', 'faculty_supervisor'])
  const s = scope(c)
  const rows = await c.get('db').all(
    `SELECT i.id, i.number, i.title, i.status, i.pricing, i.price_digital, i.page_count, i.cover_key, i.updated_at, p.id AS publication_id, p.title AS publication_title,
       a.requested_at, a.note AS request_note, ru.display_name AS requested_by_name
     FROM issues i JOIN publications p ON p.id = i.publication_id
     LEFT JOIN issue_approvals a ON a.issue_id = i.id AND a.decided_at IS NULL LEFT JOIN users ru ON ru.id = a.requested_by
     WHERE i.status = 'awaiting_approval' AND i.deleted_at IS NULL${s.sql} ORDER BY a.requested_at`,
    s.params
  )
  const history = await c.get('db').all(
    `SELECT a.issue_id, a.decision, a.note, a.decided_at, du.display_name AS decided_by_name, i.number, i.title, p.title AS publication_title
     FROM issue_approvals a JOIN issues i ON i.id = a.issue_id JOIN publications p ON p.id = i.publication_id LEFT JOIN users du ON du.id = a.decided_by
     WHERE a.decided_at IS NOT NULL${s.sql} ORDER BY a.decided_at DESC LIMIT 50`,
    s.params
  )
  return c.json({ pending: rows, history, can_decide: u.system_role !== 'faculty_supervisor' || (await getSetting(c.get('db'), 'supervisor_can_approve', false)) })
})

approvalsRoutes.post('/approvals/:issueId', async (c) => {
  const u = requireRole(c, ['super_admin', 'pub_officer', 'faculty_supervisor'])
  const db = c.get('db')
  if (u.system_role === 'faculty_supervisor' && !(await getSetting(db, 'supervisor_can_approve', false))) throw bad('ناظر دانشکده مجاز به تأیید انتشار نیست')
  const s = scope(c)
  const i = await db.first<any>(
    `SELECT i.*, p.title AS publication_title FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.id = ? AND i.deleted_at IS NULL${s.sql}`,
    [c.req.param('issueId'), ...s.params]
  )
  if (!i) throw notFound('شماره یافت نشد')
  if (i.status !== 'awaiting_approval') throw bad('این شماره در انتظار تأیید نیست')
  const b = await body<{ decision?: string; note?: string; publish_at?: string }>(c)
  const decision = oneOf(b.decision, ['approved', 'changes_requested'] as const, 'تصمیم')
  const note = str(b.note, 'یادداشت', { max: 1000, optional: true })
  if (decision === 'changes_requested' && !note) throw bad('برای درخواست اصلاح، توضیح لازم است')
  const now = nowIso()
  const stmts: { sql: string; params: unknown[] }[] = [
    { sql: 'UPDATE issue_approvals SET decision = ?, note = COALESCE(?, note), decided_by = ?, decided_at = ? WHERE issue_id = ? AND decided_at IS NULL', params: [decision, note || null, u.id, now, i.id] }
  ]
  if (decision === 'approved') {
    const publishedAt = b.publish_at && b.publish_at > now ? b.publish_at : now
    stmts.push({ sql: "UPDATE issues SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?", params: [publishedAt, now, i.id] })
    stmts.push({ sql: "UPDATE issue_stages SET status = 'done', started_at = COALESCE(started_at, ?), completed_at = ? WHERE issue_id = ? AND key = 'publish'", params: [now, now, i.id] })
    stmts.push({ sql: "INSERT INTO stage_events (id, issue_id, from_status, to_status, actor_user_id, note, created_at) VALUES (?,?, 'awaiting_approval', 'published', ?, ?, ?)", params: [newId(), i.id, u.id, note || null, now] })
  } else {
    stmts.push({ sql: "UPDATE issues SET status = 'changes_requested', updated_at = ? WHERE id = ?", params: [now, i.id] })
    stmts.push({ sql: "INSERT INTO stage_events (id, issue_id, from_status, to_status, actor_user_id, note, created_at) VALUES (?,?, 'awaiting_approval', 'changes_requested', ?, ?, ?)", params: [newId(), i.id, u.id, note, now] })
  }
  await db.batch(stmts)
  const holders = await db.all<{ user_id: string }>('SELECT user_id FROM publication_roles WHERE publication_id = ? AND ended_at IS NULL', [i.publication_id])
  for (const h of holders)
    await notify(db, h.user_id, 'approval.' + decision, decision === 'approved' ? `شمارهٔ ${i.number} «${i.title}» تأیید و منتشر شد` : `شمارهٔ ${i.number} نیازمند اصلاح است: ${note}`, `/team/${i.publication_id}/issues/${i.id}`)
  if (decision === 'approved') {
    // notify followers (in-app) — their identity is never shown to the team
    const followers = await db.all<{ user_id: string }>('SELECT user_id FROM follows WHERE publication_id = ? AND unfollowed_at IS NULL LIMIT 2000', [i.publication_id])
    for (const f of followers) await notify(db, f.user_id, 'issue.published', `شمارهٔ جدید ${i.publication_title} منتشر شد: ${i.title}`, `/issue/${i.id}`)
  }
  await audit(db, u.id, 'issue.approval_' + decision, 'issue', i.id, { status: 'awaiting_approval' }, { decision, note })
  await activity(db, u.id, decision === 'approved' ? 'issue.published' : 'issue.changes_requested', i.publication_id, i.id)
  return c.json({ ok: true })
})

approvalsRoutes.post('/issues/:issueId/archive', async (c) => {
  const u = admin(c)
  const db = c.get('db')
  const b = await body<{ archived?: boolean }>(c)
  const i = await db.first<any>('SELECT id, status FROM issues WHERE id = ?', [c.req.param('issueId')])
  if (!i) throw notFound()
  const next = b.archived === false ? 'published' : 'archived'
  await db.run('UPDATE issues SET status = ?, updated_at = ? WHERE id = ?', [next, nowIso(), i.id])
  await audit(db, u.id, 'issue.archive', 'issue', i.id, { status: i.status }, { status: next })
  return c.json({ ok: true })
})

/** Full issue view for monitors (TOC, assignments, stage timeline with durations). */
approvalsRoutes.get('/issues/:issueId', async (c) => {
  monitor(c)
  const db = c.get('db')
  const s = scope(c)
  const i = await db.first<any>(`SELECT i.*, p.title AS publication_title FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.id = ?${s.sql}`, [c.req.param('issueId'), ...s.params])
  if (!i) throw notFound('شماره یافت نشد')
  const toc = await db.all('SELECT * FROM issue_toc_items WHERE issue_id = ? ORDER BY sort_order', [i.id])
  const assignments = await db.all(
    'SELECT ta.toc_item_id, ta.role, tm.full_name, tm.id AS member_id FROM toc_assignments ta JOIN team_members tm ON tm.id = ta.team_member_id JOIN issue_toc_items t ON t.id = ta.toc_item_id WHERE t.issue_id = ?',
    [i.id]
  )
  const members = await db.all('SELECT im.production_role, tm.full_name, tm.id AS member_id FROM issue_members im JOIN team_members tm ON tm.id = im.team_member_id WHERE im.issue_id = ?', [i.id])
  const stages = await db.all('SELECT * FROM issue_stages WHERE issue_id = ? ORDER BY sort_order', [i.id])
  const events = await db.all(
    `SELECT se.*, u.display_name AS actor_name, st.title AS stage_title, t.title AS toc_title FROM stage_events se LEFT JOIN users u ON u.id = se.actor_user_id
     LEFT JOIN issue_stages st ON st.id = se.stage_id LEFT JOIN issue_toc_items t ON t.id = se.toc_item_id WHERE se.issue_id = ? ORDER BY se.created_at`,
    [i.id]
  )
  const approvals = await db.all('SELECT a.*, du.display_name AS decided_by_name FROM issue_approvals a LEFT JOIN users du ON du.id = a.decided_by WHERE a.issue_id = ? ORDER BY a.requested_at DESC', [i.id])
  const media = await db.all('SELECT id, kind, role, title, mime, size_bytes FROM media_assets WHERE issue_id = ? ORDER BY role', [i.id])
  const sales = {
    codes_created: (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM access_codes WHERE issue_id = ?', [i.id]))?.n ?? 0,
    codes_redeemed: (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM access_codes WHERE issue_id = ? AND redeemed_at IS NOT NULL', [i.id]))?.n ?? 0,
    revenue_digital: (await db.first<{ n: number }>('SELECT COALESCE(SUM(price_paid), 0) AS n FROM access_codes WHERE issue_id = ? AND redeemed_at IS NOT NULL', [i.id]))?.n ?? 0,
    print_sold: (await db.first<{ n: number }>('SELECT COALESCE(SUM(quantity), 0) AS n FROM physical_sales WHERE issue_id = ?', [i.id]))?.n ?? 0
  }
  return c.json({ issue: i, toc, assignments, members, stages, events, approvals, media, sales })
})

/** Person dossier: activity of one team member across all publications (matched by student number or exact name). */
approvalsRoutes.get('/people', async (c) => {
  monitor(c)
  const q = normalizeFa(c.req.query('q') || '')
  const s = scope(c)
  const params: unknown[] = [...s.params]
  let w = ''
  if (q) (w = ' AND (tm.full_name LIKE ? OR tm.student_number LIKE ?)'), params.push(`%${q}%`, `%${q}%`)
  // ROADMAP phase 17: keyset pagination over the grouped rows. Order stays «most issues, then most sections»; the
  // zero-padded inverted counts + person_key form one ascending, unique sort key filtered in HAVING.
  const pg = cursorPage(c, { col: 'sort_key', idCol: 'person_key', dir: 'ASC', def: 200, max: 300 })
  const rows = await c.get('db').all<any>(
    `SELECT COALESCE(NULLIF(tm.student_number, ''), tm.full_name) AS person_key, tm.full_name, tm.student_number, COUNT(DISTINCT tm.publication_id) AS publication_count,
       GROUP_CONCAT(DISTINCT p.title) AS publications,
       (SELECT COUNT(DISTINCT im.issue_id) FROM issue_members im JOIN team_members t2 ON t2.id = im.team_member_id WHERE COALESCE(NULLIF(t2.student_number, ''), t2.full_name) = COALESCE(NULLIF(tm.student_number, ''), tm.full_name)) AS issue_count,
       (SELECT COUNT(*) FROM toc_assignments ta JOIN team_members t3 ON t3.id = ta.team_member_id WHERE COALESCE(NULLIF(t3.student_number, ''), t3.full_name) = COALESCE(NULLIF(tm.student_number, ''), tm.full_name)) AS section_count
     FROM team_members tm JOIN publications p ON p.id = tm.publication_id WHERE p.deleted_at IS NULL${s.sql}${w}
     GROUP BY person_key
     HAVING 1 = 1${pg.and.replace(/sort_key/g, "(printf('%08d', 99999999 - issue_count) || printf('%08d', 99999999 - section_count) || person_key)")}
     ORDER BY issue_count DESC, section_count DESC, person_key ASC LIMIT ${pg.fetch}`,
    [...params, ...pg.params]
  )
  const sk = (r: any) => `${String(99999999 - r.issue_count).padStart(8, '0')}${String(99999999 - r.section_count).padStart(8, '0')}${r.person_key}`
  const { rows: people, next_cursor } = pg.finish(rows, (r) => [sk(r), r.person_key])
  return c.json({ people, next_cursor })
})

approvalsRoutes.get('/people/:key', async (c) => {
  monitor(c)
  const key = c.req.param('key')
  const db = c.get('db')
  const s = scope(c)
  const memberships = await db.all(
    `SELECT tm.id, tm.user_id, tm.full_name, tm.student_number, tm.default_role, tm.is_active, tm.joined_at, tm.left_at, p.id AS publication_id, p.title AS publication_title
     FROM team_members tm JOIN publications p ON p.id = tm.publication_id WHERE COALESCE(NULLIF(tm.student_number, ''), tm.full_name) = ?${s.sql}`,
    [key, ...s.params]
  )
  const ids = memberships.map((m: any) => m.id)
  const issues = ids.length
    ? await db.all(
        `SELECT i.id, i.number, i.title, i.status, i.published_at, p.title AS publication_title, im.production_role FROM issue_members im JOIN issues i ON i.id = im.issue_id
         JOIN publications p ON p.id = i.publication_id WHERE im.team_member_id IN (${inList(ids)}) AND i.deleted_at IS NULL ORDER BY i.created_at DESC`,
        ids
      )
    : []
  const sections = ids.length
    ? await db.all(
        `SELECT t.title, t.status, t.done_at, ta.role, i.number AS issue_number, i.title AS issue_title, p.title AS publication_title FROM toc_assignments ta
         JOIN issue_toc_items t ON t.id = ta.toc_item_id JOIN issues i ON i.id = t.issue_id JOIN publications p ON p.id = i.publication_id
         WHERE ta.team_member_id IN (${inList(ids)}) ORDER BY i.created_at DESC, t.sort_order`,
        ids
      )
    : []
  // Linked accounts' profiles (ROADMAP phase 15 privacy): sensitive fields (gender, birth year, phone, email) are shown only
  // to the publications officer / super admin, only when the person consented, and every such view is audited.
  const u = c.get('user')!
  const officer = ADMIN_ROLES.includes(u.system_role)
  const userIds = [...new Set(memberships.map((m: any) => m.user_id).filter(Boolean))] as string[]
  const accounts = userIds.length
    ? (
        await db.all<any>(
          `SELECT us.id, us.username, us.display_name, us.student_number, us.degree, us.entry_year, us.bio, us.profile_consent_at, us.profile_completed_at,
                  us.gender, us.birth_year, us.phone, us.email, f.name AS faculty_name, mj.name AS major_name
             FROM users us LEFT JOIN faculties f ON f.id = us.faculty_id LEFT JOIN majors mj ON mj.id = us.major_id
            WHERE us.id IN (${inList(userIds)}) AND us.deleted_at IS NULL`,
          userIds
        )
      ).map((a) => {
        const show = officer && !!a.profile_consent_at
        return { ...a, gender: show ? a.gender : null, birth_year: show ? a.birth_year : null, phone: show ? a.phone : null, email: show ? a.email : null, sensitive_visible: show }
      })
    : []
  if (accounts.some((a) => a.sensitive_visible)) await audit(db, u.id, 'profile.sensitive_view', 'user', accounts.map((a) => a.id).join(','), null, { key })
  return c.json({ memberships, issues, sections, accounts })
})

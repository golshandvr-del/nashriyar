import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { ADMIN_ROLES } from '../context'
import { requireRole } from '../auth'
import { newId, sha256 } from '../lib/crypto'
import { normalizeSecret } from './auth'
import { activity, audit, bad, body, cursorPage, getSetting, inList, int, notFound, notify, nowIso, oneOf, parseJson, setSetting, str } from '../lib/util'
import { normalizeFa, toEnDigits } from '../../shared/fa'
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, getThresholds, getWeights, sanitizeThresholds, sanitizeWeights } from '../insights'
import { admin, monitor, scope } from '../domains/admin/service'
import { todayRoutes } from '../domains/admin/today'
import { publicationsRoutes } from '../domains/admin/publications'
import { usersRoutes } from '../domains/admin/users'
import { structureRoutes } from '../domains/admin/structure'
import { categoriesRoutes } from '../domains/admin/categories'

export const adminRoutes = new Hono<AppEnv>()

// domain module (ROADMAP phase 17): ../domains/admin/today
adminRoutes.route('/', todayRoutes)

// domain module (ROADMAP phase 17): ../domains/admin/publications
adminRoutes.route('/', publicationsRoutes)

// domain module (ROADMAP phase 17): ../domains/admin/users
adminRoutes.route('/', usersRoutes)

// domain module (ROADMAP phase 17): ../domains/admin/structure
adminRoutes.route('/', structureRoutes)

// domain module (ROADMAP phase 17): ../domains/admin/categories
adminRoutes.route('/', categoriesRoutes)

// ───────── Publishing approvals (mandatory — client decision #3) ─────────
adminRoutes.get('/approvals', async (c) => {
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

adminRoutes.post('/approvals/:issueId', async (c) => {
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

adminRoutes.post('/issues/:issueId/archive', async (c) => {
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
adminRoutes.get('/issues/:issueId', async (c) => {
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
adminRoutes.get('/people', async (c) => {
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

adminRoutes.get('/people/:key', async (c) => {
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

// ───────── Moderation oversight ─────────
adminRoutes.get('/posts', async (c) => {
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

adminRoutes.post('/posts/:id/visibility', async (c) => {
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

adminRoutes.get('/comments', async (c) => {
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

adminRoutes.post('/comments/:id', async (c) => {
  const u = admin(c)
  const b = await body<{ action?: string }>(c)
  const action = oneOf(b.action, ['approve', 'reject', 'spam'] as const, 'اقدام')
  const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'spam'
  await c.get('db').run('UPDATE comments SET status = ?, moderated_by = ?, moderated_at = ? WHERE id = ?', [status, u.id, nowIso(), c.req.param('id')])
  await audit(c.get('db'), u.id, 'comment.' + action, 'comment', c.req.param('id'))
  return c.json({ ok: true })
})

adminRoutes.get('/reports', async (c) => {
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

adminRoutes.post('/reports/:id', async (c) => {
  const u = admin(c)
  const b = await body<{ status?: string }>(c)
  const status = oneOf(b.status, ['resolved', 'dismissed', 'open'] as const, 'وضعیت')
  await c.get('db').run('UPDATE reports SET status = ?, handled_by = ? WHERE id = ?', [status, u.id, c.req.param('id')])
  await audit(c.get('db'), u.id, 'report.' + status, 'report', c.req.param('id'))
  return c.json({ ok: true })
})

// ───────── Storefront curation ─────────
adminRoutes.get('/shelves', async (c) => {
  admin(c)
  const db = c.get('db')
  const shelves = await db.all<any>('SELECT * FROM featured_shelves ORDER BY sort_order')
  const banners = await getSetting<any[]>(db, 'home_banners', [])
  const issues = await db.all(
    `SELECT i.id, i.number, i.title, p.title AS publication_title FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.status = 'published' AND i.deleted_at IS NULL ORDER BY i.published_at DESC LIMIT 300`
  )
  return c.json({ shelves: shelves.map((s) => ({ ...s, issue_ids: parseJson(s.issue_ids_json, []) })), banners, issues })
})

adminRoutes.post('/shelves', async (c) => {
  const u = admin(c)
  const b = await body<any>(c)
  const db = c.get('db')
  const ids = (Array.isArray(b.issue_ids) ? b.issue_ids : []).slice(0, 40)
  // rule-based shelves (migration 0003): manual | latest | free | popular | category:<id> | faculty:<id>
  const rule = typeof b.rule === 'string' && b.rule !== 'manual' ? b.rule : null
  if (rule && !/^(latest|free|popular|category:[\w-]{1,40}|faculty:[\w-]{1,40})$/.test(rule)) throw bad('قاعدهٔ قفسه نامعتبر است')
  if (b.id) await db.run('UPDATE featured_shelves SET title = ?, issue_ids_json = ?, is_active = ?, sort_order = ?, rule = ? WHERE id = ?', [str(b.title, 'عنوان قفسه', { max: 80 }), JSON.stringify(ids), b.is_active === false ? 0 : 1, int(b.sort_order ?? 0, 'ترتیب', {}), rule, b.id])
  else await db.run('INSERT INTO featured_shelves (id, title, issue_ids_json, sort_order, is_active, rule, created_at) VALUES (?,?,?,?,1,?,?)', [newId(), str(b.title, 'عنوان قفسه', { max: 80 }), JSON.stringify(ids), int(b.sort_order ?? 0, 'ترتیب', {}), rule, nowIso()])
  await audit(db, u.id, 'shelf.save', 'featured_shelf', b.id || null, null, { title: b.title, count: ids.length })
  return c.json({ ok: true })
})

adminRoutes.delete('/shelves/:id', async (c) => {
  const u = admin(c)
  await c.get('db').run('DELETE FROM featured_shelves WHERE id = ?', [c.req.param('id')])
  await audit(c.get('db'), u.id, 'shelf.delete', 'featured_shelf', c.req.param('id'))
  return c.json({ ok: true })
})

adminRoutes.post('/banners', async (c) => {
  const u = admin(c)
  const b = await body<{ banners?: any[] }>(c)
  const banners = (b.banners || []).slice(0, 8).map((x) => ({ title: String(x.title || '').slice(0, 80), subtitle: String(x.subtitle || '').slice(0, 160), link: String(x.link || '').slice(0, 200), color: /^#[0-9a-fA-F]{6}$/.test(String(x.color)) ? x.color : '#4f46e5' }))
  await setSetting(c.get('db'), 'home_banners', banners)
  await audit(c.get('db'), u.id, 'banners.update', 'settings', 'home_banners', null, banners)
  return c.json({ ok: true })
})

// ───────── Communication ─────────
adminRoutes.get('/announcements', async (c) => {
  admin(c)
  const rows = await c.get('db').all(
    `SELECT a.*, u.display_name AS author_name, (SELECT COUNT(*) FROM announcement_reads r WHERE r.announcement_id = a.id) AS read_count FROM announcements a LEFT JOIN users u ON u.id = a.author_id ORDER BY a.created_at DESC LIMIT 100`
  )
  return c.json({ announcements: rows })
})

adminRoutes.post('/announcements', async (c) => {
  const u = admin(c)
  const b = await body<any>(c)
  const db = c.get('db')
  const audience = oneOf(b.audience, ['all', 'faculty', 'publication'] as const, 'مخاطب', 'all')
  if (audience !== 'all' && !b.target_id) throw bad('مقصد اطلاعیه را انتخاب کنید')
  const id = newId()
  const title = str(b.title, 'عنوان', { max: 120 })
  await db.run('INSERT INTO announcements (id, author_id, audience, target_id, title, body, pinned, created_at) VALUES (?,?,?,?,?,?,?,?)', [id, u.id, audience, b.target_id || null, title, str(b.body, 'متن', { max: 5000 }), b.pinned ? 1 : 0, nowIso()])
  // notify team accounts in the audience
  const targets = await db.all<{ user_id: string }>(
    `SELECT DISTINCT r.user_id FROM publication_roles r JOIN publications p ON p.id = r.publication_id WHERE r.ended_at IS NULL AND p.deleted_at IS NULL
     ${audience === 'faculty' ? 'AND p.faculty_id = ?' : audience === 'publication' ? 'AND p.id = ?' : ''}`,
    audience === 'all' ? [] : [b.target_id]
  )
  for (const t of targets) await notify(db, t.user_id, 'announcement', 'اطلاعیهٔ جدید: ' + title, '/team')
  await audit(db, u.id, 'announcement.create', 'announcement', id, null, { title, audience })
  return c.json({ ok: true, id })
})

adminRoutes.delete('/announcements/:id', async (c) => {
  const u = admin(c)
  await c.get('db').run('DELETE FROM announcements WHERE id = ?', [c.req.param('id')])
  await audit(c.get('db'), u.id, 'announcement.delete', 'announcement', c.req.param('id'))
  return c.json({ ok: true })
})

adminRoutes.get('/deadlines', async (c) => {
  admin(c)
  return c.json({ deadlines: await c.get('db').all('SELECT * FROM deadlines ORDER BY due_at DESC LIMIT 100') })
})

adminRoutes.post('/deadlines', async (c) => {
  const u = admin(c)
  const b = await body<any>(c)
  const id = newId()
  // ROADMAP phase 14 events calendar: deadline | meeting | workshop | event (+ optional HH:MM and location)
  const kind = ['deadline', 'meeting', 'workshop', 'event'].includes(b.kind) ? b.kind : 'deadline'
  const due = str(b.due_at, 'تاریخ', { max: 10 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw bad('تاریخ نامعتبر است')
  const time = str(b.start_time, 'ساعت', { max: 5, optional: true })
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw bad('ساعت نامعتبر است')
  await c.get('db').run('INSERT INTO deadlines (id, title, due_at, description, kind, start_time, location, created_at) VALUES (?,?,?,?,?,?,?,?)', [
    id, str(b.title, 'عنوان', { max: 120 }), due, str(b.description, 'توضیح', { max: 1000, optional: true }), kind, time || null, str(b.location, 'مکان', { max: 120, optional: true }) || null, nowIso()
  ])
  await audit(c.get('db'), u.id, 'deadline.create', 'deadline', id)
  return c.json({ ok: true, id })
})

adminRoutes.delete('/deadlines/:id', async (c) => {
  const u = admin(c)
  await c.get('db').run('DELETE FROM deadlines WHERE id = ?', [c.req.param('id')])
  await audit(c.get('db'), u.id, 'deadline.delete', 'deadline', c.req.param('id'))
  return c.json({ ok: true })
})

// ───────── Audit log ─────────
adminRoutes.get('/audit', async (c) => {
  admin(c)
  const action = c.req.query('action')
  // ROADMAP phase 17: keyset pagination (?cursor, ?limit ≤ 300)
  const pg = cursorPage(c, { col: 'a.created_at', idCol: 'a.id', def: 300, max: 300 })
  const params: unknown[] = []
  let w = 'WHERE 1 = 1'
  if (action) (w = 'WHERE a.action LIKE ?'), params.push(action + '%')
  const rows = await c.get('db').all<any>(
    `SELECT a.*, u.display_name AS actor_name, u.username AS actor_username FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id ${w}${pg.and} ORDER BY ${pg.order} LIMIT ${pg.fetch}`,
    [...params, ...pg.params]
  )
  const { rows: items, next_cursor } = pg.finish(rows, (r) => [r.created_at, r.id])
  return c.json({ items, next_cursor })
})

// ───────── Registration allowlist (SECURITY.md §2, migration 0004) ─────────
adminRoutes.get('/registration-allowlist', async (c) => {
  admin(c)
  const db = c.get('db')
  const items = await db.all(
    'SELECT student_number, secret_kind, note, used_at, created_at FROM registration_allowlist ORDER BY created_at DESC, student_number LIMIT 2000'
  )
  const stats = await db.first<{ total: number; used: number }>(
    'SELECT COUNT(*) AS total, SUM(CASE WHEN used_at IS NOT NULL THEN 1 ELSE 0 END) AS used FROM registration_allowlist'
  )
  return c.json({ items, total: stats?.total ?? 0, used: stats?.used ?? 0, mode: await getSetting(db, 'registration_mode', 'open') })
})

/**
 * POST /api/admin/registration-allowlist { csv: "student_number[,national_id]\n…", activation_codes?: boolean }
 * Adds/updates rows. With activation_codes=true each row gets a random code (returned ONCE; only its hash is stored).
 */
adminRoutes.post('/registration-allowlist', async (c) => {
  const u = admin(c)
  const db = c.get('db')
  const b = await body<{ csv?: string; activation_codes?: boolean }>(c)
  const lines = String(b.csv || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5000)
  if (!lines.length) throw bad('فهرست خالی است')
  const codes: { student_number: string; code: string }[] = []
  let added = 0
  let skipped = 0
  const now = nowIso()
  const stmts: { sql: string; params: unknown[] }[] = []
  for (const line of lines) {
    const [rawSn, rawSecret] = line.split(/[,;\t]/).map((x) => (x || '').trim().replace(/^"|"$/g, ''))
    const sn = toEnDigits(rawSn || '')
    if (!/^\d{6,14}$/.test(sn)) {
      skipped++ // header row or invalid number
      continue
    }
    let secretHash: string | null = null
    let kind: string | null = null
    if (b.activation_codes) {
      const raw = Array.from(crypto.getRandomValues(new Uint8Array(8)), (x) => '23456789ABCDEFGHJKMNPQRSTUVWXYZ'[x % 31]).join('')
      const code = `${raw.slice(0, 4)}-${raw.slice(4)}`
      codes.push({ student_number: sn, code })
      secretHash = await sha256(normalizeSecret(code))
      kind = 'activation_code'
    } else if (rawSecret) {
      secretHash = await sha256(normalizeSecret(rawSecret))
      kind = 'national_id'
    }
    stmts.push({
      sql: `INSERT INTO registration_allowlist (student_number, secret_hash, secret_kind, created_by, created_at) VALUES (?,?,?,?,?)
            ON CONFLICT(student_number) DO UPDATE SET secret_hash = excluded.secret_hash, secret_kind = excluded.secret_kind`,
      params: [sn, secretHash, kind, u.id, now]
    })
    added++
  }
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100))
  await audit(db, u.id, 'allowlist.import', 'registration_allowlist', null, null, { added, skipped, activation_codes: !!b.activation_codes })
  return c.json({ ok: true, added, skipped, codes })
})

adminRoutes.delete('/registration-allowlist/:sn', async (c) => {
  const u = admin(c)
  const sn = toEnDigits(c.req.param('sn'))
  await c.get('db').run('DELETE FROM registration_allowlist WHERE student_number = ?', [sn])
  await audit(c.get('db'), u.id, 'allowlist.delete', 'registration_allowlist', sn)
  return c.json({ ok: true })
})

// ───────── Settings (publication affairs only) ─────────
// Technical settings (AI layer, feature flags, members-only reading, session cap, maintenance) moved to the
// developer console /api/system/settings (ROADMAP phase 13) — neither the officer nor the super admin sees them here.
const OFFICER_SETTINGS = ['site_name', 'university_name', 'registration_open', 'registration_mode', 'supervisor_can_approve', 'default_code_ttl_hours'] as const

adminRoutes.get('/settings', async (c) => {
  const u = admin(c)
  const db = c.get('db')
  const out: Record<string, unknown> = {}
  for (const k of OFFICER_SETTINGS) out[k] = k === 'default_code_ttl_hours' ? await getSetting(db, k, 24) : k === 'registration_mode' ? await getSetting(db, k, 'open') : await getSetting(db, k, k === 'registration_open' ? true : k === 'supervisor_can_approve' ? false : k === 'site_name' ? 'نشریار' : 'دانشگاه')
  out.insight_thresholds = await getThresholds(db)
  out.health_weights = await getWeights(db)
  return c.json({ settings: out, is_super: u.system_role === 'super_admin', defaults: { insight_thresholds: DEFAULT_THRESHOLDS, health_weights: DEFAULT_WEIGHTS } })
})

adminRoutes.post('/settings', async (c) => {
  const u = admin(c)
  const b = await body<Record<string, unknown>>(c)
  const db = c.get('db')
  const keys: string[] = [...OFFICER_SETTINGS]
  const changed: Record<string, unknown> = {}
  for (const k of keys) {
    if (!(k in b)) continue
    let v = b[k]
    if (k === 'registration_mode') v = v === 'allowlist' ? 'allowlist' : 'open'
    if (k === 'default_code_ttl_hours') v = Math.max(1, Math.min(24, Math.floor(Number(v) || 24))) // client decision #5: max 24h
    if (typeof v === 'string') v = v.slice(0, 500)
    await setSetting(db, k, v)
    changed[k] = v
  }
  // Rule thresholds and health weights (officer and super admin; ROADMAP phase 8)
  if ('insight_thresholds' in b) {
    const next = sanitizeThresholds({ ...(await getThresholds(db)), ...((b.insight_thresholds as object) || {}) })
    await setSetting(db, 'insight_thresholds', next)
    changed.insight_thresholds = next
  }
  if ('health_weights' in b) {
    const next = sanitizeWeights({ ...(await getWeights(db)), ...((b.health_weights as object) || {}) })
    await setSetting(db, 'health_weights', next)
    changed.health_weights = next
  }
  await audit(db, u.id, 'settings.update', 'settings', null, null, changed)
  return c.json({ ok: true })
})

// Server monitoring moved to the developer console: GET /api/system/health (ROADMAP phase 13).

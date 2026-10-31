import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv, SystemRole } from '../context'
import { ADMIN_ROLES, MONITOR_ROLES } from '../context'
import { requireRole } from '../auth'
import { hashPassword, newId, sha256, tempPassword } from '../lib/crypto'
import { normalizeSecret } from './auth'
import {
  activity, audit, bad, body, getSetting, inList, int, keywordsCsv, notFound, notify, nowIso, oneOf, parseJson, setSetting, slugify, str
} from '../lib/util'
import { normalizeFa, toEnDigits } from '../../shared/fa'
import { ensureReminders } from '../lib/reminders'
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, getThresholds, getWeights, sanitizeThresholds, sanitizeWeights } from '../insights'

export const adminRoutes = new Hono<AppEnv>()

const PUB_ROLES = ['managing_director', 'editor_in_chief', 'license_holder'] as const
const PUB_ROLE_FA: Record<string, string> = { managing_director: 'مدیرمسئول', editor_in_chief: 'سردبیر', license_holder: 'صاحب امتیاز' }

const admin = (c: Context<AppEnv>) => requireRole(c, ADMIN_ROLES)
const monitor = (c: Context<AppEnv>) => requireRole(c, MONITOR_ROLES)

/** Faculty supervisors only see their own faculty. Returns SQL fragment + params for publications alias `p`. */
function scope(c: Context<AppEnv>): { sql: string; params: unknown[] } {
  const u = c.get('user')!
  if (u.system_role === 'faculty_supervisor') return { sql: ' AND p.faculty_id = ?', params: [u.scope_faculty_id] }
  return { sql: '', params: [] }
}

async function scopedPub(c: Context<AppEnv>, id: string) {
  monitor(c)
  const s = scope(c)
  const p = await c.get('db').first<any>(`SELECT p.* FROM publications p WHERE p.id = ? AND p.deleted_at IS NULL${s.sql}`, [id, ...s.params])
  if (!p) throw notFound('نشریه یافت نشد')
  return p
}

// ───────── «Today» action queue (ROADMAP phase 14) ─────────
// One prioritised list of everything the officer must act on, each item carrying the one-click actions the UI offers.
// Kinds: approval (issue awaiting approval), license (expired / expiring within 60 days), comment (pending moderation),
// report (open abuse report), deadline (within 14 days), stalled (issue in production with no update for 30 days).
adminRoutes.get('/today', async (c) => {
  const u = monitor(c)
  const db = c.get('db')
  const s = scope(c)
  const role = u.system_role
  const isAdm = role === 'super_admin' || role === 'pub_officer'
  const now = new Date()
  const iso = (d: number) => new Date(now.getTime() + d * 86400_000).toISOString()
  const items: { kind: string; id: string; priority: number; title: string; detail: string; at: string | null; link: string; actions: string[] }[] = []
  if (role !== 'analyst') {
    const canDecide = role !== 'faculty_supervisor' || (await getSetting(db, 'supervisor_can_approve', false))
    const rows = await db.all<any>(
      `SELECT i.id, i.number, i.title, p.title AS pub, a.requested_at FROM issues i JOIN publications p ON p.id = i.publication_id
       LEFT JOIN issue_approvals a ON a.issue_id = i.id AND a.decided_at IS NULL
       WHERE i.status = 'awaiting_approval' AND i.deleted_at IS NULL AND p.deleted_at IS NULL${s.sql} ORDER BY a.requested_at LIMIT 50`,
      s.params
    )
    for (const r of rows)
      items.push({ kind: 'approval', id: r.id, priority: 1, title: `تأیید انتشار: ${r.pub} — شمارهٔ ${r.number}`, detail: r.title || '', at: r.requested_at, link: `/admin/issues/${r.id}`, actions: canDecide ? ['approve', 'open'] : ['open'] })
  }
  const lic = await db.all<any>(
    `SELECT p.id, p.title, p.license_expires_at FROM publications p
     WHERE p.deleted_at IS NULL AND p.status = 'active' AND p.license_expires_at IS NOT NULL AND p.license_expires_at <> '' AND p.license_expires_at <= ?${s.sql}
     ORDER BY p.license_expires_at LIMIT 50`,
    [iso(60), ...s.params]
  )
  for (const r of lic) {
    const expired = r.license_expires_at < now.toISOString()
    items.push({ kind: 'license', id: r.id, priority: expired ? 1 : 2, title: `${expired ? 'مجوز منقضی شده' : 'مجوز رو به انقضا'}: ${r.title}`, detail: expired ? 'انتشار بدون مجوز معتبر؛ تمدید را پیگیری کنید' : 'کمتر از ۶۰ روز تا پایان اعتبار', at: r.license_expires_at, link: `/admin/publications/${r.id}`, actions: ['open'] })
  }
  if (isAdm) {
    const rep = await db.all<any>(`SELECT r.id, r.entity_type, r.reason, r.created_at FROM reports r WHERE r.status = 'open' ORDER BY r.created_at LIMIT 50`)
    for (const r of rep)
      items.push({ kind: 'report', id: r.id, priority: 1, title: 'گزارش تخلف باز', detail: r.reason || r.entity_type, at: r.created_at, link: '/admin/moderation?tab=reports', actions: ['resolve', 'dismiss'] })
    const cm = await db.all<any>(
      `SELECT cm.id, cm.body, cm.flagged, cm.created_at, p.title AS pub FROM comments cm JOIN posts po ON po.id = cm.post_id JOIN publications p ON p.id = po.publication_id
       WHERE cm.status = 'pending' ORDER BY cm.flagged DESC, cm.created_at LIMIT 50`
    )
    for (const r of cm)
      items.push({ kind: 'comment', id: r.id, priority: r.flagged ? 2 : 3, title: `نظر در انتظار بررسی — ${r.pub}`, detail: String(r.body).slice(0, 140), at: r.created_at, link: '/admin/moderation', actions: ['approve', 'reject'] })
  }
  const dl = await db.all<any>('SELECT id, title, due_at FROM deadlines WHERE due_at >= ? AND due_at <= ? ORDER BY due_at LIMIT 20', [iso(-1), iso(14)])
  for (const r of dl) items.push({ kind: 'deadline', id: r.id, priority: r.due_at <= iso(3) ? 2 : 3, title: `مهلت نزدیک: ${r.title}`, detail: '', at: r.due_at, link: '/admin/announcements', actions: ['open'] })
  const st = await db.all<any>(
    `SELECT i.id, i.number, i.title, i.updated_at, p.title AS pub FROM issues i JOIN publications p ON p.id = i.publication_id
     WHERE i.status IN ('planning','in_production','changes_requested') AND i.deleted_at IS NULL AND p.deleted_at IS NULL AND i.updated_at < ?${s.sql}
     ORDER BY i.updated_at LIMIT 20`,
    [iso(-30), ...s.params]
  )
  for (const r of st) items.push({ kind: 'stalled', id: r.id, priority: 3, title: `شمارهٔ متوقف: ${r.pub} — شمارهٔ ${r.number}`, detail: 'بیش از ۳۰ روز بدون به‌روزرسانی', at: r.updated_at, link: `/admin/issues/${r.id}`, actions: ['open'] })
  items.sort((a, b) => a.priority - b.priority || String(a.at || '').localeCompare(String(b.at || '')))
  const counts: Record<string, number> = {}
  for (const it of items) counts[it.kind] = (counts[it.kind] || 0) + 1
  return c.json({ items, counts, generated_at: now.toISOString() })
})

// ───────── Overview lists ─────────
adminRoutes.get('/overview', async (c) => {
  monitor(c)
  const db = c.get('db')
  await ensureReminders(db).catch(() => false) // lazy, at most once per day
  const s = scope(c)
  const counts = await db.first<any>(
    `SELECT COUNT(*) AS publications, SUM(CASE WHEN p.status = 'active' THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN p.status = 'suspended' THEN 1 ELSE 0 END) AS suspended FROM publications p WHERE p.deleted_at IS NULL${s.sql}`,
    s.params
  )
  const issues = await db.first<any>(
    `SELECT SUM(CASE WHEN i.status = 'published' THEN 1 ELSE 0 END) AS published, SUM(CASE WHEN i.status IN ('planning','in_production','changes_requested') THEN 1 ELSE 0 END) AS in_progress,
       SUM(CASE WHEN i.status = 'awaiting_approval' THEN 1 ELSE 0 END) AS awaiting FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.deleted_at IS NULL AND p.deleted_at IS NULL${s.sql}`,
    s.params
  )
  const pendingReports = (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"))?.n ?? 0
  const users = (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE system_role = 'student' AND deleted_at IS NULL"))?.n ?? 0
  return c.json({ counts, issues, pendingReports, students: users })
})

adminRoutes.get('/publications', async (c) => {
  monitor(c)
  const s = scope(c)
  const q = normalizeFa(c.req.query('q') || '')
  const params: unknown[] = [...s.params]
  let qs = ''
  if (q) (qs = ' AND p.search_text LIKE ?'), params.push(`%${q}%`)
  const rows = await c.get('db').all(
    `SELECT p.id, p.slug, p.title, p.status, p.logo_key, p.theme_color, p.frequency, p.license_number, p.license_expires_at, p.created_at,
       a.name AS association_name, a.kind AS association_kind, f.name AS faculty_name,
       (SELECT COUNT(*) FROM issues i WHERE i.publication_id = p.id AND i.status = 'published' AND i.deleted_at IS NULL) AS published_count,
       (SELECT COUNT(*) FROM issues i WHERE i.publication_id = p.id AND i.status IN ('planning','in_production','changes_requested','awaiting_approval') AND i.deleted_at IS NULL) AS in_progress_count,
       (SELECT MAX(published_at) FROM issues i WHERE i.publication_id = p.id AND i.status = 'published') AS last_published_at,
       (SELECT COUNT(*) FROM team_members tm WHERE tm.publication_id = p.id AND tm.is_active = 1) AS member_count,
       (SELECT COUNT(*) FROM follows fo WHERE fo.publication_id = p.id AND fo.unfollowed_at IS NULL) AS follower_count,
       (SELECT MAX(created_at) FROM activity_events ae WHERE ae.publication_id = p.id AND ae.actor_user_id IN (SELECT user_id FROM publication_roles r WHERE r.publication_id = p.id)) AS last_activity_at
     FROM publications p JOIN associations a ON a.id = p.association_id LEFT JOIN faculties f ON f.id = p.faculty_id
     WHERE p.deleted_at IS NULL${s.sql}${qs} ORDER BY p.title`,
    params
  )
  return c.json({ publications: rows })
})

/** Publication dossier: issues + stage gantt, members, roles history, followers (admin only). */
adminRoutes.get('/publications/:id', async (c) => {
  const p = await scopedPub(c, c.req.param('id'))
  const db = c.get('db')
  const roles = await db.all(
    `SELECT r.id, r.role, r.started_at, r.ended_at, u.id AS user_id, u.username, u.display_name, u.last_login_at, u.must_change_password
     FROM publication_roles r JOIN users u ON u.id = r.user_id WHERE r.publication_id = ? ORDER BY r.ended_at IS NOT NULL, r.started_at DESC`,
    [p.id]
  )
  const issues = await db.all<any>(
    `SELECT i.id, i.number, i.title, i.status, i.pricing, i.created_at, i.published_at, i.planned_publish_at, i.page_count, i.cover_key, i.director_user_id,
       (SELECT COUNT(*) FROM issue_toc_items t WHERE t.issue_id = i.id) AS toc_total,
       (SELECT COUNT(*) FROM issue_toc_items t WHERE t.issue_id = i.id AND t.status = 'done') AS toc_done
     FROM issues i WHERE i.publication_id = ? AND i.deleted_at IS NULL ORDER BY i.number DESC`,
    [p.id]
  )
  const stages = await db.all(
    `SELECT s.issue_id, s.key, s.title, s.status, s.started_at, s.completed_at, s.due_at, s.sort_order FROM issue_stages s JOIN issues i ON i.id = s.issue_id
     WHERE i.publication_id = ? AND i.deleted_at IS NULL ORDER BY s.sort_order`,
    [p.id]
  )
  const members = await db.all(
    `SELECT tm.id, tm.full_name, tm.student_number, tm.default_role, tm.is_active, tm.joined_at, tm.left_at,
       (SELECT COUNT(DISTINCT im.issue_id) FROM issue_members im WHERE im.team_member_id = tm.id) AS issue_count,
       (SELECT COUNT(*) FROM toc_assignments ta WHERE ta.team_member_id = tm.id) AS section_count
     FROM team_members tm WHERE tm.publication_id = ? ORDER BY tm.is_active DESC, issue_count DESC`,
    [p.id]
  )
  const categories = await db.all('SELECT category_id FROM publication_categories WHERE publication_id = ?', [p.id])
  const followers = (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM follows WHERE publication_id = ? AND unfollowed_at IS NULL', [p.id]))?.n ?? 0
  const activityRows = await db.all(
    `SELECT a.type, a.created_at, a.payload_json, u.display_name AS actor_name, i.number AS issue_number FROM activity_events a LEFT JOIN users u ON u.id = a.actor_user_id
     LEFT JOIN issues i ON i.id = a.issue_id WHERE a.publication_id = ? AND a.type NOT IN ('follow','unfollow','comment.created','library.add_free','code.redeemed') ORDER BY a.created_at DESC LIMIT 60`,
    [p.id]
  )
  // Dossier completion (ROADMAP phase 7): sales, explore and audit trail for this publication
  const sales = await db.first<any>(
    `SELECT COUNT(*) AS codes_created, COALESCE(SUM(CASE WHEN redeemed_at IS NOT NULL THEN 1 ELSE 0 END),0) AS codes_redeemed,
       COALESCE(SUM(CASE WHEN redeemed_at IS NOT NULL THEN price_paid END),0) AS revenue_digital,
       (SELECT COALESCE(SUM(quantity),0) FROM physical_sales WHERE publication_id = ?) AS print_sold,
       (SELECT COALESCE(SUM(quantity * COALESCE(unit_price,0)),0) FROM physical_sales WHERE publication_id = ?) AS revenue_print
     FROM access_codes WHERE publication_id = ?`,
    [p.id, p.id, p.id]
  )
  const d90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
  const explore = await db.first<any>(
    `SELECT (SELECT COUNT(*) FROM posts WHERE publication_id = ? AND status = 'published') AS posts,
       (SELECT COUNT(*) FROM view_events WHERE publication_id = ? AND entity_type = 'post' AND day > ?) AS post_views_90d,
       (SELECT COUNT(*) FROM view_events WHERE publication_id = ? AND entity_type = 'post_read_full' AND day > ?) AS read_full_90d,
       (SELECT COUNT(*) FROM saved_posts sp JOIN posts po ON po.id = sp.post_id WHERE po.publication_id = ?) AS saves,
       (SELECT COUNT(*) FROM comments cm JOIN posts po ON po.id = cm.post_id WHERE po.publication_id = ? AND cm.status = 'approved') AS comments`,
    [p.id, p.id, d90, p.id, d90, p.id, p.id]
  )
  const audit = await db.all(
    `SELECT a.action, a.entity_type, a.entity_id, a.created_at, u.display_name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE (a.entity_type = 'publication' AND a.entity_id = ?)
        OR (a.entity_type = 'issue' AND a.entity_id IN (SELECT id FROM issues WHERE publication_id = ?))
        OR (a.entity_type = 'post' AND a.entity_id IN (SELECT id FROM posts WHERE publication_id = ?))
     ORDER BY a.created_at DESC LIMIT 50`,
    [p.id, p.id, p.id]
  )
  return c.json({
    publication: { ...p, contacts: parseJson(p.contacts_json, []) },
    roles, issues, stages, members, categories: categories.map((x: any) => x.category_id), followers, activity: activityRows,
    sales, explore, audit
  })
})

adminRoutes.get('/publications/:id/followers', async (c) => {
  const p = await scopedPub(c, c.req.param('id'))
  const db = c.get('db')
  const list = await db.all(
    `SELECT u.display_name, u.student_number, f.name AS faculty_name, fo.created_at FROM follows fo JOIN users u ON u.id = fo.user_id LEFT JOIN faculties f ON f.id = u.faculty_id
     WHERE fo.publication_id = ? AND fo.unfollowed_at IS NULL ORDER BY fo.created_at DESC LIMIT 500`,
    [p.id]
  )
  const monthly = await db.all(
    `SELECT substr(created_at, 1, 7) AS month, COUNT(*) AS n FROM follows WHERE publication_id = ? GROUP BY month ORDER BY month`,
    [p.id]
  )
  // ROADMAP phase 7: current / new / unfollowed + monthly unfollow trend (officer-only page)
  const unfollowMonthly = await db.all<{ month: string; n: number }>(
    `SELECT substr(unfollowed_at, 1, 7) AS month, COUNT(*) AS n FROM follows WHERE publication_id = ? AND unfollowed_at IS NOT NULL GROUP BY month ORDER BY month`,
    [p.id]
  )
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString()
  const summary = await db.first<any>(
    `SELECT SUM(CASE WHEN unfollowed_at IS NULL THEN 1 ELSE 0 END) AS current,
       SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS new_30d,
       SUM(CASE WHEN unfollowed_at > ? THEN 1 ELSE 0 END) AS unfollowed_30d,
       SUM(CASE WHEN unfollowed_at IS NOT NULL THEN 1 ELSE 0 END) AS unfollowed_total
     FROM follows WHERE publication_id = ?`,
    [d30, d30, p.id]
  )
  return c.json({ followers: list, monthly, unfollowMonthly, summary })
})

/** Create publication + its three main accounts with temporary passwords (printable credentials sheet). */
adminRoutes.post('/publications', async (c) => {
  const u = admin(c)
  const db = c.get('db')
  const b = await body<any>(c)
  const title = str(b.title, 'نام نشریه', { min: 2, max: 120 })
  const assoc = await db.first<any>('SELECT id, faculty_id FROM associations WHERE id = ?', [b.association_id])
  if (!assoc) throw bad('انجمن/کانون صاحب امتیاز را انتخاب کنید')
  let slug = slugify(b.slug || title)
  if (await db.first('SELECT 1 FROM publications WHERE slug = ?', [slug])) slug = slug + '-' + newId().slice(-4)
  const id = newId()
  const now = nowIso()
  const stmts: { sql: string; params: unknown[] }[] = []
  stmts.push({
    sql: `INSERT INTO publications (id, slug, title, tagline, description, association_id, faculty_id, license_number, license_issued_at, license_expires_at, frequency, theme_color, keywords, contacts_json, status, search_text, founded_at, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, '[]', 'active', ?,?,?)`,
    params: [id, slug, title, str(b.tagline, 'شعار', { max: 140, optional: true }), str(b.description, 'معرفی', { max: 3000, optional: true }), assoc.id, b.faculty_id || assoc.faculty_id || null,
      str(b.license_number, 'شمارهٔ مجوز', { max: 40, optional: true }), b.license_issued_at || null, b.license_expires_at || null,
      oneOf(b.frequency, ['monthly', 'bimonthly', 'quarterly', 'biannual', 'irregular'] as const, 'دورهٔ انتشار', 'irregular'),
      /^#[0-9a-fA-F]{6}$/.test(String(b.theme_color)) ? b.theme_color : '#4f46e5', keywordsCsv(b.keywords), normalizeFa(title + ' ' + (b.tagline || '') + ' ' + (b.keywords || '')), b.founded_at || null, now]
  })
  for (const cid of (Array.isArray(b.category_ids) ? b.category_ids : []).slice(0, 15)) stmts.push({ sql: 'INSERT OR IGNORE INTO publication_categories (publication_id, category_id) VALUES (?,?)', params: [id, cid] })
  const credentials: { role: string; role_fa: string; name: string; username: string; password: string }[] = []
  const accounts = b.accounts || {}
  for (const role of PUB_ROLES) {
    const a = accounts[role] || {}
    const name = str(a.display_name, `نام ${PUB_ROLE_FA[role]}`, { min: 2, max: 80 })
    // reuse an existing team user if the same person already has an account (one person may serve several publications)
    let userId: string | null = null
    let username = ''
    if (a.existing_user_id) {
      const ex = await db.first<any>("SELECT id, username FROM users WHERE id = ? AND system_role = 'team' AND deleted_at IS NULL", [a.existing_user_id])
      if (!ex) throw bad(`حساب انتخاب‌شده برای ${PUB_ROLE_FA[role]} معتبر نیست`)
      userId = ex.id
      username = ex.username
      credentials.push({ role, role_fa: PUB_ROLE_FA[role], name, username, password: '(حساب موجود — رمز قبلی)' })
    } else {
      username = (toEnDigits(str(a.username, `نام کاربری ${PUB_ROLE_FA[role]}`, { min: 3, max: 40, optional: true })) || `${slug.replace(/[^a-z0-9]/gi, '').slice(0, 10) || 'pub'}-${role.split('_')[0]}`).toLowerCase()
      if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw bad(`نام کاربری ${PUB_ROLE_FA[role]} فقط حروف لاتین، عدد و . _ - مجاز است`)
      if (await db.first('SELECT 1 FROM users WHERE username = ?', [username])) username = username + '-' + newId().slice(-3)
      const pw = tempPassword()
      userId = newId()
      stmts.push({
        sql: "INSERT INTO users (id, username, student_number, display_name, password_hash, must_change_password, system_role, created_at) VALUES (?,?,?,?,?,1,'team',?)",
        params: [userId, username, a.student_number ? toEnDigits(String(a.student_number)) : null, name, await hashPassword(pw), now]
      })
      credentials.push({ role, role_fa: PUB_ROLE_FA[role], name, username, password: pw })
    }
    stmts.push({ sql: 'INSERT INTO publication_roles (id, publication_id, user_id, role, started_at) VALUES (?,?,?,?,?)', params: [newId(), id, userId, role, now] })
  }
  await db.batch(stmts)
  await audit(db, u.id, 'publication.create', 'publication', id, null, { title, slug, accounts: credentials.map((x) => ({ role: x.role, username: x.username })) })
  await activity(db, u.id, 'publication.created', id)
  return c.json({ ok: true, id, slug, credentials })
})

adminRoutes.put('/publications/:id', async (c) => {
  const u = admin(c)
  const db = c.get('db')
  const p = await scopedPub(c, c.req.param('id'))
  const b = await body<any>(c)
  const next = {
    title: str(b.title ?? p.title, 'نام نشریه', { min: 2, max: 120 }),
    tagline: str(b.tagline ?? p.tagline, 'شعار', { max: 140, optional: true }),
    description: str(b.description ?? p.description, 'معرفی', { max: 3000, optional: true }),
    association_id: b.association_id || p.association_id,
    faculty_id: b.faculty_id !== undefined ? b.faculty_id || null : p.faculty_id,
    license_number: str(b.license_number ?? p.license_number, 'شمارهٔ مجوز', { max: 40, optional: true }),
    license_issued_at: b.license_issued_at !== undefined ? b.license_issued_at || null : p.license_issued_at,
    license_expires_at: b.license_expires_at !== undefined ? b.license_expires_at || null : p.license_expires_at,
    frequency: oneOf(b.frequency ?? p.frequency, ['monthly', 'bimonthly', 'quarterly', 'biannual', 'irregular'] as const, 'دورهٔ انتشار', 'irregular'),
    theme_color: /^#[0-9a-fA-F]{6}$/.test(String(b.theme_color)) ? b.theme_color : p.theme_color,
    keywords: keywordsCsv(b.keywords ?? p.keywords)
  }
  await db.run(
    `UPDATE publications SET title=?, tagline=?, description=?, association_id=?, faculty_id=?, license_number=?, license_issued_at=?, license_expires_at=?, frequency=?, theme_color=?, keywords=?, search_text=? WHERE id = ?`,
    [next.title, next.tagline, next.description, next.association_id, next.faculty_id, next.license_number, next.license_issued_at, next.license_expires_at, next.frequency, next.theme_color, next.keywords,
      normalizeFa([next.title, next.tagline, next.description, next.keywords].join(' ')), p.id]
  )
  if (Array.isArray(b.category_ids)) {
    await db.run('DELETE FROM publication_categories WHERE publication_id = ?', [p.id])
    for (const cid of b.category_ids.slice(0, 15)) await db.run('INSERT OR IGNORE INTO publication_categories (publication_id, category_id) VALUES (?,?)', [p.id, cid])
  }
  await audit(db, u.id, 'publication.update', 'publication', p.id, { title: p.title, status: p.status, license_number: p.license_number }, next)
  return c.json({ ok: true })
})

adminRoutes.post('/publications/:id/status', async (c) => {
  const u = admin(c)
  const p = await scopedPub(c, c.req.param('id'))
  const b = await body<{ status?: string; reason?: string }>(c)
  const status = oneOf(b.status, ['active', 'suspended', 'archived'] as const, 'وضعیت')
  const db = c.get('db')
  await db.run('UPDATE publications SET status = ? WHERE id = ?', [status, p.id])
  await audit(db, u.id, 'publication.status', 'publication', p.id, { status: p.status }, { status, reason: b.reason || null })
  const holders = await db.all<{ user_id: string }>('SELECT user_id FROM publication_roles WHERE publication_id = ? AND ended_at IS NULL', [p.id])
  const msg = status === 'active' ? `نشریهٔ ${p.title} فعال شد` : status === 'suspended' ? `نشریهٔ ${p.title} تعلیق شد${b.reason ? ': ' + b.reason : ''}` : `نشریهٔ ${p.title} بایگانی شد`
  for (const h of holders) await notify(db, h.user_id, 'publication.status', msg, '/team')
  return c.json({ ok: true })
})

/** Replace the holder of one of the three main roles; history is kept (basis for per-director performance). */
adminRoutes.post('/publications/:id/roles', async (c) => {
  const u = admin(c)
  const p = await scopedPub(c, c.req.param('id'))
  const db = c.get('db')
  const b = await body<any>(c)
  const role = oneOf(b.role, PUB_ROLES, 'نقش')
  const now = nowIso()
  let userId: string
  let credentials: any = null
  if (b.existing_user_id) {
    const ex = await db.first<any>("SELECT id FROM users WHERE id = ? AND system_role = 'team' AND deleted_at IS NULL", [b.existing_user_id])
    if (!ex) throw bad('حساب انتخاب‌شده معتبر نیست')
    userId = ex.id
  } else {
    const name = str(b.display_name, 'نام فرد جدید', { min: 2, max: 80 })
    let username = toEnDigits(str(b.username, 'نام کاربری', { min: 3, max: 40 })).toLowerCase()
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw bad('نام کاربری فقط حروف لاتین، عدد و . _ - مجاز است')
    if (await db.first('SELECT 1 FROM users WHERE username = ?', [username])) throw bad('این نام کاربری قبلاً استفاده شده است')
    const pw = tempPassword()
    userId = newId()
    await db.run("INSERT INTO users (id, username, display_name, password_hash, must_change_password, system_role, created_at) VALUES (?,?,?,?,1,'team',?)", [userId, username, name, await hashPassword(pw), now])
    credentials = { role, role_fa: PUB_ROLE_FA[role], name, username, password: pw }
  }
  const prev = await db.first<any>('SELECT r.id, u.display_name FROM publication_roles r JOIN users u ON u.id = r.user_id WHERE r.publication_id = ? AND r.role = ? AND r.ended_at IS NULL', [p.id, role])
  await db.batch([
    { sql: 'UPDATE publication_roles SET ended_at = ? WHERE publication_id = ? AND role = ? AND ended_at IS NULL', params: [now, p.id, role] },
    { sql: 'INSERT INTO publication_roles (id, publication_id, user_id, role, started_at) VALUES (?,?,?,?,?)', params: [newId(), p.id, userId, role, now] }
  ])
  await audit(db, u.id, 'publication.role_change', 'publication', p.id, { role, holder: prev?.display_name ?? null }, { role, user_id: userId })
  await activity(db, u.id, 'publication.role_changed', p.id, null, { role })
  return c.json({ ok: true, credentials })
})

adminRoutes.post('/users/:id/reset-password', async (c) => {
  const u = admin(c)
  const db = c.get('db')
  const target = await db.first<any>('SELECT id, username, display_name, system_role FROM users WHERE id = ? AND deleted_at IS NULL', [c.req.param('id')])
  if (!target) throw notFound('کاربر یافت نشد')
  if (target.system_role === 'super_admin' && u.system_role !== 'super_admin') throw bad('رمز سوپرادمین فقط توسط خودش تغییر می‌کند')
  if (target.system_role === 'pub_officer' && u.system_role !== 'super_admin') throw bad('رمز مسئول نشریات فقط توسط سوپرادمین بازنشانی می‌شود')
  const pw = tempPassword()
  await db.run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', [await hashPassword(pw), target.id])
  await db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), target.id])
  await audit(db, u.id, 'user.password_reset', 'user', target.id)
  return c.json({ ok: true, credentials: { name: target.display_name, username: target.username, password: pw } })
})

/** Recovery when a staff member lost their authenticator: turns 2FA off so they can log in and set it up again. */
adminRoutes.post('/users/:id/reset-totp', async (c) => {
  const u = admin(c)
  const db = c.get('db')
  const target = await db.first<any>('SELECT id, system_role FROM users WHERE id = ? AND deleted_at IS NULL', [c.req.param('id')])
  if (!target) throw notFound('کاربر یافت نشد')
  if (target.id === u.id) throw bad('رمز دومرحله‌ای خودتان را از تنظیمات حساب مدیریت کنید')
  if ((target.system_role === 'super_admin' || target.system_role === 'pub_officer') && u.system_role !== 'super_admin')
    throw bad('رمز دومرحله‌ای این حساب فقط توسط سوپرادمین بازنشانی می‌شود')
  await db.run('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_last_step = NULL WHERE id = ?', [target.id])
  await db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), target.id])
  await audit(db, u.id, 'user.totp_reset', 'user', target.id)
  return c.json({ ok: true })
})

// ───────── Users (system staff & students) ─────────
adminRoutes.get('/users', async (c) => {
  admin(c)
  const role = c.req.query('role')
  const q = normalizeFa(c.req.query('q') || '')
  const where = ['u.deleted_at IS NULL']
  const params: unknown[] = []
  if (role) (where.push('u.system_role = ?'), params.push(role))
  if (q) (where.push('(u.display_name LIKE ? OR u.username LIKE ? OR u.student_number LIKE ?)'), params.push(`%${q}%`, `%${q}%`, `%${q}%`))
  const rows = await c.get('db').all(
    `SELECT u.id, u.username, u.display_name, u.student_number, u.system_role, u.status, u.scope_faculty_id, u.last_login_at, u.created_at, u.must_change_password, u.totp_enabled, f.name AS faculty_name,
       (SELECT GROUP_CONCAT(p.title, '، ') FROM publication_roles r JOIN publications p ON p.id = r.publication_id WHERE r.user_id = u.id AND r.ended_at IS NULL) AS publications
     FROM users u LEFT JOIN faculties f ON f.id = u.faculty_id WHERE ${where.join(' AND ')} ORDER BY u.created_at DESC LIMIT 300`,
    params
  )
  return c.json({ users: rows })
})

adminRoutes.post('/users', async (c) => {
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

adminRoutes.post('/users/:id/status', async (c) => {
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

adminRoutes.get('/team-users', async (c) => {
  admin(c)
  const rows = await c.get('db').all("SELECT id, username, display_name FROM users WHERE system_role = 'team' AND deleted_at IS NULL ORDER BY display_name")
  return c.json({ users: rows })
})

// ───────── Structure: faculties, majors, associations ─────────
adminRoutes.get('/structure', async (c) => {
  monitor(c)
  const db = c.get('db')
  return c.json({
    faculties: await db.all('SELECT f.*, (SELECT COUNT(*) FROM publications p WHERE p.faculty_id = f.id AND p.deleted_at IS NULL) AS publication_count FROM faculties f ORDER BY sort_order, name'),
    majors: await db.all('SELECT * FROM majors ORDER BY name'),
    associations: await db.all(
      'SELECT a.*, f.name AS faculty_name, (SELECT COUNT(*) FROM publications p WHERE p.association_id = a.id AND p.deleted_at IS NULL) AS publication_count FROM associations a LEFT JOIN faculties f ON f.id = a.faculty_id ORDER BY a.name'
    ),
    production_roles: await db.all('SELECT * FROM production_roles ORDER BY sort_order, name')
  })
})

adminRoutes.post('/faculties', async (c) => {
  const u = admin(c)
  const b = await body<any>(c)
  const id = b.id || newId()
  const db = c.get('db')
  const name = str(b.name, 'نام دانشکده', { min: 2, max: 100 })
  if (b.id) await db.run('UPDATE faculties SET name = ?, code = ?, sort_order = ?, is_active = ? WHERE id = ?', [name, b.code || null, int(b.sort_order ?? 0, 'ترتیب', {}), b.is_active === false ? 0 : 1, id])
  else await db.run('INSERT INTO faculties (id, name, code, sort_order, is_active, created_at) VALUES (?,?,?,?,1,?)', [id, name, b.code || null, int(b.sort_order ?? 0, 'ترتیب', {}), nowIso()])
  await audit(db, u.id, b.id ? 'faculty.update' : 'faculty.create', 'faculty', id, null, { name })
  return c.json({ ok: true, id })
})

adminRoutes.post('/majors', async (c) => {
  const u = admin(c)
  const b = await body<any>(c)
  const db = c.get('db')
  const id = b.id || newId()
  const name = str(b.name, 'نام رشته', { min: 2, max: 100 })
  if (!(await db.first('SELECT 1 FROM faculties WHERE id = ?', [b.faculty_id]))) throw bad('دانشکده را انتخاب کنید')
  if (b.id) await db.run('UPDATE majors SET name = ?, faculty_id = ? WHERE id = ?', [name, b.faculty_id, id])
  else await db.run('INSERT INTO majors (id, faculty_id, name, created_at) VALUES (?,?,?,?)', [id, b.faculty_id, name, nowIso()])
  await audit(db, u.id, b.id ? 'major.update' : 'major.create', 'major', id, null, { name })
  return c.json({ ok: true, id })
})

adminRoutes.delete('/majors/:id', async (c) => {
  const u = admin(c)
  const db = c.get('db')
  if (await db.first('SELECT 1 FROM users WHERE major_id = ? UNION SELECT 1 FROM team_members WHERE major_id = ?', [c.req.param('id'), c.req.param('id')])) throw bad('این رشته در حال استفاده است و حذف نمی‌شود')
  await db.run('DELETE FROM majors WHERE id = ?', [c.req.param('id')])
  await audit(db, u.id, 'major.delete', 'major', c.req.param('id'))
  return c.json({ ok: true })
})

adminRoutes.post('/associations', async (c) => {
  const u = admin(c)
  const b = await body<any>(c)
  const db = c.get('db')
  const id = b.id || newId()
  const name = str(b.name, 'نام انجمن/کانون', { min: 2, max: 120 })
  const kind = oneOf(b.kind, ['scientific_association', 'cultural_club', 'islamic_association', 'other'] as const, 'نوع', 'scientific_association')
  if (b.id) await db.run('UPDATE associations SET name = ?, kind = ?, faculty_id = ?, is_active = ? WHERE id = ?', [name, kind, b.faculty_id || null, b.is_active === false ? 0 : 1, id])
  else await db.run('INSERT INTO associations (id, faculty_id, name, kind, is_active, created_at) VALUES (?,?,?,?,1,?)', [id, b.faculty_id || null, name, kind, nowIso()])
  await audit(db, u.id, b.id ? 'association.update' : 'association.create', 'association', id, null, { name, kind })
  return c.json({ ok: true, id })
})

adminRoutes.post('/production-roles', async (c) => {
  const u = admin(c)
  const b = await body<{ roles?: string[] }>(c)
  const roles = (b.roles || []).map((r) => String(r).trim()).filter(Boolean).slice(0, 50)
  if (!roles.length) throw bad('حداقل یک نقش وارد کنید')
  const stmts = [{ sql: 'DELETE FROM production_roles', params: [] as unknown[] }]
  roles.forEach((r, i) => stmts.push({ sql: 'INSERT INTO production_roles (id, name, sort_order) VALUES (?,?,?)', params: [newId(), r.slice(0, 60), i] }))
  await c.get('db').batch(stmts)
  await audit(c.get('db'), u.id, 'production_roles.update', 'settings', null, null, roles)
  return c.json({ ok: true })
})

// ───────── Categories ─────────
adminRoutes.get('/categories', async (c) => {
  monitor(c)
  const rows = await c.get('db').all(
    `SELECT c.*, (SELECT COUNT(*) FROM publication_categories pc WHERE pc.category_id = c.id) AS publication_count,
       (SELECT COUNT(*) FROM issue_categories ic WHERE ic.category_id = c.id) AS issue_count FROM categories c ORDER BY c.type, c.sort_order, c.name`
  )
  return c.json({ categories: rows })
})

adminRoutes.post('/categories', async (c) => {
  const u = admin(c)
  const b = await body<any>(c)
  const db = c.get('db')
  const name = str(b.name, 'نام دسته', { min: 2, max: 60 })
  const type = oneOf(b.type, ['subject', 'major', 'format', 'custom'] as const, 'نوع', 'subject')
  const color = /^#[0-9a-fA-F]{6}$/.test(String(b.color)) ? b.color : null
  if (b.parent_id && b.parent_id === b.id) throw bad('دسته نمی‌تواند والد خودش باشد')
  if (b.id) {
    await db.run('UPDATE categories SET name = ?, type = ?, parent_id = ?, icon = ?, color = ?, is_active = ? WHERE id = ?', [name, type, b.parent_id || null, b.icon || null, color, b.is_active === false ? 0 : 1, b.id])
    await audit(db, u.id, 'category.update', 'category', b.id, null, { name })
    return c.json({ ok: true, id: b.id })
  }
  let slug = slugify(b.slug || name)
  if (await db.first('SELECT 1 FROM categories WHERE slug = ?', [slug])) slug += '-' + newId().slice(-4)
  const id = newId()
  const max = await db.first<{ n: number }>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories WHERE type = ?', [type])
  await db.run('INSERT INTO categories (id, parent_id, type, name, slug, icon, color, sort_order, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,1,?)', [id, b.parent_id || null, type, name, slug, b.icon || null, color, max?.n ?? 0, nowIso()])
  await audit(db, u.id, 'category.create', 'category', id, null, { name, type })
  return c.json({ ok: true, id })
})

adminRoutes.post('/categories/order', async (c) => {
  admin(c)
  const b = await body<{ order?: { id: string; parent_id?: string | null }[] }>(c)
  await c.get('db').batch((b.order || []).slice(0, 500).map((o, i) => ({ sql: 'UPDATE categories SET sort_order = ?, parent_id = ? WHERE id = ?', params: [i, o.parent_id || null, o.id] })))
  return c.json({ ok: true })
})

/** Merge category `from` into `into`: re-points publications/issues and deactivates `from`. */
adminRoutes.post('/categories/merge', async (c) => {
  const u = admin(c)
  const b = await body<{ from?: string; into?: string }>(c)
  if (!b.from || !b.into || b.from === b.into) throw bad('دو دستهٔ متفاوت انتخاب کنید')
  const db = c.get('db')
  await db.batch([
    { sql: 'INSERT OR IGNORE INTO publication_categories (publication_id, category_id) SELECT publication_id, ? FROM publication_categories WHERE category_id = ?', params: [b.into, b.from] },
    { sql: 'DELETE FROM publication_categories WHERE category_id = ?', params: [b.from] },
    { sql: 'INSERT OR IGNORE INTO issue_categories (issue_id, category_id) SELECT issue_id, ? FROM issue_categories WHERE category_id = ?', params: [b.into, b.from] },
    { sql: 'DELETE FROM issue_categories WHERE category_id = ?', params: [b.from] },
    { sql: 'UPDATE categories SET parent_id = ? WHERE parent_id = ?', params: [b.into, b.from] },
    { sql: 'UPDATE categories SET is_active = 0 WHERE id = ?', params: [b.from] }
  ])
  await audit(db, u.id, 'category.merge', 'category', b.into, { from: b.from }, { into: b.into })
  return c.json({ ok: true })
})

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
  const rows = await c.get('db').all(
    `SELECT COALESCE(NULLIF(tm.student_number, ''), tm.full_name) AS person_key, tm.full_name, tm.student_number, COUNT(DISTINCT tm.publication_id) AS publication_count,
       GROUP_CONCAT(DISTINCT p.title) AS publications,
       (SELECT COUNT(DISTINCT im.issue_id) FROM issue_members im JOIN team_members t2 ON t2.id = im.team_member_id WHERE COALESCE(NULLIF(t2.student_number, ''), t2.full_name) = COALESCE(NULLIF(tm.student_number, ''), tm.full_name)) AS issue_count,
       (SELECT COUNT(*) FROM toc_assignments ta JOIN team_members t3 ON t3.id = ta.team_member_id WHERE COALESCE(NULLIF(t3.student_number, ''), t3.full_name) = COALESCE(NULLIF(tm.student_number, ''), tm.full_name)) AS section_count
     FROM team_members tm JOIN publications p ON p.id = tm.publication_id WHERE p.deleted_at IS NULL${s.sql}${w}
     GROUP BY person_key ORDER BY issue_count DESC, section_count DESC LIMIT 200`,
    params
  )
  return c.json({ people: rows })
})

adminRoutes.get('/people/:key', async (c) => {
  monitor(c)
  const key = c.req.param('key')
  const db = c.get('db')
  const s = scope(c)
  const memberships = await db.all(
    `SELECT tm.id, tm.full_name, tm.student_number, tm.default_role, tm.is_active, tm.joined_at, tm.left_at, p.id AS publication_id, p.title AS publication_title
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
  return c.json({ memberships, issues, sections })
})

// ───────── Moderation oversight ─────────
adminRoutes.get('/posts', async (c) => {
  admin(c)
  const status = c.req.query('status') || ''
  const rows = await c.get('db').all<any>(
    `SELECT po.id, po.caption, po.images_json, po.status, po.is_story, po.published_at, p.title AS publication_title, i.title AS source_issue_title, i.number AS source_issue_number,
       (SELECT COUNT(*) FROM reports r WHERE r.entity_type = 'post' AND r.entity_id = po.id AND r.status = 'open') AS open_reports
     FROM posts po JOIN publications p ON p.id = po.publication_id JOIN issues i ON i.id = po.source_issue_id
     ${status ? 'WHERE po.status = ?' : ''} ORDER BY po.created_at DESC LIMIT 200`,
    status ? [status] : []
  )
  return c.json({ posts: rows.map((r) => ({ ...r, images: parseJson(r.images_json, []), images_json: undefined })) })
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
  const rows = await c.get('db').all(
    `SELECT cm.id, cm.body, cm.status, cm.flagged, cm.created_at, u.display_name AS author, u.student_number, p.title AS publication_title, cm.post_id
     FROM comments cm JOIN posts po ON po.id = cm.post_id JOIN publications p ON p.id = po.publication_id LEFT JOIN users u ON u.id = cm.user_id
     WHERE cm.status = ? ORDER BY cm.created_at DESC LIMIT 200`,
    [status]
  )
  return c.json({ comments: rows })
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
  const rows = await c.get('db').all(
    `SELECT r.*, u.display_name AS reporter_name FROM reports r LEFT JOIN users u ON u.id = r.reporter_user_id ORDER BY r.status = 'open' DESC, r.created_at DESC LIMIT 200`
  )
  return c.json({ reports: rows })
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
  await c.get('db').run('INSERT INTO deadlines (id, title, due_at, description, created_at) VALUES (?,?,?,?,?)', [id, str(b.title, 'عنوان', { max: 120 }), str(b.due_at, 'تاریخ', { max: 10 }), str(b.description, 'توضیح', { max: 1000, optional: true }), nowIso()])
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
  const params: unknown[] = []
  let w = ''
  if (action) (w = 'WHERE a.action LIKE ?'), params.push(action + '%')
  const rows = await c.get('db').all(
    `SELECT a.*, u.display_name AS actor_name, u.username AS actor_username FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id ${w} ORDER BY a.created_at DESC LIMIT 300`,
    params
  )
  return c.json({ items: rows })
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

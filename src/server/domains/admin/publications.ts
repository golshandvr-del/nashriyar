// Admin domain module: overview + publications (CRUD, status, roles, followers, credential resets).
// Mounted by routes/admin.ts (ROADMAP phase 17 split; parent middleware applies).
import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { hashPassword, newId, tempPassword } from '../../lib/crypto'
import { activity, audit, bad, body, keywordsCsv, notFound, notify, nowIso, oneOf, parseJson, slugify, str } from '../../lib/util'
import { normalizeFa, toEnDigits } from '../../../shared/fa'
import { ensureReminders } from '../../lib/reminders'
import { PUB_ROLES, PUB_ROLE_FA, admin, monitor, scope, scopedPub } from './service'

export const publicationsRoutes = new Hono<AppEnv>()

// ───────── Overview lists ─────────
publicationsRoutes.get('/overview', async (c) => {
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

publicationsRoutes.get('/publications', async (c) => {
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
publicationsRoutes.get('/publications/:id', async (c) => {
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

publicationsRoutes.get('/publications/:id/followers', async (c) => {
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
publicationsRoutes.post('/publications', async (c) => {
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

publicationsRoutes.put('/publications/:id', async (c) => {
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

publicationsRoutes.post('/publications/:id/status', async (c) => {
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
publicationsRoutes.post('/publications/:id/roles', async (c) => {
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

publicationsRoutes.post('/users/:id/reset-password', async (c) => {
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
publicationsRoutes.post('/users/:id/reset-totp', async (c) => {
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

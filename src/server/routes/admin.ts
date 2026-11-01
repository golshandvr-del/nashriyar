import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { newId, sha256 } from '../lib/crypto'
import { normalizeSecret } from './auth'
import { audit, bad, body, cursorPage, getSetting, int, notFound, notify, nowIso, oneOf, parseJson, setSetting, str } from '../lib/util'
import { toEnDigits } from '../../shared/fa'
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, getThresholds, getWeights, sanitizeThresholds, sanitizeWeights } from '../insights'
import { admin } from '../domains/admin/service'
import { todayRoutes } from '../domains/admin/today'
import { publicationsRoutes } from '../domains/admin/publications'
import { usersRoutes } from '../domains/admin/users'
import { structureRoutes } from '../domains/admin/structure'
import { categoriesRoutes } from '../domains/admin/categories'
import { approvalsRoutes } from '../domains/admin/approvals'

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

// domain module (ROADMAP phase 17): ../domains/admin/approvals
adminRoutes.route('/', approvalsRoutes)

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

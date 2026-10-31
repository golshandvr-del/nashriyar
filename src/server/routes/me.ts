import { Hono } from 'hono'
import type { AppEnv } from '../context'
import type { Db } from '../adapters/db'
import { checkRateLimit, clearFailures, clientIp, recordFailure, requireUser } from '../auth'
import { newId, normalizePurchaseCode, sha256 } from '../lib/crypto'
import { activity, bad, body, HttpError, notFound, nowIso, oneOf, parseJson, str } from '../lib/util'
import { toEnDigits, toJalali } from '../../shared/fa'
import { flagComment } from '../lib/moderation'
import { requireFeature } from '../lib/features'

export const meRoutes = new Hono<AppEnv>()

meRoutes.use('*', async (c, next) => {
  requireUser(c)
  await next()
})

// ───────── Library ─────────
meRoutes.get('/library', async (c) => {
  const u = requireUser(c)
  const rows = await c.get('db').all(
    `SELECT i.id, i.number, i.title, i.cover_key, i.page_count, i.pricing, p.slug AS publication_slug, p.title AS publication_title, p.theme_color,
       e.source, e.granted_at, rp.last_page, rp.percent, rp.updated_at AS read_at
     FROM entitlements e JOIN issues i ON i.id = e.issue_id JOIN publications p ON p.id = i.publication_id
     LEFT JOIN reading_progress rp ON rp.user_id = e.user_id AND rp.issue_id = e.issue_id
     WHERE e.user_id = ? AND e.revoked_at IS NULL AND i.deleted_at IS NULL
     ORDER BY COALESCE(rp.updated_at, e.granted_at) DESC`,
    [u.id]
  )
  return c.json({ items: rows })
})

meRoutes.post('/library/:issueId', async (c) => {
  const u = requireUser(c)
  const db = c.get('db')
  const i = await db.first<{ id: string; pricing: string; publication_id: string }>(
    "SELECT id, pricing, publication_id FROM issues WHERE id = ? AND status = 'published' AND published_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now') AND deleted_at IS NULL",
    [c.req.param('issueId')]
  )
  if (!i) throw notFound('شماره یافت نشد')
  if (i.pricing !== 'free') throw bad('این شماره پولی است؛ برای افزودن، کد خرید را ثبت کنید')
  await db.run(
    "INSERT INTO entitlements (id, user_id, issue_id, source, granted_at) VALUES (?,?,?, 'free', ?) ON CONFLICT(user_id, issue_id) DO UPDATE SET revoked_at = NULL",
    [newId(), u.id, i.id, nowIso()]
  )
  await activity(db, u.id, 'library.add_free', i.publication_id, i.id)
  return c.json({ ok: true })
})

meRoutes.delete('/library/:issueId', async (c) => {
  const u = requireUser(c)
  // only free items can be removed by the user; purchased items stay
  await c.get('db').run("DELETE FROM entitlements WHERE user_id = ? AND issue_id = ? AND source = 'free'", [u.id, c.req.param('issueId')])
  return c.json({ ok: true })
})

// ───────── Purchase codes ─────────
async function findCode(c: any, raw: string) {
  const norm = normalizePurchaseCode(raw)
  if (norm.length !== 8) throw bad('قالب کد صحیح نیست؛ کد شبیه NSH-XXXX-XXXX است')
  const hash = await sha256(norm)
  return c.get('db').first(
    `SELECT ac.*, i.title AS issue_title, i.number AS issue_number, i.cover_key, i.status AS issue_status, p.title AS publication_title
     FROM access_codes ac JOIN issues i ON i.id = ac.issue_id JOIN publications p ON p.id = ac.publication_id WHERE ac.code_hash = ?`,
    [hash]
  )
}

function codeProblem(code: any, user: any): string | null {
  if (!code) return 'کد نامعتبر است'
  if (code.revoked_at) return 'این کد توسط تیم نشریه باطل شده است'
  if (code.redeemed_at) return code.redeemed_by === user.id ? 'این کد قبلاً توسط شما ثبت شده و شماره در کتابخانهٔ شماست' : 'این کد قبلاً استفاده شده است'
  if (code.expires_at <= nowIso()) return 'مهلت استفاده از این کد به پایان رسیده است'
  if (code.bound_student_number && code.bound_student_number !== user.student_number) return 'این کد برای شماره دانشجویی دیگری صادر شده است'
  if (code.issue_status !== 'published') return 'این شماره هنوز منتشر نشده است'
  return null
}

/** Step 1: preview which issue a code belongs to (no state change). */
meRoutes.post('/codes/check', async (c) => {
  const u = requireUser(c)
  const key = `code:${u.id}:${clientIp(c)}`
  await checkRateLimit(c, key)
  const b = await body<{ code?: string }>(c)
  const code = await findCode(c, toEnDigits(str(b.code, 'کد خرید', { max: 40 })))
  const problem = codeProblem(code, u)
  if (problem) {
    if (!code) await recordFailure(c, key)
    throw new HttpError(400, problem, 'code_invalid')
  }
  return c.json({
    issue: { id: code.issue_id, title: code.issue_title, number: code.issue_number, cover_key: code.cover_key, publication_title: code.publication_title },
    expires_at: code.expires_at
  })
})

/** Step 2: redeem atomically — concurrent attempts with the same code: exactly one succeeds. */
meRoutes.post('/codes/redeem', async (c) => {
  await requireFeature(c.get('db'), 'paid_content')
  const u = requireUser(c)
  const db = c.get('db')
  const key = `code:${u.id}:${clientIp(c)}`
  await checkRateLimit(c, key)
  const b = await body<{ code?: string }>(c)
  const code = await findCode(c, toEnDigits(str(b.code, 'کد خرید', { max: 40 })))
  const problem = codeProblem(code, u)
  if (problem) {
    if (!code) await recordFailure(c, key)
    throw new HttpError(400, problem, 'code_invalid')
  }
  const now = nowIso()
  const r = await db.run(
    'UPDATE access_codes SET redeemed_at = ?, redeemed_by = ? WHERE id = ? AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?',
    [now, u.id, code.id, now]
  )
  if (r.changes !== 1) throw new HttpError(409, 'این کد هم‌زمان استفاده شد یا دیگر معتبر نیست', 'code_race')
  await db.run(
    `INSERT INTO entitlements (id, user_id, issue_id, source, access_code_id, granted_at) VALUES (?,?,?, 'code', ?, ?)
     ON CONFLICT(user_id, issue_id) DO UPDATE SET source = 'code', access_code_id = excluded.access_code_id, revoked_at = NULL, granted_at = excluded.granted_at`,
    [newId(), u.id, code.issue_id, code.id, now]
  )
  await clearFailures(c, key)
  await activity(db, u.id, 'code.redeemed', code.publication_id, code.issue_id)
  return c.json({ ok: true, issue_id: code.issue_id })
})

// ───────── Follows (counts never exposed) ─────────
meRoutes.get('/follows', async (c) => {
  const u = requireUser(c)
  const rows = await c.get('db').all(
    `SELECT p.id, p.slug, p.title, p.tagline, p.logo_key, p.theme_color FROM follows f JOIN publications p ON p.id = f.publication_id
     WHERE f.user_id = ? AND f.unfollowed_at IS NULL AND p.status = 'active' ORDER BY f.created_at DESC`,
    [u.id]
  )
  return c.json({ publications: rows })
})

meRoutes.post('/follows/:publicationId', async (c) => {
  const u = requireUser(c)
  const db = c.get('db')
  const p = await db.first("SELECT id FROM publications WHERE id = ? AND status = 'active'", [c.req.param('publicationId')])
  if (!p) throw notFound('نشریه یافت نشد')
  await db.run(
    'INSERT INTO follows (user_id, publication_id, created_at) VALUES (?,?,?) ON CONFLICT(user_id, publication_id) DO UPDATE SET unfollowed_at = NULL, created_at = excluded.created_at',
    [u.id, c.req.param('publicationId'), nowIso()]
  )
  await activity(db, u.id, 'follow', c.req.param('publicationId'))
  return c.json({ ok: true, following: true })
})

meRoutes.delete('/follows/:publicationId', async (c) => {
  const u = requireUser(c)
  const db = c.get('db')
  await db.run('UPDATE follows SET unfollowed_at = ? WHERE user_id = ? AND publication_id = ? AND unfollowed_at IS NULL', [nowIso(), u.id, c.req.param('publicationId')])
  await activity(db, u.id, 'unfollow', c.req.param('publicationId'))
  return c.json({ ok: true, following: false })
})

/** Personal feed: posts of followed publications. */
meRoutes.get('/feed', async (c) => {
  const u = requireUser(c)
  const rows = await c.get('db').all<any>(
    `SELECT po.id, po.caption, po.images_json, po.alt_json, po.published_at, p.slug AS publication_slug, p.title AS publication_title, p.logo_key, p.theme_color
     FROM posts po JOIN publications p ON p.id = po.publication_id JOIN follows f ON f.publication_id = po.publication_id AND f.user_id = ? AND f.unfollowed_at IS NULL
     WHERE po.status = 'published' AND po.published_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now') AND po.is_story = 0 ORDER BY po.published_at DESC LIMIT 60`,
    [u.id]
  )
  return c.json({ posts: rows.map((x) => ({ ...x, images: parseJson(x.images_json, []), alts: parseJson(x.alt_json, []), images_json: undefined, alt_json: undefined })) })
})

// ───────── Saved posts ─────────
meRoutes.get('/saved', async (c) => {
  const u = requireUser(c)
  const rows = await c.get('db').all<any>(
    `SELECT po.id, po.caption, po.images_json, po.alt_json, po.published_at, p.slug AS publication_slug, p.title AS publication_title
     FROM saved_posts s JOIN posts po ON po.id = s.post_id JOIN publications p ON p.id = po.publication_id
     WHERE s.user_id = ? AND po.status = 'published' AND po.published_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now') ORDER BY s.created_at DESC`,
    [u.id]
  )
  return c.json({ posts: rows.map((x) => ({ ...x, images: parseJson(x.images_json, []), alts: parseJson(x.alt_json, []), images_json: undefined, alt_json: undefined })) })
})

meRoutes.post('/saved/:postId', async (c) => {
  const u = requireUser(c)
  await c.get('db').run('INSERT OR IGNORE INTO saved_posts (user_id, post_id, created_at) VALUES (?,?,?)', [u.id, c.req.param('postId'), nowIso()])
  return c.json({ ok: true, saved: true })
})

meRoutes.delete('/saved/:postId', async (c) => {
  const u = requireUser(c)
  await c.get('db').run('DELETE FROM saved_posts WHERE user_id = ? AND post_id = ?', [u.id, c.req.param('postId')])
  return c.json({ ok: true, saved: false })
})

// ───────── Comments & reports ─────────
meRoutes.post('/posts/:postId/comments', async (c) => {
  await requireFeature(c.get('db'), 'comments')
  const u = requireUser(c)
  const db = c.get('db')
  const key = `comment:${u.id}`
  await checkRateLimit(c, key)
  const b = await body<{ body?: string; parent_id?: string }>(c)
  const text = str(b.body, 'متن نظر', { min: 2, max: 1000 })
  const po = await db.first<{ id: string; publication_id: string }>("SELECT id, publication_id FROM posts WHERE id = ? AND status = 'published' AND published_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')", [c.req.param('postId')])
  if (!po) throw notFound('پست یافت نشد')
  // simple flood control: max 10 comments / 10 minutes
  const recent = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM comments WHERE user_id = ? AND created_at > ?', [u.id, new Date(Date.now() - 600_000).toISOString()])
  if ((recent?.n ?? 0) >= 10) {
    await recordFailure(c, key)
    throw new HttpError(429, 'تعداد نظرهای ارسالی شما زیاد است؛ کمی بعد دوباره تلاش کنید')
  }
  // pre-flag only (links, profanity, spam patterns) — the team still decides every comment
  const flagged = flagComment(text).flagged ? 1 : 0
  await db.run(
    "INSERT INTO comments (id, post_id, user_id, parent_id, body, status, flagged, created_at) VALUES (?,?,?,?,?, 'pending', ?, ?)",
    [newId(), po.id, u.id, b.parent_id || null, text, flagged, nowIso()]
  )
  await activity(db, u.id, 'comment.created', po.publication_id)
  return c.json({ ok: true, message: 'نظر شما ثبت شد و پس از تأیید تیم نشریه نمایش داده می‌شود' })
})

meRoutes.get('/comments', async (c) => {
  const u = requireUser(c)
  const rows = await c.get('db').all(
    `SELECT cm.id, cm.body, cm.status, cm.reject_reason, cm.created_at, cm.post_id, p.title AS publication_title
     FROM comments cm JOIN posts po ON po.id = cm.post_id JOIN publications p ON p.id = po.publication_id WHERE cm.user_id = ? ORDER BY cm.created_at DESC LIMIT 100`,
    [u.id]
  )
  return c.json({ comments: rows })
})

meRoutes.post('/reports', async (c) => {
  const u = requireUser(c)
  const b = await body<{ entity_type?: string; entity_id?: string; reason?: string }>(c)
  const type = ['post', 'comment', 'issue', 'publication'].includes(String(b.entity_type)) ? String(b.entity_type) : null
  if (!type) throw bad('نوع گزارش نامعتبر است')
  await c.get('db').run('INSERT INTO reports (id, reporter_user_id, entity_type, entity_id, reason, created_at) VALUES (?,?,?,?,?,?)', [
    newId(),
    u.id,
    type,
    str(b.entity_id, 'شناسه', { max: 40 }),
    str(b.reason, 'دلیل', { max: 500, optional: true }),
    nowIso()
  ])
  return c.json({ ok: true })
})

// ───────── Notifications & announcements ─────────
meRoutes.get('/notifications', async (c) => {
  const u = requireUser(c)
  const db = c.get('db')
  const items = await db.all('SELECT id, type, title, link, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [u.id])
  const unread = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', [u.id])
  return c.json({ items, unread: unread?.n ?? 0 })
})

meRoutes.post('/notifications/read-all', async (c) => {
  const u = requireUser(c)
  await c.get('db').run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [nowIso(), u.id])
  return c.json({ ok: true })
})

meRoutes.get('/profile', async (c) => {
  const u = requireUser(c)
  const db = c.get('db')
  const stats = {
    library: (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM entitlements WHERE user_id = ? AND revoked_at IS NULL', [u.id]))?.n ?? 0,
    following: (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM follows WHERE user_id = ? AND unfollowed_at IS NULL', [u.id]))?.n ?? 0,
    saved: (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM saved_posts WHERE user_id = ?', [u.id]))?.n ?? 0
  }
  // ROADMAP phase 15: full profile, current positions and collaboration history
  const profile = await db.first(`SELECT ${PROFILE_COLS} FROM users WHERE id = ?`, [u.id])
  const positions = await db.all(
    `SELECT r.role, p.id AS publication_id, p.title, p.slug FROM publication_roles r JOIN publications p ON p.id = r.publication_id
     WHERE r.user_id = ? AND r.ended_at IS NULL AND p.deleted_at IS NULL ORDER BY p.title`,
    [u.id]
  )
  const memberships = await db.all(
    `SELECT tm.id, tm.default_role, tm.joined_at, tm.left_at, tm.is_active, p.id AS publication_id, p.title, p.slug,
            (SELECT COUNT(*) FROM certificates ce WHERE ce.team_member_id = tm.id) AS certificates
     FROM team_members tm JOIN publications p ON p.id = tm.publication_id
     WHERE (tm.user_id = ? OR (tm.user_id IS NULL AND ? IS NOT NULL AND tm.student_number = ?)) AND p.deleted_at IS NULL
     ORDER BY tm.is_active DESC, tm.joined_at DESC`,
    [u.id, profile?.student_number ?? null, profile?.student_number ?? null]
  )
  return c.json({ user: { ...u, ...profile }, stats, positions, memberships, required: PROFILE_REQUIRED, complete: profileComplete(profile) })
})

// ───────── Full profile (ROADMAP phase 15) ─────────
export const PROFILE_COLS =
  'id, username, display_name, student_number, faculty_id, major_id, gender, birth_year, degree, entry_year, phone, email, bio, avatar_key, profile_consent_at, profile_completed_at'
export const PROFILE_REQUIRED = ['display_name', 'faculty_id', 'gender', 'degree', 'entry_year', 'student_number'] as const
export const DEGREES = ['associate', 'bachelor', 'master', 'phd'] as const
export const SENSITIVE_FIELDS = ['gender', 'birth_year', 'phone', 'email'] as const
export function profileComplete(p: any): boolean {
  return !!p && PROFILE_REQUIRED.every((k) => p[k] != null && p[k] !== '')
}
export function currentJalaliYear(): number {
  const d = new Date(nowIso())
  return toJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()).jy
}

/** Validates a profile payload; returns the columns to write (only keys present in the payload). */
export async function validateProfile(db: Db, userId: string, b: any, current: any) {
  const out: Record<string, unknown> = {}
  const jy = currentJalaliYear()
  const yearOf = (v: unknown, name: string, min: number, max: number) => {
    if (v === '' || v == null) return null
    const n = Number(toEnDigits(String(v)))
    if (!Number.isInteger(n) || n < min || n > max) throw bad(`«${name}» باید سالی بین ${min} تا ${max} (شمسی) باشد`)
    return n
  }
  if ('display_name' in b) out.display_name = str(b.display_name, 'نام', { min: 2, max: 80 })
  if ('faculty_id' in b) {
    out.faculty_id = b.faculty_id || null
    if (out.faculty_id && !(await db.first('SELECT id FROM faculties WHERE id = ?', [out.faculty_id]))) throw bad('دانشکده نامعتبر است')
  }
  if ('major_id' in b) {
    out.major_id = b.major_id || null
    const fac = 'faculty_id' in out ? out.faculty_id : current?.faculty_id
    if (out.major_id) {
      const m = await db.first<{ faculty_id: string }>('SELECT faculty_id FROM majors WHERE id = ?', [out.major_id])
      if (!m) throw bad('رشته نامعتبر است')
      if (fac && m.faculty_id !== fac) throw bad('رشتهٔ انتخاب‌شده متعلق به این دانشکده نیست')
    }
  }
  if ('gender' in b) out.gender = b.gender ? oneOf(b.gender, ['male', 'female'] as const, 'جنسیت') : null
  if ('degree' in b) out.degree = b.degree ? oneOf(b.degree, DEGREES, 'مقطع تحصیلی') : null
  if ('birth_year' in b) out.birth_year = yearOf(b.birth_year, 'سال تولد', jy - 90, jy - 14)
  if ('entry_year' in b) out.entry_year = yearOf(b.entry_year, 'سال ورود', jy - 40, jy)
  const birth = ('birth_year' in out ? out.birth_year : current?.birth_year) as number | null
  const entry = ('entry_year' in out ? out.entry_year : current?.entry_year) as number | null
  if (birth && entry && entry - birth < 15) throw bad('سال ورود با سال تولد سازگار نیست (فاصلهٔ کمتر از ۱۵ سال)')
  if ('phone' in b) {
    const ph = toEnDigits(String(b.phone || '')).replace(/[\s-]/g, '')
    if (ph && !/^09\d{9}$/.test(ph)) throw bad('شمارهٔ همراه باید ۱۱ رقم و با ۰۹ شروع شود')
    out.phone = ph || null
  }
  if ('email' in b) {
    const em = String(b.email || '').trim().toLowerCase()
    if (em && (em.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em))) throw bad('رایانامه نامعتبر است')
    out.email = em || null
  }
  if ('bio' in b) out.bio = str(b.bio, 'معرفی کوتاه', { max: 300, optional: true }) || null
  if ('student_number' in b) {
    const sn = toEnDigits(String(b.student_number || '').trim())
    if (current?.student_number && sn !== current.student_number) throw bad('شمارهٔ دانشجویی ثبت‌شده فقط توسط مسئول نشریات قابل تغییر است')
    if (sn && !current?.student_number) {
      if (!/^\d{6,14}$/.test(sn)) throw bad('شماره دانشجویی باید فقط شامل ۶ تا ۱۴ رقم باشد')
      if (await db.first('SELECT id FROM users WHERE (student_number = ? OR username = ?) AND id != ?', [sn, sn, userId])) throw bad('این شماره دانشجویی متعلق به حساب دیگری است')
      out.student_number = sn
    }
  }
  const sensitive = SENSITIVE_FIELDS.some((k) => out[k] != null)
  if (sensitive && !current?.profile_consent_at && !b.consent) throw bad('برای ذخیرهٔ جنسیت، سال تولد، تلفن یا رایانامه، رضایت شما لازم است', 'consent_required')
  if (b.consent && !current?.profile_consent_at) out.profile_consent_at = nowIso()
  return out
}

meRoutes.post('/profile', async (c) => {
  const u = requireUser(c)
  const db = c.get('db')
  const b = await body<Record<string, unknown>>(c)
  const current = await db.first<any>(`SELECT ${PROFILE_COLS} FROM users WHERE id = ?`, [u.id])
  const out = await validateProfile(db, u.id, b, current)
  const merged = { ...current, ...out }
  if (profileComplete(merged) && !current?.profile_completed_at) out.profile_completed_at = nowIso()
  const keys = Object.keys(out)
  if (keys.length) await db.run(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => out[k]), u.id])
  // link unlinked team member records that carry the same student number (old team accounts, phase 15)
  if (merged.student_number) await db.run('UPDATE team_members SET user_id = ? WHERE user_id IS NULL AND student_number = ?', [u.id, merged.student_number])
  return c.json({ ok: true, complete: profileComplete(merged) })
})

meRoutes.post('/profile/consent', async (c) => {
  const u = requireUser(c)
  const b = await body<{ consent?: boolean }>(c)
  const db = c.get('db')
  if (b.consent) await db.run('UPDATE users SET profile_consent_at = COALESCE(profile_consent_at, ?) WHERE id = ?', [nowIso(), u.id])
  else await db.run('UPDATE users SET profile_consent_at = NULL, gender = NULL, birth_year = NULL, phone = NULL, email = NULL WHERE id = ?', [u.id])
  return c.json({ ok: true })
})

/** Account deletion (soft): anonymise and disable. */
meRoutes.post('/delete-account', async (c) => {
  const u = requireUser(c)
  if (u.system_role !== 'student') throw bad('حساب‌های مدیریتی و تیم فقط توسط مسئول نشریات غیرفعال می‌شوند')
  const db = c.get('db')
  const now = nowIso()
  await db.run("UPDATE users SET status = 'suspended', deleted_at = ?, display_name = 'کاربر حذف‌شده' WHERE id = ?", [now, u.id])
  await db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ?', [now, u.id])
  return c.json({ ok: true })
})

// ───────── Member portal (ROADMAP phase 9, optional, feature flag `member_portal`) ─────────
// A regular team member signs in with their own student account; they are matched to active
// team_members rows by student_number and may only move the TOC sections assigned to them.
const MEMBER_STATUSES = ['todo', 'writing', 'written'] as const

async function memberSections(c: any, tocId?: string) {
  const u = requireUser(c)
  await requireFeature(c.get('db'), 'member_portal')
  const sn = (u as any).student_number || (await c.get('db').first('SELECT student_number FROM users WHERE id = ?', [u.id]))?.student_number
  if (!sn) return []
  return c.get('db').all(
    `SELECT t.id, t.title, t.status, t.due_at, t.page_start, t.page_end, a.role AS my_role, tm.id AS team_member_id,
            i.id AS issue_id, i.title AS issue_title, i.number AS issue_number, i.status AS issue_status,
            p.id AS publication_id, p.title AS publication_title
       FROM toc_assignments a
       JOIN team_members tm ON tm.id = a.team_member_id AND tm.is_active = 1
       JOIN issue_toc_items t ON t.id = a.toc_item_id
       JOIN issues i ON i.id = t.issue_id AND i.deleted_at IS NULL AND i.status NOT IN ('published','archived')
       JOIN publications p ON p.id = i.publication_id AND p.status = 'active' AND p.deleted_at IS NULL
      WHERE tm.student_number = ?${tocId ? ' AND t.id = ?' : ''}
      ORDER BY (t.due_at IS NULL), t.due_at, i.created_at DESC, t.sort_order`,
    tocId ? [sn, tocId] : [sn]
  )
}

meRoutes.get('/sections', async (c) => {
  return c.json({ items: await memberSections(c), statuses: MEMBER_STATUSES })
})

meRoutes.post('/sections/:tocId/status', async (c) => {
  const u = requireUser(c)
  const rows = await memberSections(c, c.req.param('tocId'))
  const t = rows[0]
  if (!t) throw new HttpError(403, 'این بخش به شما سپرده نشده است')
  const b = await body<{ status?: string; note?: string }>(c)
  const status = oneOf(b.status, MEMBER_STATUSES, 'وضعیت')
  if (!(MEMBER_STATUSES as readonly string[]).includes(t.status)) throw new HttpError(409, 'این بخش وارد مرحلهٔ ویرایش شده و فقط حساب‌های اصلی تیم می‌توانند آن را تغییر دهند')
  if (status === t.status) return c.json({ ok: true })
  const db = c.get('db')
  const now = nowIso()
  await db.batch([
    { sql: 'UPDATE issue_toc_items SET status = ? WHERE id = ?', params: [status, t.id] },
    {
      sql: 'INSERT INTO stage_events (id, issue_id, toc_item_id, from_status, to_status, actor_user_id, note, created_at) VALUES (?,?,?,?,?,?,?,?)',
      params: [newId(), t.issue_id, t.id, t.status, status, u.id, str(b.note, 'یادداشت', { max: 300, optional: true }) || 'از طریق ورود عضو', now]
    }
  ])
  await activity(db, u.id, 'toc.status.member', t.publication_id, t.issue_id, { id: t.id, from: t.status, to: status })
  return c.json({ ok: true })
})

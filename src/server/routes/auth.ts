import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { checkRateLimit, clearFailures, clientIp, createSession, destroySession, recordFailure, requireUser, userPubRoles } from '../auth'
import { hashPassword, needsRehash, newId, sha256, verifyPassword } from '../lib/crypto'
import { audit, bad, body, getSetting, HttpError, nowIso, str } from '../lib/util'
import { toEnDigits } from '../../shared/fa'
import { generateTotpSecret, otpauthUri, verifyTotp } from '../lib/totp'

export const authRoutes = new Hono<AppEnv>()

/** Allowlist second value / recovery code: Persian digits → Latin, no spaces/dashes, upper-case. */
export function normalizeSecret(s: string): string {
  return toEnDigits(s).replace(/[\s\-‌]/g, '').toUpperCase()
}

const homeFor = (role: string) =>
  role === 'student' ? '/' : role === 'team' ? '/team' : '/admin'

authRoutes.post('/login', async (c) => {
  const b = await body<{ username?: string; password?: string; totp?: string }>(c)
  const username = toEnDigits(str(b.username, 'نام کاربری', { max: 64 })).toLowerCase()
  const password = str(b.password, 'رمز عبور', { max: 200 })
  const key = `login:${clientIp(c)}:${username}`
  await checkRateLimit(c, key)
  const db = c.get('db')
  const u = await db.first<{ id: string; password_hash: string; status: string; system_role: string; totp_enabled: number; totp_secret: string | null; totp_last_step: number | null }>(
    'SELECT id, password_hash, status, system_role, totp_enabled, totp_secret, totp_last_step FROM users WHERE (username = ? OR student_number = ?) AND deleted_at IS NULL',
    [username, username]
  )
  if (!u || !(await verifyPassword(password, u.password_hash))) {
    await recordFailure(c, key)
    throw new HttpError(401, 'نام کاربری یا رمز عبور نادرست است', 'bad_credentials')
  }
  if (u.status !== 'active') throw new HttpError(403, 'حساب شما غیرفعال شده است')
  // Transparent algorithm/iteration upgrade (PasswordHasher): the plaintext is only available right now.
  if (needsRehash(u.password_hash)) await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(password), u.id])
  // Second factor: password was right, now the 6-digit authenticator code is required.
  if (u.totp_enabled && u.totp_secret) {
    if (!b.totp) throw new HttpError(401, 'کد شش‌رقمی برنامهٔ احراز هویت را وارد کنید', 'totp_required')
    const step = await verifyTotp(u.totp_secret, b.totp, u.totp_last_step)
    if (step == null) {
      await recordFailure(c, key)
      throw new HttpError(401, 'کد دومرحله‌ای نادرست یا منقضی است', 'totp_invalid')
    }
    await db.run('UPDATE users SET totp_last_step = ? WHERE id = ?', [step, u.id])
  }
  await clearFailures(c, key)
  await createSession(c, u.id)
  return c.json({ ok: true, home: homeFor(u.system_role) })
})

authRoutes.post('/register', async (c) => {
  const db = c.get('db')
  if (!(await getSetting(db, 'registration_open', true))) throw new HttpError(403, 'ثبت‌نام در حال حاضر بسته است')
  const b = await body<{ student_number?: string; password?: string; display_name?: string; faculty_id?: string; accept_terms?: boolean; secret?: string }>(c)
  const sn = toEnDigits(str(b.student_number, 'شماره دانشجویی', { max: 20 }))
  if (!/^\d{6,14}$/.test(sn)) throw bad('شماره دانشجویی باید فقط شامل ۶ تا ۱۴ رقم باشد')
  const password = str(b.password, 'رمز عبور', { min: 8, max: 200 })
  const name = str(b.display_name, 'نام و نام خانوادگی', { min: 2, max: 80 })
  if (!b.accept_terms) throw bad('پذیرش قوانین استفاده الزامی است')
  const key = `register:${clientIp(c)}`
  await checkRateLimit(c, key)
  const exists = await db.first('SELECT id FROM users WHERE username = ? OR student_number = ?', [sn, sn])
  if (exists) {
    await recordFailure(c, key)
    throw bad('با این شماره دانشجویی قبلاً حساب ساخته شده است')
  }
  // Registration mode (SECURITY.md §2): 'open' (default) or 'allowlist' — only listed student numbers, optionally
  // with a matching second value (national id from the officer's CSV, or an activation code).
  let allow: { secret_hash: string | null; used_at: string | null } | null = null
  if ((await getSetting(db, 'registration_mode', 'open')) === 'allowlist') {
    allow = await db.first('SELECT secret_hash, used_at FROM registration_allowlist WHERE student_number = ?', [sn])
    if (!allow || allow.used_at) {
      await recordFailure(c, key)
      throw new HttpError(403, 'این شماره دانشجویی در فهرست مجاز ثبت‌نام نیست؛ با مسئول نشریات تماس بگیرید', 'not_allowlisted')
    }
    if (allow.secret_hash && (await sha256(normalizeSecret(b.secret || ''))) !== allow.secret_hash) {
      await recordFailure(c, key)
      throw new HttpError(403, 'کد ملی یا کد فعال‌سازی با فهرست مجاز مطابقت ندارد', 'bad_secret')
    }
  }
  const id = newId()
  if (allow) await db.run('UPDATE registration_allowlist SET used_at = ? WHERE student_number = ?', [nowIso(), sn])
  await db.run(
    `INSERT INTO users (id, username, student_number, display_name, faculty_id, password_hash, system_role, created_at)
     VALUES (?,?,?,?,?,?, 'student', ?)`,
    [id, sn, sn, name, b.faculty_id || null, await hashPassword(password), nowIso()]
  )
  await createSession(c, id)
  return c.json({ ok: true, home: '/' })
})

authRoutes.post('/logout', async (c) => {
  await destroySession(c)
  return c.json({ ok: true })
})

authRoutes.get('/me', async (c) => {
  const u = c.get('user')
  if (!u) return c.json({ user: null, publications: [] })
  const publications = await userPubRoles(c, u.id)
  return c.json({ user: u, publications, home: homeFor(u.system_role) })
})

authRoutes.post('/change-password', async (c) => {
  const u = requireUser(c)
  const b = await body<{ current?: string; next?: string }>(c)
  const cur = str(b.current, 'رمز فعلی', { max: 200 })
  const next = str(b.next, 'رمز جدید', { min: 8, max: 200 })
  if (cur === next) throw bad('رمز جدید باید با رمز فعلی متفاوت باشد')
  const db = c.get('db')
  const row = await db.first<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [u.id])
  if (!row || !(await verifyPassword(cur, row.password_hash))) throw bad('رمز فعلی نادرست است')
  await db.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [await hashPassword(next), u.id])
  // revoke all other sessions
  await db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL', [nowIso(), u.id, c.get('sessionId')])
  await audit(db, u.id, 'user.password_change', 'user', u.id)
  return c.json({ ok: true })
})

// ---- Two-factor authentication (TOTP) — staff accounts only (SECURITY.md §1) ----
const staffOnly = (role: string) => {
  if (role === 'student') throw new HttpError(403, 'رمز دومرحله‌ای فقط برای حساب‌های تیم و مدیریت است')
}

authRoutes.get('/totp', async (c) => {
  const u = requireUser(c)
  const r = await c.get('db').first<{ totp_enabled: number }>('SELECT totp_enabled FROM users WHERE id = ?', [u.id])
  return c.json({ enabled: !!r?.totp_enabled, available: u.system_role !== 'student', recommended: u.system_role === 'super_admin' || u.system_role === 'pub_officer' })
})

/** Step 1: create a fresh (not yet active) secret and return it for the authenticator app. */
authRoutes.post('/totp/setup', async (c) => {
  const u = requireUser(c)
  staffOnly(u.system_role)
  const db = c.get('db')
  const r = await db.first<{ totp_enabled: number }>('SELECT totp_enabled FROM users WHERE id = ?', [u.id])
  if (r?.totp_enabled) throw bad('رمز دومرحله‌ای از قبل فعال است؛ برای تعویض ابتدا آن را غیرفعال کنید')
  const secret = generateTotpSecret()
  await db.run('UPDATE users SET totp_secret = ?, totp_enabled = 0, totp_last_step = NULL WHERE id = ?', [secret, u.id])
  return c.json({ secret, uri: otpauthUri(secret, u.username) })
})

/** Step 2: confirm with a code from the app; only then 2FA becomes mandatory at login. */
authRoutes.post('/totp/enable', async (c) => {
  const u = requireUser(c)
  staffOnly(u.system_role)
  const b = await body<{ code?: string }>(c)
  const db = c.get('db')
  const r = await db.first<{ totp_secret: string | null; totp_enabled: number }>('SELECT totp_secret, totp_enabled FROM users WHERE id = ?', [u.id])
  if (!r?.totp_secret) throw bad('ابتدا راه‌اندازی را شروع کنید')
  if (r.totp_enabled) return c.json({ ok: true })
  const step = await verifyTotp(r.totp_secret, String(b.code || ''))
  if (step == null) throw bad('کد نادرست است؛ ساعت گوشی را بررسی و دوباره تلاش کنید')
  await db.run('UPDATE users SET totp_enabled = 1, totp_last_step = ? WHERE id = ?', [step, u.id])
  await audit(db, u.id, 'user.totp_enable', 'user', u.id)
  return c.json({ ok: true })
})

/** Disable requires the current password and a valid code. */
authRoutes.post('/totp/disable', async (c) => {
  const u = requireUser(c)
  const b = await body<{ password?: string; code?: string }>(c)
  const db = c.get('db')
  const r = await db.first<{ password_hash: string; totp_secret: string | null; totp_enabled: number; totp_last_step: number | null }>(
    'SELECT password_hash, totp_secret, totp_enabled, totp_last_step FROM users WHERE id = ?',
    [u.id]
  )
  if (!r?.totp_enabled || !r.totp_secret) return c.json({ ok: true })
  if (!(await verifyPassword(String(b.password || ''), r.password_hash))) throw bad('رمز عبور نادرست است')
  if ((await verifyTotp(r.totp_secret, String(b.code || ''), r.totp_last_step)) == null) throw bad('کد دومرحله‌ای نادرست است')
  await db.run('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_last_step = NULL WHERE id = ?', [u.id])
  await audit(db, u.id, 'user.totp_disable', 'user', u.id)
  return c.json({ ok: true })
})

authRoutes.get('/sessions', async (c) => {
  const u = requireUser(c)
  const rows = await c
    .get('db')
    .all<{ id: string; created_at: string; user_agent: string }>(
      'SELECT id, created_at, user_agent FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC',
      [u.id, nowIso()]
    )
  return c.json({ sessions: rows.map((r) => ({ ...r, id: r.id.slice(0, 12), current: r.id === c.get('sessionId') })) })
})

authRoutes.post('/logout-all', async (c) => {
  const u = requireUser(c)
  await c.get('db').run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), u.id])
  await destroySession(c)
  return c.json({ ok: true })
})

authRoutes.post('/theme', async (c) => {
  const u = requireUser(c)
  const b = await body<{ theme?: string }>(c)
  const t = ['light', 'dark', 'system'].includes(String(b.theme)) ? String(b.theme) : 'system'
  await c.get('db').run('UPDATE users SET theme = ? WHERE id = ?', [t, u.id])
  return c.json({ ok: true })
})

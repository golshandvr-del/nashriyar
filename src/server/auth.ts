import type { Context, MiddlewareHandler } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { AppEnv, PubRole, SessionUser, SystemRole } from './context'
import { randomId, sha256 } from './lib/crypto'
import { getSetting, HttpError, nowIso } from './lib/util'

export const SESSION_COOKIE = 'nsh_sid'
const SESSION_DAYS = 14

const USER_COLS =
  'u.id, u.username, u.display_name, u.student_number, u.system_role, u.scope_faculty_id, u.must_change_password, u.faculty_id, u.theme'

export async function createSession(c: Context<AppEnv>, userId: string): Promise<void> {
  const db = c.get('db')
  const token = randomId(40)
  const id = await sha256(token)
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString()
  await db.run('INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?,?,?,?,?)', [
    id,
    userId,
    nowIso(),
    expires,
    (c.req.header('user-agent') || '').slice(0, 200)
  ])
  await db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [nowIso(), userId])
  // Concurrent-session cap (ROADMAP phase 5, account sharing): keep only the newest N active sessions.
  const max = Math.max(1, Math.min(20, Math.floor(Number(await getSetting(c.get('db'), 'max_sessions', 5)) || 5)))
  await db.run(
    `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id NOT IN (
       SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT ?)`,
    [nowIso(), userId, userId, nowIso(), max]
  )
  const secure = new URL(c.req.url).protocol === 'https:'
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86400 })
}

export async function destroySession(c: Context<AppEnv>): Promise<void> {
  const sid = c.get('sessionId')
  if (sid) await c.get('db').run('UPDATE sessions SET revoked_at = ? WHERE id = ?', [nowIso(), sid])
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

/** Loads the current user (if any) into context. Never throws. */
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('user', null)
  c.set('sessionId', null)
  const token = getCookie(c, SESSION_COOKIE)
  if (token) {
    const id = await sha256(token)
    const row = await c.get('db').first<SessionUser & { expires_at: string }>(
      `SELECT ${USER_COLS}, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.revoked_at IS NULL AND u.status = 'active' AND u.deleted_at IS NULL`,
      [id]
    )
    if (row && row.expires_at > nowIso()) {
      const { expires_at, ...user } = row
      c.set('user', user as SessionUser)
      c.set('sessionId', id)
    }
  }
  await next()
}

/** CSRF defence: state-changing requests must be same-origin (Origin/Referer check) and JSON/multipart. */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const m = c.req.method
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
    const origin = c.req.header('origin') || c.req.header('referer')
    if (origin) {
      const host = new URL(c.req.url).host
      let oh = ''
      try {
        oh = new URL(origin).host
      } catch {}
      if (oh && oh !== host) throw new HttpError(403, 'درخواست از مبدأ نامعتبر', 'csrf')
    }
  }
  await next()
}

export function requireUser(c: Context<AppEnv>): SessionUser {
  const u = c.get('user')
  if (!u) throw new HttpError(401, 'ابتدا وارد شوید', 'auth')
  return u
}

export function requireRole(c: Context<AppEnv>, roles: SystemRole[]): SessionUser {
  const u = requireUser(c)
  if (!roles.includes(u.system_role)) throw new HttpError(403, 'دسترسی ندارید')
  return u
}

/** Current publication roles of a user (one person can hold roles in several publications). */
export async function userPubRoles(c: Context<AppEnv>, userId: string) {
  return c
    .get('db')
    .all<{ publication_id: string; role: PubRole; title: string; slug: string; status: string }>(
      `SELECT r.publication_id, r.role, p.title, p.slug, p.status FROM publication_roles r
       JOIN publications p ON p.id = r.publication_id
       WHERE r.user_id = ? AND r.ended_at IS NULL AND p.deleted_at IS NULL ORDER BY p.title`,
      [userId]
    )
}

/** Ensures the current user is one of the three main accounts of the publication. Admins pass. */
export async function requirePubAccess(c: Context<AppEnv>, publicationId: string, opts: { write?: boolean } = {}) {
  const u = requireUser(c)
  if (u.system_role === 'super_admin' || u.system_role === 'pub_officer') return { user: u, role: null as PubRole | null }
  const r = await c
    .get('db')
    .first<{ role: PubRole; status: string }>(
      `SELECT r.role, p.status FROM publication_roles r JOIN publications p ON p.id = r.publication_id
       WHERE r.user_id = ? AND r.publication_id = ? AND r.ended_at IS NULL`,
      [u.id, publicationId]
    )
  if (!r) throw new HttpError(403, 'به این نشریه دسترسی ندارید')
  if (opts.write && r.status !== 'active') throw new HttpError(403, 'این نشریه تعلیق یا بایگانی شده است')
  return { user: u, role: r.role }
}

// ───────── Rate limiting (DB-backed so it works on Workers and Node) ─────────
const WINDOW_MIN = 15
const MAX_ATTEMPTS = 8
const LOCK_MIN = 15

export async function checkRateLimit(c: Context<AppEnv>, key: string): Promise<void> {
  const r = await c.get('db').first<{ locked_until: string | null }>('SELECT locked_until FROM login_attempts WHERE key = ?', [key])
  if (r?.locked_until && r.locked_until > nowIso()) {
    throw new HttpError(429, 'تلاش‌های ناموفق زیاد بود؛ چند دقیقهٔ دیگر دوباره تلاش کنید', 'rate_limited')
  }
}

export async function recordFailure(c: Context<AppEnv>, key: string): Promise<void> {
  const db = c.get('db')
  const now = Date.now()
  const r = await db.first<{ count: number; window_start: string }>('SELECT count, window_start FROM login_attempts WHERE key = ?', [key])
  if (!r || new Date(r.window_start).getTime() < now - WINDOW_MIN * 60_000) {
    await db.run(
      'INSERT INTO login_attempts (key, count, window_start, locked_until) VALUES (?,1,?,NULL) ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start, locked_until = NULL',
      [key, new Date(now).toISOString()]
    )
    return
  }
  const count = r.count + 1
  const locked = count >= MAX_ATTEMPTS ? new Date(now + LOCK_MIN * 60_000).toISOString() : null
  await db.run('UPDATE login_attempts SET count = ?, locked_until = ? WHERE key = ?', [count, locked, key])
}

export async function clearFailures(c: Context<AppEnv>, key: string): Promise<void> {
  await c.get('db').run('DELETE FROM login_attempts WHERE key = ?', [key])
}

export function clientIp(c: Context): string {
  return c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || (c.req.header('x-forwarded-for') || '').split(',')[0].trim() || 'local'
}

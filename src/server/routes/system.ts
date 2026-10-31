// Developer console API (ROADMAP phase 13): everything technical lives here, separated from publication affairs.
// Only the `developer` role (created from the server CLI) may enter. Hardening layers, in order:
//   1. optional IP allowlist (SYSTEM_IP_ALLOWLIST)           → 403
//   2. role === developer                                   → 401 / 403
//   3. short session (2 h since login)                      → 401 session_expired
//   4. TOTP mandatory (only GET /status works without it)   → 403 totp_required
//   5. sudo mode: password + TOTP re-check valid 10 minutes for every sensitive write / download → 403 sudo_required
// Every action is written to the append-only `system_audit` table (DB triggers forbid UPDATE / DELETE).
import { Hono } from 'hono'
import type { Context, MiddlewareHandler } from 'hono'
import type { AppEnv, SessionUser, SystemRole } from '../context'
import { checkRateLimit, clearFailures, clientIp, recordFailure } from '../auth'
import { hashPassword, newId, tempPassword, verifyPassword } from '../lib/crypto'
import { verifyTotp } from '../lib/totp'
import { HttpError, bad, body, getSetting, notFound, nowIso, oneOf, setSetting, str } from '../lib/util'
import { toEnDigits } from '../../shared/fa'
import { FEATURE_LABELS, getFeatures, sanitizeFeatures } from '../lib/features'
import { getAiStatus } from '../ai'
import { getMonitorStats } from '../lib/monitor'
import { MIGRATIONS } from '../migrate'

export const systemRoutes = new Hono<AppEnv>()

const SESSION_MAX_MS = 2 * 3600_000
const SUDO_MS = 10 * 60_000
/** Technical settings owned by the developer console (removed from the publication officer's settings). */
export const SYSTEM_SETTINGS = ['ai_enabled', 'ai_base_url', 'ai_model', 'ai_api_key', 'ai_monthly_call_limit', 'ai_timeout_sec', 'max_sessions', 'guest_can_read_free'] as const
const SYSTEM_DEFAULTS: Record<string, unknown> = {
  ai_enabled: false,
  ai_base_url: '',
  ai_model: '',
  ai_api_key: '',
  ai_monthly_call_limit: 0,
  ai_timeout_sec: 15,
  max_sessions: 5,
  guest_can_read_free: true
}
const STAFF_ROLES: SystemRole[] = ['super_admin', 'pub_officer']

type SysCtx = Context<AppEnv>

export async function sysAudit(c: SysCtx, action: string, detail?: unknown) {
  await c.get('db').run('INSERT INTO system_audit (id, actor_user_id, action, detail_json, ip, created_at) VALUES (?,?,?,?,?,?)', [
    newId(),
    c.get('user')?.id ?? null,
    action,
    detail === undefined ? null : JSON.stringify(detail),
    clientIp(c),
    nowIso()
  ])
}

function dev(c: SysCtx): SessionUser {
  return c.get('user') as SessionUser
}

async function sessionRow(c: SysCtx) {
  return c.get('db').first<{ created_at: string; elevated_until: string | null }>('SELECT created_at, elevated_until FROM sessions WHERE id = ?', [c.get('sessionId')])
}

/** Layers 1-4 for every /api/system/* request. */
const guard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const allow = c.get('deps').systemIpAllowlist || []
  if (allow.length && !allow.includes(clientIp(c))) throw new HttpError(403, 'دسترسی از این نشانی IP مجاز نیست', 'ip_blocked')
  const u = c.get('user')
  if (!u) throw new HttpError(401, 'ابتدا وارد شوید', 'auth')
  if (u.system_role !== 'developer') throw new HttpError(403, 'این بخش فقط برای طراح سامانه است')
  const s = await sessionRow(c)
  if (!s || Date.now() - new Date(s.created_at).getTime() > SESSION_MAX_MS) {
    await c.get('db').run('UPDATE sessions SET revoked_at = ? WHERE id = ?', [nowIso(), c.get('sessionId')])
    throw new HttpError(401, 'نشست پنل طراح (۲ ساعت) به پایان رسید؛ دوباره وارد شوید', 'session_expired')
  }
  const isStatus = c.req.method === 'GET' && new URL(c.req.url).pathname.endsWith('/api/system/status')
  if (!isStatus) {
    const t = await c.get('db').first<{ totp_enabled: number }>('SELECT totp_enabled FROM users WHERE id = ?', [u.id])
    if (!t?.totp_enabled) throw new HttpError(403, 'برای ورود به پنل طراح، رمز دومرحله‌ای (TOTP) الزامی است', 'totp_required')
  }
  await next()
}
systemRoutes.use('*', guard)

/** Layer 5: sensitive operations need a fresh password + TOTP confirmation (sudo mode). */
async function requireSudo(c: SysCtx) {
  const s = await sessionRow(c)
  if (!s?.elevated_until || s.elevated_until < nowIso()) throw new HttpError(403, 'برای این عملیات، رمز عبور و کد دومرحله‌ای را دوباره تأیید کنید', 'sudo_required')
}

// ───────── status & sudo ─────────
systemRoutes.get('/status', async (c) => {
  const u = dev(c)
  const db = c.get('db')
  const t = await db.first<{ totp_enabled: number }>('SELECT totp_enabled FROM users WHERE id = ?', [u.id])
  const s = await sessionRow(c)
  const elevated = !!s?.elevated_until && s.elevated_until > nowIso()
  return c.json({
    user: { id: u.id, username: u.username, display_name: u.display_name, must_change_password: !!u.must_change_password },
    totp_enabled: !!t?.totp_enabled,
    elevated_until: elevated ? s!.elevated_until : null,
    session_expires_at: s ? new Date(new Date(s.created_at).getTime() + SESSION_MAX_MS).toISOString() : null,
    ip_restricted: (c.get('deps').systemIpAllowlist || []).length > 0,
    ops_available: !!c.get('deps').ops
  })
})

systemRoutes.post('/elevate', async (c) => {
  const u = dev(c)
  const db = c.get('db')
  const key = `system:${clientIp(c)}:${u.id}`
  await checkRateLimit(c, key)
  const b = await body<{ password?: string; totp?: string }>(c)
  const r = await db.first<{ password_hash: string; totp_secret: string | null; totp_last_step: number | null }>(
    'SELECT password_hash, totp_secret, totp_last_step FROM users WHERE id = ?',
    [u.id]
  )
  const okPw = !!r && (await verifyPassword(String(b.password || ''), r.password_hash))
  const step = okPw && r?.totp_secret ? await verifyTotp(r.totp_secret, String(b.totp || ''), r.totp_last_step) : null
  if (!okPw || step == null) {
    await recordFailure(c, key)
    await sysAudit(c, 'system.elevate_failed')
    throw new HttpError(401, 'رمز عبور یا کد دومرحله‌ای نادرست است', 'sudo_invalid')
  }
  await clearFailures(c, key)
  const until = new Date(Date.now() + SUDO_MS).toISOString()
  await db.run('UPDATE users SET totp_last_step = ? WHERE id = ?', [step, u.id])
  await db.run('UPDATE sessions SET elevated_until = ? WHERE id = ?', [until, c.get('sessionId')])
  await sysAudit(c, 'system.elevate')
  return c.json({ ok: true, elevated_until: until })
})

systemRoutes.post('/elevate/drop', async (c) => {
  await c.get('db').run('UPDATE sessions SET elevated_until = NULL WHERE id = ?', [c.get('sessionId')])
  return c.json({ ok: true })
})

// ───────── health / monitoring (moved from the officer's settings) ─────────
systemRoutes.get('/health', async (c) => {
  const db = c.get('db')
  const deps = c.get('deps')
  const started = Date.now()
  await db.first('SELECT 1 AS ok')
  return c.json({
    ok: true,
    db_latency_ms: Date.now() - started,
    disk: deps.disk?.() ?? null,
    server_pdf: deps.pdf?.name ?? null,
    maintenance_last: await getSetting<any>(db, 'maintenance_last', null),
    version: deps.ops?.version ?? null,
    ...getMonitorStats()
  })
})

// ───────── technical settings: AI layer, feature flags, members-only, sessions cap, maintenance mode ─────────
systemRoutes.get('/settings', async (c) => {
  const db = c.get('db')
  const out: Record<string, unknown> = {}
  for (const k of SYSTEM_SETTINGS) out[k] = await getSetting(db, k, SYSTEM_DEFAULTS[k])
  if (out.ai_api_key) out.ai_api_key = '••••' + String(out.ai_api_key).slice(-4)
  return c.json({
    settings: out,
    feature_flags: await getFeatures(db),
    feature_labels: FEATURE_LABELS,
    maintenance: await getSetting(db, 'maintenance_mode', { on: false, message: '' }),
    ai_status: await getAiStatus(db)
  })
})

systemRoutes.post('/settings', async (c) => {
  await requireSudo(c)
  const db = c.get('db')
  const b = await body<Record<string, unknown>>(c)
  const changed: Record<string, unknown> = {}
  for (const k of SYSTEM_SETTINGS) {
    if (!(k in b)) continue
    let v = b[k]
    if (k === 'ai_api_key' && typeof v === 'string' && v.startsWith('••••')) continue
    if (k === 'ai_monthly_call_limit') v = Math.max(0, Math.min(1_000_000, Math.floor(Number(v) || 0)))
    if (k === 'ai_timeout_sec') v = Math.max(3, Math.min(60, Math.floor(Number(v) || 15)))
    if (k === 'max_sessions') v = Math.max(1, Math.min(20, Math.floor(Number(v) || 5)))
    if (k === 'ai_enabled' || k === 'guest_can_read_free') v = v === true
    if (typeof v === 'string') v = v.slice(0, 500)
    await setSetting(db, k, v)
    changed[k] = k === 'ai_api_key' ? '(changed)' : v
  }
  if ('feature_flags' in b) {
    const next = { ...(await getFeatures(db)), ...sanitizeFeatures(b.feature_flags) }
    await setSetting(db, 'feature_flags', next)
    changed.feature_flags = next
  }
  if ('maintenance' in b) {
    const m = (b.maintenance || {}) as { on?: unknown; message?: unknown }
    const next = { on: m.on === true, message: typeof m.message === 'string' ? m.message.slice(0, 300) : '', since: m.on === true ? nowIso() : null }
    await setSetting(db, 'maintenance_mode', next)
    changed.maintenance = next
  }
  await sysAudit(c, 'system.settings', changed)
  return c.json({ ok: true })
})

// ───────── backups ─────────
function ops(c: SysCtx) {
  const o = c.get('deps').ops
  if (!o) throw new HttpError(501, 'این عملیات فقط روی سرور خودمیزبان (Node) در دسترس است', 'ops_unavailable')
  return o
}

systemRoutes.get('/backups', async (c) => {
  const o = c.get('deps').ops
  return c.json({ available: !!o, backups: o ? o.listBackups() : [], restore_test: await getSetting<any>(c.get('db'), 'restore_test_last', null) })
})

systemRoutes.post('/backups/run', async (c) => {
  await requireSudo(c)
  const b = await body<{ kind?: string }>(c)
  const kind = oneOf(b.kind, ['db', 'files'] as const, 'نوع پشتیبان', 'db')
  const o = ops(c)
  const r = kind === 'files' ? o.backupFiles() : o.backupDb()
  const name = r.file.split(/[\\/]/).pop()
  await sysAudit(c, 'system.backup', { kind, name, offsite: !!r.offsite })
  return c.json({ ok: true, name, offsite: !!r.offsite })
})

systemRoutes.post('/backups/restore-test', async (c) => {
  await requireSudo(c)
  const r = ops(c).restoreTest() as { ok?: boolean; backup?: string | null }
  const summary = { ...(r as object), backup: r.backup ? String(r.backup).split(/[\\/]/).pop() : null, at: nowIso() }
  await setSetting(c.get('db'), 'restore_test_last', summary)
  await sysAudit(c, 'system.restore_test', { ok: !!r.ok, backup: summary.backup })
  return c.json({ ok: true, result: summary })
})

systemRoutes.get('/backups/:name/download', async (c) => {
  await requireSudo(c)
  const name = c.req.param('name')
  const o = ops(c)
  if (!o.listBackups().some((x) => x.name === name)) throw notFound('فایل پشتیبان یافت نشد')
  const bytes = o.readBackup(name)
  if (!bytes) throw notFound('فایل پشتیبان یافت نشد')
  await sysAudit(c, 'system.backup_download', { name, size: bytes.byteLength })
  return new Response(bytes, {
    headers: {
      'Content-Type': name.endsWith('.db') ? 'application/vnd.sqlite3' : 'application/gzip',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store'
    }
  })
})

// ───────── active sessions & login locks of all users ─────────
systemRoutes.get('/sessions', async (c) => {
  const db = c.get('db')
  const now = nowIso()
  const sessions = await db.all(
    `SELECT s.id, s.user_id, s.created_at, s.expires_at, s.user_agent, u.username, u.display_name, u.system_role
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.revoked_at IS NULL AND s.expires_at > ? ORDER BY s.created_at DESC LIMIT 300`,
    [now]
  )
  const locks = await db.all('SELECT key, count, window_start, locked_until FROM login_attempts ORDER BY window_start DESC LIMIT 200')
  return c.json({
    sessions: sessions.map((s: any) => ({ ...s, id: undefined, ref: String(s.id).slice(0, 12), current: s.id === c.get('sessionId') })),
    locks: locks.map((l: any) => ({ ...l, locked: !!l.locked_until && l.locked_until > now }))
  })
})

systemRoutes.post('/sessions/:ref/revoke', async (c) => {
  await requireSudo(c)
  const ref = c.req.param('ref')
  if (!/^[0-9a-f]{12}$/.test(ref)) throw bad('شناسهٔ نشست نامعتبر است')
  const db = c.get('db')
  const row = await db.first<{ id: string; user_id: string }>('SELECT id, user_id FROM sessions WHERE id LIKE ? AND revoked_at IS NULL', [ref + '%'])
  if (!row) throw notFound('نشست یافت نشد')
  if (row.id === c.get('sessionId')) throw bad('نشست فعلی خودتان را از «خروج» ببندید')
  await db.run('UPDATE sessions SET revoked_at = ? WHERE id = ?', [nowIso(), row.id])
  await sysAudit(c, 'system.session_revoke', { user_id: row.user_id, ref })
  return c.json({ ok: true })
})

systemRoutes.post('/users/:id/logout-all', async (c) => {
  await requireSudo(c)
  const id = c.req.param('id')
  const db = c.get('db')
  if (id === dev(c).id) throw bad('برای حساب خودتان از «خروج» استفاده کنید')
  await db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), id])
  await sysAudit(c, 'system.user_logout_all', { user_id: id })
  return c.json({ ok: true })
})

systemRoutes.post('/locks/clear', async (c) => {
  await requireSudo(c)
  const b = await body<{ key?: string }>(c)
  const key = str(b.key, 'کلید قفل', { max: 200 })
  await c.get('db').run('DELETE FROM login_attempts WHERE key = ?', [key])
  await sysAudit(c, 'system.lock_clear', { key })
  return c.json({ ok: true })
})

// ───────── database: version, migrations, table sizes, VACUUM / ANALYZE ─────────
systemRoutes.get('/db', async (c) => {
  const db = c.get('db')
  const applied = await db.all<{ name: string; applied_at: string }>('SELECT name, applied_at FROM _migrations ORDER BY name')
  const tables = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")
  const sizes: { name: string; rows: number }[] = []
  for (const t of tables) {
    const r = await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM "${t.name.replace(/"/g, '')}"`)
    sizes.push({ name: t.name, rows: Number(r?.n || 0) })
  }
  sizes.sort((a, b) => b.rows - a.rows)
  const o = c.get('deps').ops
  return c.json({
    version: o?.version ?? null,
    db_file_bytes: o?.dbFileBytes() ?? null,
    migrations: MIGRATIONS.map((m) => ({ name: m.name, applied_at: applied.find((a) => a.name === m.name)?.applied_at ?? null })),
    tables: sizes,
    ops_available: !!o
  })
})

systemRoutes.post('/db/:op', async (c) => {
  await requireSudo(c)
  const op = oneOf(c.req.param('op'), ['vacuum', 'analyze'] as const, 'عملیات')
  const o = ops(c)
  const t0 = Date.now()
  const before = o.dbFileBytes()
  if (op === 'vacuum') o.vacuum()
  else o.analyze()
  const res = { op, ms: Date.now() - t0, before_bytes: before, after_bytes: o.dbFileBytes() }
  await sysAudit(c, `system.db_${op}`, res)
  return c.json({ ok: true, ...res })
})

// ───────── senior staff accounts (super admin & publication officer) — only from here ─────────
systemRoutes.get('/staff', async (c) => {
  const rows = await c
    .get('db')
    .all(
      `SELECT id, username, display_name, system_role, status, totp_enabled, must_change_password, last_login_at, created_at
       FROM users WHERE system_role IN ('super_admin','pub_officer') AND deleted_at IS NULL ORDER BY system_role, created_at`
    )
  return c.json({ staff: rows })
})

systemRoutes.post('/staff', async (c) => {
  await requireSudo(c)
  const b = await body<any>(c)
  const role = oneOf(b.system_role, STAFF_ROLES, 'نقش')
  const db = c.get('db')
  const username = toEnDigits(str(b.username, 'نام کاربری', { min: 3, max: 40 })).toLowerCase()
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw bad('نام کاربری فقط حروف لاتین، عدد و . _ - مجاز است')
  if (await db.first('SELECT 1 FROM users WHERE username = ?', [username])) throw bad('این نام کاربری قبلاً استفاده شده است')
  const name = str(b.display_name, 'نام', { min: 2, max: 80 })
  const pw = tempPassword()
  const id = newId()
  await db.run('INSERT INTO users (id, username, display_name, password_hash, must_change_password, system_role, created_at) VALUES (?,?,?,?,1,?,?)', [
    id,
    username,
    name,
    await hashPassword(pw),
    role,
    nowIso()
  ])
  await sysAudit(c, 'system.staff_create', { id, username, role })
  return c.json({ ok: true, id, credentials: { name, username, password: pw } })
})

async function staffTarget(c: SysCtx) {
  const t = await c.get('db').first<any>("SELECT id, username, display_name, system_role FROM users WHERE id = ? AND deleted_at IS NULL AND system_role IN ('super_admin','pub_officer')", [c.req.param('id')])
  if (!t) throw notFound('حساب کارمند ارشد یافت نشد')
  return t
}

systemRoutes.post('/staff/:id/reset-password', async (c) => {
  await requireSudo(c)
  const t = await staffTarget(c)
  const db = c.get('db')
  const pw = tempPassword()
  await db.run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', [await hashPassword(pw), t.id])
  await db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), t.id])
  await sysAudit(c, 'system.staff_password_reset', { id: t.id, username: t.username })
  return c.json({ ok: true, credentials: { name: t.display_name, username: t.username, password: pw } })
})

systemRoutes.post('/staff/:id/reset-totp', async (c) => {
  await requireSudo(c)
  const t = await staffTarget(c)
  const db = c.get('db')
  await db.run('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_last_step = NULL WHERE id = ?', [t.id])
  await db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), t.id])
  await sysAudit(c, 'system.staff_totp_reset', { id: t.id, username: t.username })
  return c.json({ ok: true })
})

systemRoutes.post('/staff/:id/status', async (c) => {
  await requireSudo(c)
  const t = await staffTarget(c)
  const b = await body<{ status?: string }>(c)
  const status = oneOf(b.status, ['active', 'suspended'] as const, 'وضعیت')
  const db = c.get('db')
  if (status === 'suspended' && t.system_role === 'super_admin') {
    const n = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE system_role = 'super_admin' AND status = 'active' AND deleted_at IS NULL")
    if (Number(n?.n || 0) <= 1) throw bad('آخرین مدیر کل فعال را نمی‌توان غیرفعال کرد')
  }
  await db.run('UPDATE users SET status = ? WHERE id = ?', [status, t.id])
  if (status === 'suspended') await db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), t.id])
  await sysAudit(c, 'system.staff_status', { id: t.id, username: t.username, status })
  return c.json({ ok: true })
})

// ───────── independent, append-only technical audit log ─────────
systemRoutes.get('/audit', async (c) => {
  const before = c.req.query('before')
  const rows = await c.get('db').all(
    `SELECT a.id, a.action, a.detail_json, a.ip, a.created_at, u.username AS actor
     FROM system_audit a LEFT JOIN users u ON u.id = a.actor_user_id
     ${before ? 'WHERE a.created_at < ?' : ''} ORDER BY a.created_at DESC LIMIT 100`,
    before ? [before] : []
  )
  return c.json({ items: rows })
})

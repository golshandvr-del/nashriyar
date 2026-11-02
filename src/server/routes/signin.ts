// Alternative sign-in methods (ROADMAP phase 19): SMS one-time code with a verified mobile number, and university
// SSO over OpenID Connect (authorization code + PKCE). Password sign-in (routes/auth.ts) stays the primary method.
//   GET    /api/signin/methods             which methods are configured (for the login page)
//   POST   /api/signin/otp/send            {phone}        → code by SMS (always 200 for unknown numbers: no enumeration)
//   POST   /api/signin/otp/verify          {phone, code}  → session
//   GET    /api/signin/phone               signed-in user's verified number (masked)
//   POST   /api/signin/phone/send|verify   verify a number for OTP sign-in;  DELETE /api/signin/phone
//   GET    /api/signin/sso/start?next=&link=1   → 302 to the identity provider
//   GET    /api/signin/sso/callback        ← provider; verifies id_token, signs in / links, → 302 into the app
//   GET    /api/signin/sso/identities      linked identities;  DELETE /api/signin/sso/identities
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../context'
import { checkRateLimit, clearFailures, clientIp, createSession, recordFailure, requireUser } from '../auth'
import { hashPassword, newId, randomId, sha256 } from '../lib/crypto'
import { audit, body, getSetting, HttpError, nowIso } from '../lib/util'
import { checkOtp, maskPhone, normalizePhone, sendOtp, smsConfig } from '../lib/sms'
import { authorizeUrl, discover, exchangeCode, pkceChallenge, randomToken, ssoConfig } from '../lib/oidc'
import { homeForUser } from './auth'
import { toEnDigits } from '../../shared/fa'

export const signinRoutes = new Hono<AppEnv>()

const STATE_TTL_MS = 10 * 60_000

const safeNext = (n: unknown) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n.slice(0, 300) : null)

async function siteBase(c: Context<AppEnv>) {
  const s = String(await getSetting(c.get('db'), 'site_url', '')).trim().replace(/\/+$/, '')
  return s || new URL(c.req.url).origin
}

signinRoutes.get('/methods', async (c) => {
  const db = c.get('db')
  const sso = await ssoConfig(db)
  return c.json({ otp: !!(await smsConfig(db)), sso: sso ? { label: sso.label } : null })
})

// ───────── SMS one-time code sign-in ─────────
signinRoutes.post('/otp/send', async (c) => {
  const db = c.get('db')
  const cfg = await smsConfig(db)
  if (!cfg) throw new HttpError(400, 'ورود با پیامک فعال نیست', 'otp_off')
  const b = await body<{ phone?: string }>(c)
  const phone = normalizePhone(b.phone)
  if (!phone) throw new HttpError(400, 'شمارهٔ همراه معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹)', 'validation')
  const ipKey = `otp-send:${clientIp(c)}`
  await checkRateLimit(c, ipKey)
  await recordFailure(c, ipKey) // counts requests per IP: 8 per 15 minutes
  const u = await db.first<{ id: string; status: string }>('SELECT id, status FROM users WHERE phone = ? AND phone_verified_at IS NOT NULL AND deleted_at IS NULL', [phone])
  // unknown / inactive numbers get the same answer, so the endpoint cannot be used to discover accounts
  if (u && u.status === 'active') await sendOtp(db, cfg, phone, 'login', u.id)
  return c.json({ ok: true, sent_to: maskPhone(phone), expires_in: 300 })
})

signinRoutes.post('/otp/verify', async (c) => {
  const db = c.get('db')
  if (!(await smsConfig(db))) throw new HttpError(400, 'ورود با پیامک فعال نیست', 'otp_off')
  const b = await body<{ phone?: string; code?: string }>(c)
  const phone = normalizePhone(b.phone)
  if (!phone) throw new HttpError(400, 'شمارهٔ همراه معتبر نیست', 'validation')
  const key = `otp-login:${clientIp(c)}:${phone}`
  await checkRateLimit(c, key)
  let res: { userId: string | null }
  try {
    res = await checkOtp(db, phone, 'login', b.code)
  } catch (e) {
    await recordFailure(c, key)
    throw e
  }
  const u = await db.first<{ id: string; status: string; system_role: string; totp_enabled: number }>(
    'SELECT id, status, system_role, totp_enabled FROM users WHERE id = ? AND phone = ? AND phone_verified_at IS NOT NULL AND deleted_at IS NULL',
    [res.userId, phone]
  )
  if (!u || u.status !== 'active') throw new HttpError(403, 'حساب شما غیرفعال شده است')
  // accounts protected by an authenticator app keep their second factor: SMS alone is not enough
  if (u.totp_enabled) throw new HttpError(403, 'این حساب ورود دومرحله‌ای دارد؛ با رمز عبور و کد برنامهٔ احراز هویت وارد شوید', 'totp_account')
  await clearFailures(c, key)
  await createSession(c, u.id)
  await audit(db, u.id, 'auth.login_otp', 'user', u.id)
  const h = await homeForUser(db, u.id, u.system_role)
  return c.json({ ok: true, home: h.home, desk: h.desk })
})

// ───────── verifying the account's mobile number ─────────
signinRoutes.get('/phone', async (c) => {
  const u = requireUser(c)
  const r = await c.get('db').first<{ phone: string | null; phone_verified_at: string | null }>('SELECT phone, phone_verified_at FROM users WHERE id = ?', [u.id])
  return c.json({
    phone: r?.phone_verified_at && r.phone ? maskPhone(r.phone) : null,
    verified_at: r?.phone_verified_at || null,
    otp_available: !!(await smsConfig(c.get('db')))
  })
})

signinRoutes.post('/phone/send', async (c) => {
  const u = requireUser(c)
  const db = c.get('db')
  const cfg = await smsConfig(db)
  if (!cfg) throw new HttpError(400, 'ارسال پیامک فعال نیست', 'otp_off')
  const phone = normalizePhone((await body<{ phone?: string }>(c)).phone)
  if (!phone) throw new HttpError(400, 'شمارهٔ همراه معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹)', 'validation')
  const taken = await db.first('SELECT id FROM users WHERE phone = ? AND phone_verified_at IS NOT NULL AND id <> ? AND deleted_at IS NULL', [phone, u.id])
  if (taken) throw new HttpError(409, 'این شماره به حساب دیگری متصل است', 'phone_taken')
  const key = `phone-send:${u.id}`
  await checkRateLimit(c, key)
  await recordFailure(c, key)
  await sendOtp(db, cfg, phone, 'verify', u.id)
  return c.json({ ok: true, sent_to: maskPhone(phone), expires_in: 300 })
})

signinRoutes.post('/phone/verify', async (c) => {
  const u = requireUser(c)
  const db = c.get('db')
  const b = await body<{ phone?: string; code?: string }>(c)
  const phone = normalizePhone(b.phone)
  if (!phone) throw new HttpError(400, 'شمارهٔ همراه معتبر نیست', 'validation')
  const res = await checkOtp(db, phone, 'verify', b.code)
  if (res.userId !== u.id) throw new HttpError(400, 'کد منقضی شده است؛ کد تازه بگیرید', 'otp_expired')
  const taken = await db.first('SELECT id FROM users WHERE phone = ? AND phone_verified_at IS NOT NULL AND id <> ? AND deleted_at IS NULL', [phone, u.id])
  if (taken) throw new HttpError(409, 'این شماره به حساب دیگری متصل است', 'phone_taken')
  // verifying the number is an explicit act of the user, which also counts as consent to store it (profile, phase 15)
  await db.run('UPDATE users SET phone = ?, phone_verified_at = ?, profile_consent_at = COALESCE(profile_consent_at, ?) WHERE id = ?', [phone, nowIso(), nowIso(), u.id])
  await audit(db, u.id, 'user.phone_verified', 'user', u.id)
  return c.json({ ok: true, phone: maskPhone(phone) })
})

signinRoutes.delete('/phone', async (c) => {
  const u = requireUser(c)
  await c.get('db').run('UPDATE users SET phone_verified_at = NULL WHERE id = ?', [u.id])
  return c.json({ ok: true })
})

// ───────── university SSO (OpenID Connect) ─────────
function ssoFail(c: Context<AppEnv>, code: string) {
  return c.redirect(`/login?sso_error=${encodeURIComponent(code)}`, 302)
}

signinRoutes.get('/sso/start', async (c) => {
  const db = c.get('db')
  const cfg = await ssoConfig(db)
  if (!cfg) return ssoFail(c, 'sso_off')
  const link = c.req.query('link') === '1'
  const user = c.get('user')
  if (link && !user) return ssoFail(c, 'login_required')
  let meta
  try {
    meta = await discover(cfg.issuer)
  } catch {
    return ssoFail(c, 'provider_unreachable')
  }
  const state = randomToken(24)
  const nonce = randomToken(16)
  const verifier = randomToken(48)
  await db.run('DELETE FROM sso_states WHERE created_at < ?', [new Date(Date.now() - STATE_TTL_MS).toISOString()])
  await db.run('INSERT INTO sso_states (state_hash, verifier, nonce, next_path, link_user_id, created_at) VALUES (?,?,?,?,?,?)', [
    await sha256(state),
    verifier,
    nonce,
    safeNext(c.req.query('next')),
    link ? user!.id : null,
    nowIso()
  ])
  const redirectUri = `${await siteBase(c)}/api/signin/sso/callback`
  return c.redirect(authorizeUrl(meta, cfg, redirectUri, state, nonce, await pkceChallenge(verifier)), 302)
})

signinRoutes.get('/sso/callback', async (c) => {
  const db = c.get('db')
  const cfg = await ssoConfig(db)
  if (!cfg) return ssoFail(c, 'sso_off')
  if (c.req.query('error')) return ssoFail(c, 'provider_denied')
  const state = c.req.query('state') || ''
  const code = c.req.query('code') || ''
  if (!state || !code) return ssoFail(c, 'bad_request')
  const sh = await sha256(state)
  const st = await db.first<{ verifier: string; nonce: string; next_path: string | null; link_user_id: string | null; created_at: string }>(
    'SELECT verifier, nonce, next_path, link_user_id, created_at FROM sso_states WHERE state_hash = ?',
    [sh]
  )
  // single use: the state row is consumed before anything else can fail
  await db.run('DELETE FROM sso_states WHERE state_hash = ?', [sh])
  if (!st || Date.now() - new Date(st.created_at).getTime() > STATE_TTL_MS) return ssoFail(c, 'state_invalid')
  let claims: Record<string, any>
  try {
    const meta = await discover(cfg.issuer)
    claims = await exchangeCode(meta, cfg, `${await siteBase(c)}/api/signin/sso/callback`, code, st.verifier, st.nonce)
  } catch (e: any) {
    console.warn(JSON.stringify({ level: 'warn', msg: 'sso_failed', reason: String(e?.message || e).slice(0, 60) }))
    return ssoFail(c, 'token_invalid')
  }
  const issuer = cfg.issuer
  const sub = String(claims.sub)
  const email = typeof claims.email === 'string' && claims.email_verified !== false ? claims.email.slice(0, 120).toLowerCase() : null
  const now = nowIso()

  // linking from account settings: attach this identity to the signed-in account
  if (st.link_user_id) {
    const other = await db.first<{ user_id: string }>('SELECT user_id FROM sso_identities WHERE issuer = ? AND subject = ?', [issuer, sub])
    if (other && other.user_id !== st.link_user_id) return c.redirect('/settings?sso=taken', 302)
    if (!other) await db.run('INSERT INTO sso_identities (issuer, subject, user_id, email, created_at) VALUES (?,?,?,?,?)', [issuer, sub, st.link_user_id, email, now])
    await audit(db, st.link_user_id, 'user.sso_linked', 'user', st.link_user_id)
    return c.redirect('/settings?sso=linked', 302)
  }

  let userId = (await db.first<{ user_id: string }>('SELECT user_id FROM sso_identities WHERE issuer = ? AND subject = ?', [issuer, sub]))?.user_id || null
  if (!userId) {
    // first SSO sign-in: match the student number the university vouches for
    const sn = toEnDigits(String(claims[cfg.studentClaim] ?? '')).trim()
    if (/^\d{6,14}$/.test(sn)) {
      const existing = await db.first<{ id: string; system_role: string }>('SELECT id, system_role FROM users WHERE student_number = ? AND deleted_at IS NULL', [sn])
      // staff accounts are never taken over by SSO automatically; they link from their own settings
      if (existing && existing.system_role === 'student') userId = existing.id
      else if (existing) return ssoFail(c, 'link_from_settings')
      else if (cfg.autoCreate) {
        userId = newId()
        const name = String(claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(' ') || sn).slice(0, 80)
        await db.run(
          `INSERT INTO users (id, username, student_number, display_name, password_hash, system_role, email, created_at)
           VALUES (?,?,?,?,?, 'student', ?, ?)`,
          // random unusable password: the account signs in with SSO (or sets a password via recovery later)
          [userId, sn, sn, name, await hashPassword(randomId(40)), email, now]
        )
        await audit(db, userId, 'user.created_sso', 'user', userId)
      } else return ssoFail(c, 'no_account')
    } else return ssoFail(c, 'no_account')
    await db.run('INSERT INTO sso_identities (issuer, subject, user_id, email, created_at) VALUES (?,?,?,?,?)', [issuer, sub, userId, email, now])
  }
  const u = await db.first<{ id: string; status: string; system_role: string; deleted_at: string | null }>('SELECT id, status, system_role, deleted_at FROM users WHERE id = ?', [userId])
  if (!u || u.deleted_at || u.status !== 'active') return ssoFail(c, 'account_inactive')
  await db.run('UPDATE sso_identities SET last_login_at = ? WHERE issuer = ? AND subject = ?', [now, issuer, sub])
  await createSession(c, u.id)
  await audit(db, u.id, 'auth.login_sso', 'user', u.id)
  const h = await homeForUser(db, u.id, u.system_role)
  return c.redirect(st.next_path || h.home, 302)
})

signinRoutes.get('/sso/identities', async (c) => {
  const u = requireUser(c)
  const db = c.get('db')
  const cfg = await ssoConfig(db)
  const rows = await db.all<{ issuer: string; email: string | null; created_at: string; last_login_at: string | null }>(
    'SELECT issuer, email, created_at, last_login_at FROM sso_identities WHERE user_id = ? ORDER BY created_at',
    [u.id]
  )
  return c.json({ available: !!cfg, label: cfg?.label || null, identities: rows })
})

signinRoutes.delete('/sso/identities', async (c) => {
  const u = requireUser(c)
  const db = c.get('db')
  await db.run('DELETE FROM sso_identities WHERE user_id = ?', [u.id])
  await audit(db, u.id, 'user.sso_unlinked', 'user', u.id)
  return c.json({ ok: true })
})

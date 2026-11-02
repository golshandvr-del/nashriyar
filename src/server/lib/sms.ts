// SMS one-time codes (ROADMAP phase 19): sign-in with a verified mobile number, and verifying that number.
// SmsProvider behind one interface so the operator can plug any Iranian SMS panel:
//  - http:      POST {sms_api_url} JSON {to, text, sender} with `Authorization: Bearer {sms_api_key}` (generic gateway)
//  - kavenegar: GET  {sms_api_url|https://api.kavenegar.com}/v1/{key}/verify/lookup.json?receptor&token&template
//  - off (default): no provider; OTP sign-in is hidden.
// Only sha256(code) is stored; a code lives 5 minutes, allows 5 guesses, and a number gets at most one code per
// minute and 5 per hour. Nothing here logs a code or a full phone number.
import type { Db } from '../adapters/db'
import { newId, sha256, timingSafeEqual } from './crypto'
import { getSetting, HttpError, nowIso } from './util'
import { toEnDigits } from '../../shared/fa'

export type OtpPurpose = 'login' | 'verify'

export interface SmsConfig {
  provider: 'http' | 'kavenegar'
  url: string
  key: string
  sender: string
  template: string
}

export interface SmsProvider {
  send(to: string, code: string, text: string): Promise<void>
}

const OTP_TTL_MS = 5 * 60_000
const MAX_GUESSES = 5
const MIN_GAP_MS = 60_000
const MAX_PER_HOUR = 5

/** Iranian mobile in canonical 09xxxxxxxxx form (accepts +98 / 0098 / 98 prefixes and Persian digits), else null. */
export function normalizePhone(v: unknown): string | null {
  let p = toEnDigits(String(v ?? '')).replace(/[\s\-()]/g, '')
  if (p.startsWith('+98')) p = '0' + p.slice(3)
  else if (p.startsWith('0098')) p = '0' + p.slice(4)
  else if (/^98\d{10}$/.test(p)) p = '0' + p.slice(2)
  else if (/^9\d{9}$/.test(p)) p = '0' + p
  return /^09\d{9}$/.test(p) ? p : null
}

/** 0912***4567 — for messages and logs. */
export const maskPhone = (p: string) => (p.length === 11 ? `${p.slice(0, 4)}***${p.slice(-4)}` : '***')

export async function smsConfig(db: Db): Promise<SmsConfig | null> {
  const provider = String(await getSetting(db, 'sms_provider', 'off'))
  const key = String(await getSetting(db, 'sms_api_key', '')).trim()
  if ((provider !== 'http' && provider !== 'kavenegar') || !key) return null
  const url = String(await getSetting(db, 'sms_api_url', '')).trim().replace(/\/+$/, '')
  if (provider === 'http' && !url) return null
  return {
    provider,
    url: url || 'https://api.kavenegar.com',
    key,
    sender: String(await getSetting(db, 'sms_sender', '')).trim(),
    template: String(await getSetting(db, 'sms_template', '')).trim()
  }
}

export function smsProvider(cfg: SmsConfig): SmsProvider {
  const signal = () => AbortSignal.timeout(10_000)
  if (cfg.provider === 'kavenegar')
    return {
      async send(to, code, text) {
        const q = cfg.template ? new URLSearchParams({ receptor: to, token: code, template: cfg.template }) : new URLSearchParams({ receptor: to, message: text, ...(cfg.sender ? { sender: cfg.sender } : {}) })
        const path = cfg.template ? 'verify/lookup.json' : 'sms/send.json'
        const res = await fetch(`${cfg.url}/v1/${encodeURIComponent(cfg.key)}/${path}?${q}`, { signal: signal() })
        if (!res.ok) throw new Error(`sms_http_${res.status}`)
      }
    }
  return {
    async send(to, _code, text) {
      const res = await fetch(cfg.url, {
        method: 'POST',
        signal: signal(),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify({ to, text, sender: cfg.sender || undefined })
      })
      if (!res.ok) throw new Error(`sms_http_${res.status}`)
    }
  }
}

const otpHash = (phone: string, purpose: OtpPurpose, code: string) => sha256(`otp|${purpose}|${phone}|${code}`)

function newOtp(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000
  return String(n).padStart(6, '0')
}

/** Issues and sends a code. Throws 429 when the number asked too often, 502 when the provider failed. */
export async function sendOtp(db: Db, cfg: SmsConfig, phone: string, purpose: OtpPurpose, userId: string | null): Promise<void> {
  const now = Date.now()
  const recent = await db.all<{ created_at: string }>('SELECT created_at FROM sms_otps WHERE phone = ? AND purpose = ? AND created_at > ? ORDER BY created_at DESC', [
    phone,
    purpose,
    new Date(now - 3600_000).toISOString()
  ])
  if (recent.length >= MAX_PER_HOUR || (recent[0] && now - new Date(recent[0].created_at).getTime() < MIN_GAP_MS))
    throw new HttpError(429, 'برای این شماره به‌تازگی کد فرستاده شده است؛ کمی بعد دوباره تلاش کنید', 'otp_rate_limited')
  const code = newOtp()
  const site = String(await getSetting(db, 'site_name', 'نشریار'))
  const text = purpose === 'login' ? `کد ورود ${site}: ${code}\nاین کد را به کسی ندهید.` : `کد تأیید شمارهٔ همراه در ${site}: ${code}`
  // the row is written first so a slow provider cannot be raced into sending two codes
  await db.run('UPDATE sms_otps SET used_at = ? WHERE phone = ? AND purpose = ? AND used_at IS NULL', [nowIso(), phone, purpose])
  await db.run('INSERT INTO sms_otps (id, phone, purpose, user_id, code_hash, attempts, expires_at, created_at) VALUES (?,?,?,?,?,0,?,?)', [
    newId(),
    phone,
    purpose,
    userId,
    await otpHash(phone, purpose, code),
    new Date(now + OTP_TTL_MS).toISOString(),
    new Date(now).toISOString()
  ])
  try {
    await smsProvider(cfg).send(phone, code, text)
  } catch {
    throw new HttpError(502, 'ارسال پیامک ممکن نشد؛ کمی بعد دوباره تلاش کنید', 'sms_failed')
  }
}

/** Checks a code; on success marks it used and returns the user id it was issued for (may be null). */
export async function checkOtp(db: Db, phone: string, purpose: OtpPurpose, code: unknown): Promise<{ userId: string | null }> {
  const c = toEnDigits(String(code ?? '')).replace(/\s/g, '')
  const row = await db.first<{ id: string; code_hash: string; attempts: number; user_id: string | null }>(
    'SELECT id, code_hash, attempts, user_id FROM sms_otps WHERE phone = ? AND purpose = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1',
    [phone, purpose, nowIso()]
  )
  if (!row || row.attempts >= MAX_GUESSES) throw new HttpError(400, 'کد منقضی شده است؛ کد تازه بگیرید', 'otp_expired')
  if (!/^\d{6}$/.test(c) || !timingSafeEqual(await otpHash(phone, purpose, c), row.code_hash)) {
    await db.run('UPDATE sms_otps SET attempts = attempts + 1 WHERE id = ?', [row.id])
    throw new HttpError(400, 'کد واردشده نادرست است', 'otp_invalid')
  }
  await db.run('UPDATE sms_otps SET used_at = ? WHERE id = ?', [nowIso(), row.id])
  return { userId: row.user_id }
}

/** Maintenance: drop codes older than a day. */
export async function purgeOtps(db: Db): Promise<number> {
  try {
    return (await db.run('DELETE FROM sms_otps WHERE created_at < ?', [new Date(Date.now() - 86400_000).toISOString()])).changes
  } catch {
    return 0
  }
}

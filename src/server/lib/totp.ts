// TOTP (RFC 6238 / RFC 4226) on Web Crypto — works on Workers and Node >= 20.
// 6 digits, 30-second steps, HMAC-SHA1 (what every authenticator app supports by default).

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const TOTP_STEP = 30

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Uint8Array {
  const clean = String(s || '').toUpperCase().replace(/[^A-Z2-7]/g, '')
  const out: number[] = []
  let bits = 0
  let value = 0
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

/** 160-bit random secret, base32 encoded (32 chars). */
export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)))
}

export async function totpAt(secret: string, step: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', base32Decode(secret) as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const msg = new Uint8Array(8)
  let x = step
  for (let i = 7; i >= 0; i--) {
    msg[i] = x & 255
    x = Math.floor(x / 256)
  }
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg))
  const off = h[h.length - 1] & 15
  const bin = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]
  return String(bin % 1_000_000).padStart(6, '0')
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / TOTP_STEP)

/**
 * Verify a 6-digit code allowing ±1 step of clock drift. Returns the matched step, or null.
 * Steps <= lastStep are rejected so the same code cannot be used twice (replay protection).
 */
export async function verifyTotp(secret: string, code: string, lastStep?: number | null, now = Date.now()): Promise<number | null> {
  const c = String(code || '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/\D/g, '')
  if (c.length !== 6 || !secret) return null
  const cur = currentStep(now)
  for (const s of [cur, cur - 1, cur + 1]) {
    if (lastStep != null && s <= lastStep) continue
    if ((await totpAt(secret, s)) === c) return s
  }
  return null
}

export function otpauthUri(secret: string, account: string, issuer = 'نشریار'): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_STEP}`
}

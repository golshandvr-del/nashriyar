// Runtime-neutral crypto helpers built on Web Crypto (works on Workers and Node >= 20).

const enc = new TextEncoder()

export function randomId(len = 16): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  let s = ''
  for (const b of bytes) s += alphabet[b % alphabet.length]
  return s
}

/** Time-sortable id: base36 timestamp + random suffix. */
export function newId(): string {
  return Date.now().toString(36).padStart(9, '0') + randomId(8)
}

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16)
  return out
}

export async function sha256(s: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
}

export async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(data)))
}

const PBKDF2_ITER = 100_000 // Cloudflare Workers maximum

/** Format: pbkdf2$<iter>$<saltHex>$<hashHex> — algorithm is upgradeable. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER }, key, 256)
  return `pbkdf2$${PBKDF2_ITER}$${toHex(salt)}$${toHex(bits)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iterStr, saltHex, hashHex] = String(stored).split('$')
  if (algo !== 'pbkdf2') return false
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex) as BufferSource, iterations: Number(iterStr) },
    key,
    256
  )
  return timingSafeEqual(toHex(bits), hashHex)
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

/** Human-friendly purchase code, e.g. NSH-7KQ2-M9XA (no ambiguous chars). */
export function generatePurchaseCode(): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
  return `NSH-${chars.slice(0, 4)}-${chars.slice(4)}`
}

export function normalizePurchaseCode(input: string): string {
  const fa = '۰۱۲۳۴۵۶۷۸۹'
  return String(input || '')
    .replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)))
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/^NSH/, '')
}

export function tempPassword(): string {
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz'
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

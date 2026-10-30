import { hmac, timingSafeEqual } from './crypto'

/**
 * Short-lived signed URLs for PAID supplementary media (ROADMAP phase 5: «پخش امن صوت/ویدیوی پولی با لینک کوتاه‌مدت»).
 * The signature binds storage key + expiry + the viewer's session, so a copied link stops working after
 * MEDIA_URL_TTL_SEC and never works from another session. Entitlement is still re-checked on every request.
 */
export const MEDIA_URL_TTL_SEC = 60 * 60 // long enough for a full podcast episode with range requests

async function sig(secret: string, key: string, exp: number, sessionId: string): Promise<string> {
  return (await hmac(secret, `media|${key}|${exp}|${sessionId.slice(0, 32)}`)).slice(0, 40)
}

export async function signedMediaUrl(secret: string, key: string, sessionId: string, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + MEDIA_URL_TTL_SEC
  return `/api/media/k/${key}?exp=${exp}&sig=${await sig(secret, key, exp, sessionId)}`
}

export async function verifyMediaSig(secret: string, key: string, sessionId: string | null | undefined, exp: string | undefined, s: string | undefined, now = Date.now()): Promise<boolean> {
  if (!sessionId || !exp || !s) return false
  const e = Number(exp)
  if (!Number.isFinite(e) || e < Math.floor(now / 1000)) return false
  return timingSafeEqual(await sig(secret, key, e, sessionId), s)
}

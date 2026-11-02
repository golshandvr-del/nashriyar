// Android app detection (ROADMAP phase 19 — Android shell with FLAG_SECURE, android/ in this repo).
// The app's WebView appends `NashriyarApp/<version>` to its User-Agent. When the developer console sets
// `app_client_key`, the app must also send `nsk/<token>` where token = first 16 hex chars of
// HMAC-SHA256(app_client_key, "app|YYYY-MM-DD") for today's (or yesterday's) UTC date — the key is baked into
// the APK at build time (gradle property `nashriyarAppKey`). This is a deterrent, not DRM: a determined user can
// extract the key from the APK; the real protection inside the app is FLAG_SECURE (no screenshots / recording).
import { hmac, timingSafeEqual } from './crypto'
import { getSetting } from './util'
import type { Db } from '../adapters/db'

const UA_RE = /\bNashriyarApp\/([0-9][0-9A-Za-z.-]{0,15})/
const TOKEN_RE = /\bnsk\/([0-9a-f]{16})\b/

export async function appToken(key: string, day: string): Promise<string> {
  return (await hmac(key, `app|${day}`)).slice(0, 16)
}

/** `{ app: true, version }` when the request comes from the (correctly keyed) Nashriyar Android app. */
export async function appClient(db: Db, userAgent: string | undefined | null): Promise<{ app: boolean; version: string | null }> {
  const ua = userAgent || ''
  const m = UA_RE.exec(ua)
  if (!m) return { app: false, version: null }
  const key = String((await getSetting(db, 'app_client_key', '')) || '')
  if (!key) return { app: true, version: m[1] }
  const t = TOKEN_RE.exec(ua)?.[1]
  if (!t) return { app: false, version: m[1] }
  const now = Date.now()
  for (const d of [0, -1]) {
    const day = new Date(now + d * 86_400_000).toISOString().slice(0, 10)
    if (timingSafeEqual(t, await appToken(key, day))) return { app: true, version: m[1] }
  }
  return { app: false, version: m[1] }
}

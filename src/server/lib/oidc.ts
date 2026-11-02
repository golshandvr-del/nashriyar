// University SSO over OpenID Connect (ROADMAP phase 19): authorization-code flow with PKCE (S256), state + nonce,
// and full id_token verification (RS256 / ES256 signature against the provider's JWKS, iss, aud/azp, exp, iat, nonce).
// Runtime-neutral (Web Crypto + fetch), so it works on Cloudflare Workers and Node. Configured from the developer
// console; nothing happens while `sso_issuer` / `sso_client_id` are empty.
import type { Db } from '../adapters/db'
import { getSetting } from './util'

export interface SsoConfig {
  issuer: string
  clientId: string
  clientSecret: string
  label: string
  scopes: string
  /** id_token / userinfo claim that carries the student number (e.g. `student_number`, `preferred_username`). */
  studentClaim: string
  /** Create a student account on first sign-in when no account matches. */
  autoCreate: boolean
}

export interface OidcMeta {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  userinfo_endpoint?: string
}

const enc = new TextEncoder()
const FETCH_MS = 10_000
const META_TTL_MS = 10 * 60_000
const CLOCK_SKEW_S = 120

export async function ssoConfig(db: Db): Promise<SsoConfig | null> {
  const issuer = String(await getSetting(db, 'sso_issuer', '')).trim().replace(/\/+$/, '')
  const clientId = String(await getSetting(db, 'sso_client_id', '')).trim()
  if (!/^https?:\/\//.test(issuer) || !clientId) return null
  return {
    issuer,
    clientId,
    clientSecret: String(await getSetting(db, 'sso_client_secret', '')).trim(),
    label: String(await getSetting(db, 'sso_label', '')).trim() || 'ورود با حساب دانشگاه',
    scopes: String(await getSetting(db, 'sso_scopes', '')).trim() || 'openid profile email',
    studentClaim: String(await getSetting(db, 'sso_student_claim', '')).trim() || 'student_number',
    autoCreate: (await getSetting(db, 'sso_auto_create', false)) === true
  }
}

// ───────── base64url ─────────
export function b64url(bytes: Uint8Array | ArrayBuffer): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function unb64url(s: string): Uint8Array {
  const p = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(p + '='.repeat((4 - (p.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

/** RFC 7636 S256 code challenge. */
export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(verifier)))
}

// ───────── discovery + JWKS (cached per isolate/process) ─────────
const metaCache = new Map<string, { at: number; meta: OidcMeta }>()
const jwksCache = new Map<string, { at: number; keys: any[] }>()

export async function discover(issuer: string): Promise<OidcMeta> {
  const hit = metaCache.get(issuer)
  if (hit && Date.now() - hit.at < META_TTL_MS) return hit.meta
  const res = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(FETCH_MS) })
  if (!res.ok) throw new Error(`discovery_http_${res.status}`)
  const m = (await res.json()) as OidcMeta
  if (!m?.authorization_endpoint || !m?.token_endpoint || !m?.jwks_uri) throw new Error('discovery_incomplete')
  // OIDC Discovery §4.3: the issuer in the document must equal the configured one
  if (String(m.issuer).replace(/\/+$/, '') !== issuer) throw new Error('discovery_issuer_mismatch')
  metaCache.set(issuer, { at: Date.now(), meta: m })
  return m
}

async function jwks(uri: string, force = false): Promise<any[]> {
  const hit = jwksCache.get(uri)
  if (!force && hit && Date.now() - hit.at < META_TTL_MS) return hit.keys
  const res = await fetch(uri, { signal: AbortSignal.timeout(FETCH_MS) })
  if (!res.ok) throw new Error(`jwks_http_${res.status}`)
  const j: any = await res.json()
  const keys = Array.isArray(j?.keys) ? j.keys : []
  jwksCache.set(uri, { at: Date.now(), keys })
  return keys
}

/** Test/ops helper: forget cached discovery documents and key sets (e.g. after the issuer setting changed). */
export function resetOidcCache() {
  metaCache.clear()
  jwksCache.clear()
}

const ALGS: Record<string, { kty: string; import: any; verify: any }> = {
  RS256: { kty: 'RSA', import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verify: { name: 'RSASSA-PKCS1-v1_5' } },
  ES256: { kty: 'EC', import: { name: 'ECDSA', namedCurve: 'P-256' }, verify: { name: 'ECDSA', hash: 'SHA-256' } }
}

/** Verifies a compact JWS id_token and its standard claims; returns the claims. Throws a short error code. */
export async function verifyIdToken(token: string, meta: OidcMeta, cfg: SsoConfig, nonce: string): Promise<Record<string, any>> {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) throw new Error('id_token_format')
  let header: any
  let claims: any
  try {
    header = JSON.parse(new TextDecoder().decode(unb64url(parts[0])))
    claims = JSON.parse(new TextDecoder().decode(unb64url(parts[1])))
  } catch {
    throw new Error('id_token_format')
  }
  const alg = ALGS[header?.alg]
  if (!alg) throw new Error('id_token_alg') // 'none' and HMAC algorithms are refused
  const pick = (keys: any[]) => keys.find((k) => k.kty === alg.kty && (!header.kid || k.kid === header.kid) && (!k.use || k.use === 'sig'))
  let jwk = pick(await jwks(meta.jwks_uri))
  if (!jwk) jwk = pick(await jwks(meta.jwks_uri, true)) // key rotation
  if (!jwk) throw new Error('id_token_key')
  const { kty, n, e, crv, x, y } = jwk
  const key = await crypto.subtle.importKey('jwk', { kty, n, e, crv, x, y, ext: true }, alg.import, false, ['verify'])
  const ok = await crypto.subtle.verify(alg.verify, key, unb64url(parts[2]) as BufferSource, enc.encode(`${parts[0]}.${parts[1]}`))
  if (!ok) throw new Error('id_token_signature')
  const now = Math.floor(Date.now() / 1000)
  if (String(claims.iss).replace(/\/+$/, '') !== cfg.issuer) throw new Error('id_token_iss')
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!aud.includes(cfg.clientId)) throw new Error('id_token_aud')
  if (aud.length > 1 && claims.azp && claims.azp !== cfg.clientId) throw new Error('id_token_azp')
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < now) throw new Error('id_token_expired')
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_S > now) throw new Error('id_token_iat')
  if (claims.nonce !== nonce) throw new Error('id_token_nonce')
  if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('id_token_sub')
  return claims
}

/** Builds the authorization URL (response_type=code, PKCE S256, state, nonce). */
export function authorizeUrl(meta: OidcMeta, cfg: SsoConfig, redirectUri: string, state: string, nonce: string, challenge: string): string {
  const u = new URL(meta.authorization_endpoint)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', cfg.clientId)
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('scope', cfg.scopes.includes('openid') ? cfg.scopes : `openid ${cfg.scopes}`)
  u.searchParams.set('state', state)
  u.searchParams.set('nonce', nonce)
  u.searchParams.set('code_challenge', challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  return u.toString()
}

/** Exchanges the code at the token endpoint and returns the verified id_token claims (merged with userinfo, if any). */
export async function exchangeCode(meta: OidcMeta, cfg: SsoConfig, redirectUri: string, code: string, verifier: string, nonce: string): Promise<Record<string, any>> {
  const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: cfg.clientId, code_verifier: verifier })
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }
  // confidential clients: client_secret_basic (RFC 6749 §2.3.1)
  if (cfg.clientSecret) headers.Authorization = 'Basic ' + btoa(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`)
  const res = await fetch(meta.token_endpoint, { method: 'POST', headers, body: form.toString(), signal: AbortSignal.timeout(FETCH_MS) })
  if (!res.ok) throw new Error(`token_http_${res.status}`)
  const tok: any = await res.json().catch(() => ({}))
  if (!tok?.id_token) throw new Error('token_no_id_token')
  const claims = await verifyIdToken(tok.id_token, meta, cfg, nonce)
  // optional userinfo: extra claims (e.g. the student number) — the subject must match (OIDC Core §5.3.2)
  if (meta.userinfo_endpoint && tok.access_token && !(cfg.studentClaim in claims)) {
    const ui = await fetch(meta.userinfo_endpoint, { headers: { Authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(FETCH_MS) }).catch(() => null)
    const info: any = ui && ui.ok ? await ui.json().catch(() => null) : null
    if (info && info.sub === claims.sub) for (const [k, v] of Object.entries(info)) if (!(k in claims)) claims[k] = v
  }
  return claims
}

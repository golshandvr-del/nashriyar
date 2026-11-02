// Multi-university hosting (ROADMAP phase 19 — "each university its own space on its own domain").
// Isolation model: one database + one file store per university (no shared tables, no tenant_id column to forget in
// a query). The request's Host header picks the university; everything below the entry point is unchanged.
//   Node:        DATA_DIR/tenants.json (or TENANTS_FILE) → DATA_DIR/tenants/<slug>/{nashriyar.db, files/, backups/}
//   Cloudflare:  env TENANTS (JSON) → one D1 binding (+ optional R2 binding) per university
// Without a configuration the app is single-tenant exactly as before. Runtime-agnostic (no node:* imports).

export interface TenantDef {
  /** stable id: lower-case letters, digits and dashes (folder name / binding suffix) */
  slug: string
  /** university name shown in the operator listing (the site itself uses its own settings) */
  name: string
  /** exact host names (lower-case, no port), e.g. "nashriyar.ut.ac.ir" */
  hosts: string[]
  /** Cloudflare only: D1 binding name (default `DB_<SLUG>`) */
  db?: string
  /** Cloudflare only: R2 binding name (optional) */
  bucket?: string
}

export interface TenantConfig {
  tenants: TenantDef[]
  /** slug served for a host that matches no university (e.g. health checks by IP); empty = 404 */
  default?: string
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/
const HOST_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/

/** Lower-cases a Host header value and drops the port (IPv6 literals keep their brackets). */
export function normalizeHost(h: string | null | undefined): string {
  const v = String(h || '').trim().toLowerCase()
  if (v.startsWith('[')) return v.slice(0, v.indexOf(']') + 1)
  return v.replace(/:\d+$/, '').replace(/\.$/, '')
}

/** Validates and normalises a parsed configuration; throws a readable Error on the first problem. */
export function parseTenantConfig(raw: unknown): TenantConfig {
  const obj: any = Array.isArray(raw) ? { tenants: raw } : raw
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.tenants)) throw new Error('tenants: expected { "tenants": [...] }')
  const seenSlug = new Set<string>()
  const seenHost = new Set<string>()
  const tenants: TenantDef[] = obj.tenants.map((t: any, i: number) => {
    const slug = String(t?.slug || '').trim().toLowerCase()
    if (!SLUG_RE.test(slug)) throw new Error(`tenants[${i}]: invalid slug "${slug}" (a-z, 0-9, -; 2–31 chars)`)
    if (seenSlug.has(slug)) throw new Error(`tenants: duplicate slug "${slug}"`)
    seenSlug.add(slug)
    const hosts = (Array.isArray(t.hosts) ? t.hosts : [t.host]).filter(Boolean).map((h: string) => normalizeHost(h))
    if (!hosts.length) throw new Error(`tenants[${i}] (${slug}): at least one host is required`)
    for (const h of hosts) {
      if (!HOST_RE.test(h)) throw new Error(`tenants[${i}] (${slug}): invalid host "${h}"`)
      if (seenHost.has(h)) throw new Error(`tenants: host "${h}" is assigned twice`)
      seenHost.add(h)
    }
    const def: TenantDef = { slug, name: String(t.name || slug).slice(0, 120), hosts }
    if (t.db) def.db = String(t.db)
    if (t.bucket) def.bucket = String(t.bucket)
    return def
  })
  const dflt = obj.default ? String(obj.default).toLowerCase() : undefined
  if (dflt && !seenSlug.has(dflt)) throw new Error(`tenants: default "${dflt}" is not a configured slug`)
  return { tenants, ...(dflt ? { default: dflt } : {}) }
}

/** The university serving `host`, the default one for unknown hosts, or null (→ 404). */
export function resolveTenant(cfg: TenantConfig, host: string | null | undefined): TenantDef | null {
  const h = normalizeHost(host)
  const hit = cfg.tenants.find((t) => t.hosts.includes(h))
  if (hit) return hit
  return cfg.default ? cfg.tenants.find((t) => t.slug === cfg.default) || null : null
}

/** Per-university signing secret when one APP_SECRET is shared by the whole server (never the same across sites). */
export function tenantSecret(envSecret: string | undefined, slug: string): string | undefined {
  return envSecret && envSecret.length >= 16 ? `${envSecret}:tenant:${slug}` : undefined
}

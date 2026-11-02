// Cloudflare Pages (advanced mode) entry -> bundled to dist/_worker.js by scripts/build-server.mjs.
// /api/* is handled by the Hono app; everything else is served from static assets with SPA fallback.
import { createApp } from '../server/app'
import { d1Db } from '../server/adapters/db'
import { memoryStorage, r2Storage } from '../server/adapters/storage'
import type { Deps } from '../server/context'
import { resolveSecret } from '../server/secret'
import { parseTenantConfig, resolveTenant, tenantSecret, type TenantConfig, type TenantDef } from '../server/tenancy'
import { HttpError } from '../server/lib/util'

interface Env {
  DB: any
  BUCKET?: any
  ASSETS: { fetch: (req: Request) => Promise<Response> }
  APP_SECRET?: string
  AI_BASE_URL?: string
  AI_API_KEY?: string
  AI_MODEL?: string
  /**
   * ROADMAP phase 19 multi-university: JSON `{ "tenants": [{ "slug", "name", "hosts": [...], "db"?, "bucket"? }], "default"? }`.
   * Each university has its own D1 binding (default `DB_<SLUG>` with dashes as underscores) and optional R2 binding.
   * Unset = single tenant (DB / BUCKET) exactly as before.
   */
  TENANTS?: string
  [binding: string]: any
}

const cache = new Map<string, Deps>()
const fallbackStorage = new Map<string, ReturnType<typeof memoryStorage>>()
let tenantCfg: { raw: string; cfg: TenantConfig } | null = null

function tenantsOf(env: Env): TenantConfig | null {
  if (!env.TENANTS) return null
  if (tenantCfg?.raw !== env.TENANTS) tenantCfg = { raw: env.TENANTS, cfg: parseTenantConfig(JSON.parse(env.TENANTS)) }
  return tenantCfg.cfg
}

const bindingName = (t: TenantDef) => t.db || `DB_${t.slug.toUpperCase().replace(/-/g, '_')}`

/** The university of this request (null = single-tenant install); throws 404 for a host of no university. */
function tenantFor(env: Env, host: string | null | undefined): TenantDef | null {
  const cfg = tenantsOf(env)
  if (!cfg) return null
  const t = resolveTenant(cfg, host)
  if (!t) throw new HttpError(404, 'این دامنه به هیچ دانشگاهی متصل نیست', 'unknown_host')
  return t
}

async function depsFor(env: Env, t: TenantDef | null): Promise<Deps> {
  const key = t ? t.slug : ''
  const hit = cache.get(key)
  if (hit) return hit
  const d1 = t ? env[bindingName(t)] : env.DB
  if (!d1) throw new HttpError(500, `پایگاه دادهٔ دانشگاه «${t?.slug}» پیکربندی نشده است (binding ${t ? bindingName(t) : 'DB'})`, 'tenant_db_missing')
  const bucket = t ? (t.bucket ? env[t.bucket] : undefined) : env.BUCKET
  if (!bucket && !fallbackStorage.has(key)) fallbackStorage.set(key, memoryStorage())
  const db = d1Db(d1)
  const deps: Deps = {
    db,
    storage: bucket ? r2Storage(bucket) : fallbackStorage.get(key)!,
    secret: await resolveSecret(db, t ? tenantSecret(env.APP_SECRET, t.slug) : env.APP_SECRET),
    ai: { baseUrl: env.AI_BASE_URL, apiKey: env.AI_API_KEY, model: env.AI_MODEL }
  }
  cache.set(key, deps)
  return deps
}

const app = createApp(async (c) => depsFor(c.env as Env, tenantFor(c.env as Env, c.req.header('host'))))

export default {
  async fetch(req: Request, env: Env, ctx: any): Promise<Response> {
    const url = new URL(req.url)
    // multi-university: a host of no university gets a plain 404 (static assets included)
    if (env.TENANTS) {
      try {
        tenantFor(env, req.headers.get('host'))
      } catch {
        return new Response('unknown host', { status: 404 })
      }
    }
    // /a/<pid>: server-rendered article landing page (ROADMAP phase 19)
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/a/') || url.pathname === '/robots.txt') return app.fetch(req, env, ctx)
    const res = await env.ASSETS.fetch(req)
    // SPA fallback: unknown non-file paths render index.html (client-side routing)
    if (res.status === 404 && req.method === 'GET' && !/\.[a-z0-9]{2,5}$/i.test(url.pathname)) {
      const idx = await env.ASSETS.fetch(new Request(new URL('/index.html', url).toString(), req))
      return new Response(idx.body, { status: 200, headers: idx.headers })
    }
    return res
  }
}

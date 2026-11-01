import { Hono } from 'hono'
import type { AppEnv, Deps } from './context'
import { csrfGuard, loadSession } from './auth'
import { ensureMigrated } from './migrate'
import { HttpError, getSetting } from './lib/util'
import { validationError, z } from './lib/validate'
import { getMonitorStats, recordError, recordRequest } from './lib/monitor'
import { bumpCache, writeDomains } from './lib/rollup'
import { authRoutes } from './routes/auth'
import { publicRoutes } from './routes/public'
import { meRoutes } from './routes/me'
import { readerRoutes } from './routes/reader'
import { teamRoutes } from './routes/team'
import { adminRoutes } from './routes/admin'
import { analyticsRoutes } from './routes/analytics'
import { mediaRoutes } from './routes/media'
import { systemRoutes } from './routes/system'
import { festivalRoutes } from './routes/festivals'
import { membershipRoutes } from './routes/membership'
import { deskRoutes } from './routes/desk'
import { openRoutes } from './routes/open'
import { articlePage, articleRoutes } from './routes/articles'

const SLOW_MS = 1000
/**
 * API versioning (ROADMAP phase 17, docs/API_VERSIONING.md): the current contract is v1. Every route is served both at
 * /api/<x> (unversioned alias = latest) and /api/v1/<x>; responses carry X-API-Version. Changes inside v1 are additive
 * only; a breaking change ships as /api/v2 while v1 keeps working for at least one academic year.
 */
export const API_VERSION = '1'
/** Strip the optional version segment so path-based checks (maintenance, logs) treat /api/v1/x like /api/x. */
export const apiPath = (p: string) => p.replace(/^\/api\/v\d+(?=\/)/, '/api')
const LOG_ALL = typeof process !== 'undefined' && (process as any).env?.LOG_REQUESTS === '1'

/** One JSON object per line (ROADMAP phase 17 structured logging) — easy to grep, ship or parse. No personal data. */
export function logLine(level: 'info' | 'warn' | 'error', fields: Record<string, unknown>) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, app: 'nashriyar', ...fields })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}
/** Ids and long numbers (student numbers, codes) are not written to the log verbatim. */
export const scrubLogPath = (p: string) => p.replace(/\b\d{6,}\b/g, ':n').slice(0, 160)

export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "manifest-src 'self'"
].join('; ')

/**
 * Builds the API application. `getDeps` is called per request so the Cloudflare entry can build
 * deps from `env` bindings, while the Node entry returns a singleton.
 */
export function createApp(getDeps: (c: any) => Deps | Promise<Deps>) {
  const app = new Hono<AppEnv>()

  // ROADMAP phase 17: every request gets an id (a sane incoming X-Request-Id from a proxy is kept), echoed in the
  // X-Request-Id response header and in every error body, so a user's report can be matched to the log line.
  app.use('*', async (c, next) => {
    const incoming = c.req.header('x-request-id') || ''
    c.set('requestId', /^[A-Za-z0-9._:-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID())
    await next()
    c.header('X-Request-Id', c.get('requestId'))
    if (c.req.path.startsWith('/api/')) c.header('X-API-Version', API_VERSION)
  })

  app.onError((raw, c) => {
    const request_id = c.get('requestId')
    const path = new URL(c.req.url).pathname
    // a schema `.parse()` that escaped a route → the same 400 shape as parseBody/str/int (ROADMAP phase 17)
    const err = raw instanceof z.ZodError ? validationError(raw) : raw
    if (err instanceof HttpError) {
      if (err.status >= 500) {
        recordError(c.req.method, path, err.status, err)
        logLine('error', { request_id, method: c.req.method, path: scrubLogPath(path), status: err.status, msg: err.message })
      }
      return c.json({ error: err.message, code: err.code, ...(err.details || {}), request_id }, err.status as any)
    }
    recordError(c.req.method, path, 500, err)
    logLine('error', { request_id, method: c.req.method, path: scrubLogPath(path), status: 500, msg: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack?.split('\n').slice(0, 4).join(' | ') : undefined })
    return c.json({ error: 'خطای داخلی سرور', request_id }, 500)
  })

  // security headers for every response produced by the app
  app.use('*', async (c, next) => {
    await next()
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'same-origin')
    c.header('X-Frame-Options', 'DENY')
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    // Same policy as public/_headers (Cloudflare Pages); here it also covers the self-hosted Node server's static files.
    if (!c.res.headers.has('Content-Security-Policy')) c.header('Content-Security-Policy', CSP)
  })

  // robots.txt is dynamic so the Sitemap line carries the real (absolute) origin on any domain.
  app.get('/robots.txt', (c) => {
    const origin = new URL(c.req.url).origin
    const body = [
      'User-agent: *',
      'Allow: /api/public/sitemap.xml',
      'Disallow: /api/',
      'Disallow: /admin',
      'Disallow: /team',
      'Disallow: /read/',
      'Disallow: /library',
      'Disallow: /settings',
      'Disallow: /notifications',
      'Disallow: /redeem',
      '',
      `Sitemap: ${origin}/api/public/sitemap.xml`,
      ''
    ].join('\n')
    return c.body(body, 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' })
  })

  app.use('/api/*', async (c, next) => {
    const t0 = Date.now()
    const deps = await getDeps(c)
    c.set('deps', deps)
    c.set('db', deps.db)
    await ensureMigrated(deps.db)
    c.header('Cache-Control', 'no-store')
    await next()
    const ms = Date.now() - t0
    const status = c.res.status || 200
    const path = new URL(c.req.url).pathname
    // ROADMAP phase 17: targeted analytics-cache invalidation — a successful write bumps only the data domains it touches
    if (status < 400 && c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const domains = writeDomains(c.req.method, path)
      if (domains.length) await bumpCache(deps.db, domains).catch(() => {})
    }
    recordRequest(c.req.method, path, status, ms)
    // structured access log: slow requests and client/server errors always; every request when LOG_REQUESTS=1
    if (status >= 400 || ms >= SLOW_MS || LOG_ALL) logLine(status >= 500 ? 'error' : status >= 400 || ms >= SLOW_MS ? 'warn' : 'info', { request_id: c.get('requestId'), method: c.req.method, path: scrubLogPath(path), status, ms, user: c.get('user')?.id || null })
  })
  app.use('/api/*', csrfGuard)
  app.use('/api/*', loadSession)

  // Maintenance mode (ROADMAP phase 13, toggled from /system/settings). While on, every write is refused with 503
  // except login/logout (/api/auth/*), the developer console itself and anything done by the developer account.
  // Reads stay available so the client can show the maintenance page; the flag is cached briefly per isolate.
  let maint: { at: number; v: { on: boolean; message: string } } | null = null
  const maintenance = async (c: any) => {
    if (maint && Date.now() - maint.at < 10_000) return maint.v
    const v = await getSetting(c.get('db'), 'maintenance_mode', { on: false, message: '' })
    maint = { at: Date.now(), v: { on: v?.on === true, message: typeof v?.message === 'string' ? v.message : '' } }
    return maint.v
  }
  app.use('/api/*', async (c, next) => {
    const path = apiPath(new URL(c.req.url).pathname)
    if (path.startsWith('/api/system/settings') && c.req.method === 'POST') maint = null
    if (c.req.method === 'GET' || c.req.method === 'HEAD' || path.startsWith('/api/auth/') || path.startsWith('/api/system/')) return next()
    if (c.get('user')?.system_role === 'developer') return next()
    const m = await maintenance(c)
    if (m.on) throw new HttpError(503, m.message || 'سامانه در حال تعمیرات است؛ کمی بعد دوباره تلاش کنید', 'maintenance')
    await next()
  })
  const maintenanceHandler = async (c: any) => {
    const m = await maintenance(c)
    return c.json({ on: m.on, message: m.on ? m.message : '' })
  }
  app.get('/api/maintenance', maintenanceHandler)
  app.get('/api/v1/maintenance', maintenanceHandler)

  // Liveness + readiness (/api/health and /healthz, ROADMAP phase 11): probes DB, disk warning and response-time summary.
  const healthHandler = async (c: any) => {
    const started = Date.now()
    try {
      const deps = c.get('deps') || (await getDeps(c))
      await ensureMigrated(deps.db)
      await deps.db.first('SELECT 1 AS ok')
      const disk = deps.disk?.() ?? null
      const mon = getMonitorStats()
      return c.json({
        ok: true,
        db: 'ok',
        latency_ms: Date.now() - started,
        disk: disk ? { used_pct: disk.used_pct, free_bytes: disk.free_bytes, warn: disk.warn } : null,
        requests: { total: mon.requests_total, errors_5xx: mon.errors_5xx, avg_ms: mon.latency_ms.avg, p95_ms: mon.latency_ms.p95 },
        time: new Date().toISOString()
      })
    } catch {
      return c.json({ ok: false, db: 'error', time: new Date().toISOString() }, 503)
    }
  }
  app.get('/healthz', healthHandler)
  // ROADMAP phase 19: permanent, server-rendered article landing page (citation_* meta for Google Scholar & co.)
  app.get('/a/:pid', async (c) => {
    const deps = await getDeps(c)
    c.set('deps', deps)
    c.set('db', deps.db)
    await ensureMigrated(deps.db)
    return articlePage(c)
  })
  app.get('/api/health', healthHandler)
  app.get('/api/v1/health', healthHandler)
  const modules = {
    auth: authRoutes,
    public: publicRoutes,
    me: meRoutes,
    reader: readerRoutes,
    team: teamRoutes,
    admin: adminRoutes,
    analytics: analyticsRoutes,
    media: mediaRoutes,
    system: systemRoutes,
    festivals: festivalRoutes,
    membership: membershipRoutes,
    desk: deskRoutes,
    // ROADMAP phase 19: read-only public API for other university systems (API key, CORS, per-key rate limit)
    open: openRoutes,
    // ROADMAP phase 19: article index with persistent ids (JSON, BibTeX, RIS, OAI-PMH) — public metadata only
    articles: articleRoutes
  }
  // every module at the unversioned alias and at the explicit v1 prefix (same handlers, same contract)
  for (const [name, routes] of Object.entries(modules)) {
    app.route(`/api/${name}`, routes)
    app.route(`/api/v${API_VERSION}/${name}`, routes)
  }

  app.all('/api/*', (c) => c.json({ error: 'مسیر یافت نشد', code: 'not_found', request_id: c.get('requestId') }, 404))
  return app
}

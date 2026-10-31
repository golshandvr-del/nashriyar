import { Hono } from 'hono'
import type { AppEnv, Deps } from './context'
import { csrfGuard, loadSession } from './auth'
import { ensureMigrated } from './migrate'
import { HttpError } from './lib/util'
import { getMonitorStats, recordError, recordRequest } from './lib/monitor'
import { authRoutes } from './routes/auth'
import { publicRoutes } from './routes/public'
import { meRoutes } from './routes/me'
import { readerRoutes } from './routes/reader'
import { teamRoutes } from './routes/team'
import { adminRoutes } from './routes/admin'
import { analyticsRoutes } from './routes/analytics'
import { mediaRoutes } from './routes/media'
import { systemRoutes } from './routes/system'

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

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      if (err.status >= 500) recordError(c.req.method, new URL(c.req.url).pathname, err.status, err)
      return c.json({ error: err.message, code: err.code }, err.status as any)
    }
    recordError(c.req.method, new URL(c.req.url).pathname, 500, err)
    console.error('[nashriyar] unhandled error', err)
    return c.json({ error: 'خطای داخلی سرور' }, 500)
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
    recordRequest(c.req.method, new URL(c.req.url).pathname, c.res.status || 200, Date.now() - t0)
  })
  app.use('/api/*', csrfGuard)
  app.use('/api/*', loadSession)

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
  app.get('/api/health', healthHandler)
  app.route('/api/auth', authRoutes)
  app.route('/api/public', publicRoutes)
  app.route('/api/me', meRoutes)
  app.route('/api/reader', readerRoutes)
  app.route('/api/team', teamRoutes)
  app.route('/api/admin', adminRoutes)
  app.route('/api/analytics', analyticsRoutes)
  app.route('/api/media', mediaRoutes)
  app.route('/api/system', systemRoutes)

  app.all('/api/*', (c) => c.json({ error: 'مسیر یافت نشد' }, 404))
  return app
}

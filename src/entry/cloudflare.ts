// Cloudflare Pages (advanced mode) entry -> bundled to dist/_worker.js by scripts/build-server.mjs.
// /api/* is handled by the Hono app; everything else is served from static assets with SPA fallback.
import { createApp } from '../server/app'
import { d1Db } from '../server/adapters/db'
import { memoryStorage, r2Storage } from '../server/adapters/storage'
import type { Deps } from '../server/context'
import { resolveSecret } from '../server/secret'

interface Env {
  DB: any
  BUCKET?: any
  ASSETS: { fetch: (req: Request) => Promise<Response> }
  APP_SECRET?: string
  AI_BASE_URL?: string
  AI_API_KEY?: string
  AI_MODEL?: string
}

let cached: Deps | null = null
const fallbackStorage = memoryStorage()

const app = createApp(async (c) => {
  const env = c.env as Env
  if (cached) return cached
  const db = d1Db(env.DB)
  cached = {
    db,
    storage: env.BUCKET ? r2Storage(env.BUCKET) : fallbackStorage,
    secret: await resolveSecret(db, env.APP_SECRET),
    ai: { baseUrl: env.AI_BASE_URL, apiKey: env.AI_API_KEY, model: env.AI_MODEL }
  }
  return cached
})

export default {
  async fetch(req: Request, env: Env, ctx: any): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname.startsWith('/api/') || url.pathname === '/robots.txt') return app.fetch(req, env, ctx)
    const res = await env.ASSETS.fetch(req)
    // SPA fallback: unknown non-file paths render index.html (client-side routing)
    if (res.status === 404 && req.method === 'GET' && !/\.[a-z0-9]{2,5}$/i.test(url.pathname)) {
      const idx = await env.ASSETS.fetch(new Request(new URL('/index.html', url).toString(), req))
      return new Response(idx.body, { status: 200, headers: idx.headers })
    }
    return res
  }
}

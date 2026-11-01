// Read-only public API for other university systems (ROADMAP phase 19) — /api/open/* (and /api/v1/open/*).
// - GET only; every other method → 405. CORS is open (`*`) because callers authenticate with a key, never a cookie.
// - Every endpoint except /openapi.json needs an API key (`X-API-Key` header or `?api_key=`), created in the developer
//   console (/api/system/api-keys). Only the SHA-256 of a key is stored; revoked keys → 401.
// - Per-key rate limit (requests per minute, set per key) → 429 with Retry-After.
// - Only data that is already public on the storefront is exposed: active publications, published issues, their TOC
//   with bylines, faculties and categories. Never follower/view counts (docs/ROLES.md rule 2), never personal data,
//   never paid content (page images / PDFs). Lists use keyset pagination (?cursor, ?limit ≤ 200).
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import type { AppEnv } from '../context'
import { sha256 } from '../lib/crypto'
import { HttpError, cursorPage, notFound, nowIso } from '../lib/util'
import { normalizeFa } from '../../shared/fa'

export const openRoutes = new Hono<AppEnv>()

const SQL_NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`
const PUBLISHED = `i.status IN ('published','archived') AND i.published_at <= ${SQL_NOW} AND i.deleted_at IS NULL AND p.status = 'active' AND p.deleted_at IS NULL`

export interface ApiKeyRow {
  id: string
  name: string
  rate_per_min: number
  revoked_at: string | null
}

/** Key → row (null when unknown or revoked). */
export async function findApiKey(c: Context<AppEnv>, plain: string): Promise<ApiKeyRow | null> {
  if (!/^nsk_[A-Za-z0-9]{20,64}$/.test(plain)) return null
  const r = await c.get('db').first<ApiKeyRow>('SELECT id, name, rate_per_min, revoked_at FROM api_keys WHERE key_hash = ?', [await sha256(plain)])
  return r && !r.revoked_at ? r : null
}

const cors: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next()
  c.header('Access-Control-Allow-Origin', '*')
  c.header('Access-Control-Expose-Headers', 'X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After, X-Request-Id')
}

/** Fixed one-minute window per key (DB-backed, so it works on Workers and Node). */
async function rateLimit(c: Context<AppEnv>, key: ApiKeyRow) {
  const db = c.get('db')
  const window = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString()
  const k = 'openapi:' + key.id
  const r = await db.first<{ count: number; window_start: string }>('SELECT count, window_start FROM login_attempts WHERE key = ?', [k])
  const count = r && r.window_start === window ? r.count + 1 : 1
  await db.run(
    'INSERT INTO login_attempts (key, count, window_start, locked_until) VALUES (?,?,?,NULL) ON CONFLICT(key) DO UPDATE SET count = excluded.count, window_start = excluded.window_start',
    [k, count, window]
  )
  const limit = Math.max(1, key.rate_per_min || 120)
  c.header('X-RateLimit-Limit', String(limit))
  c.header('X-RateLimit-Remaining', String(Math.max(0, limit - count)))
  if (count > limit) {
    c.header('Retry-After', String(60 - new Date().getUTCSeconds()))
    throw new HttpError(429, 'سقف درخواست این کلید در دقیقه پر شده است', 'rate_limited')
  }
}

const auth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method === 'OPTIONS') return next()
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') throw new HttpError(405, 'این API فقط‌خواندنی است', 'method_not_allowed')
  if (/\/openapi\.json$/.test(c.req.path)) return next()
  const plain = c.req.header('x-api-key') || c.req.query('api_key') || ''
  const key = plain ? await findApiKey(c, plain) : null
  if (!key) throw new HttpError(401, 'کلید API معتبر لازم است (سرآیند X-API-Key)', 'api_key')
  await rateLimit(c, key)
  await c.get('db').run('UPDATE api_keys SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?', [nowIso(), key.id])
  await next()
}

openRoutes.use('*', cors)
openRoutes.use('*', auth)
// CORS preflight (no key needed; the browser never sends custom headers on a preflight)
openRoutes.options('*', (c) =>
  c.body(null, 204, {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'X-API-Key, Content-Type',
    'Access-Control-Max-Age': '86400'
  })
)

const pubOut = (p: any) => ({
  id: p.id,
  slug: p.slug,
  title: p.title,
  tagline: p.tagline || null,
  frequency: p.frequency || null,
  license_number: p.license_number || null,
  association: p.association_name ? { id: p.association_id, name: p.association_name } : null,
  faculty: p.faculty_id ? { id: p.faculty_id, name: p.faculty_name } : null,
  issue_count: p.issue_count ?? undefined
})
const issueOut = (i: any) => ({
  id: i.id,
  publication: { id: i.publication_id, slug: i.publication_slug, title: i.publication_title },
  number: i.number,
  title: i.title,
  summary: i.summary || null,
  keywords: String(i.keywords || '').split(/[،,]/).map((k) => k.trim()).filter(Boolean),
  pricing: i.pricing,
  page_count: i.page_count || 0,
  published_at: i.published_at,
  archival: !!i.archival
})

const PUB_SELECT = `SELECT p.id, p.slug, p.title, p.tagline, p.frequency, p.license_number, p.association_id, a.name AS association_name,
  p.faculty_id, f.name AS faculty_name FROM publications p JOIN associations a ON a.id = p.association_id LEFT JOIN faculties f ON f.id = p.faculty_id`
const ISSUE_SELECT = `SELECT i.id, i.publication_id, i.number, i.title, i.summary, i.keywords, i.pricing, i.page_count, i.published_at,
  p.slug AS publication_slug, p.title AS publication_title FROM issues i JOIN publications p ON p.id = i.publication_id`

openRoutes.get('/', (c) =>
  c.json({
    name: 'nashriyar-open-api',
    version: '1',
    endpoints: ['/publications', '/publications/{slug}', '/issues', '/issues/{id}', '/faculties', '/categories', '/openapi.json']
  })
)

openRoutes.get('/publications', async (c) => {
  const pg = cursorPage(c, { col: 'p.slug', idCol: 'p.id', dir: 'ASC', def: 100, max: 200 })
  const where = ["p.status = 'active'", 'p.deleted_at IS NULL']
  const params: unknown[] = []
  const faculty = c.req.query('faculty')
  if (faculty) (where.push('p.faculty_id = ?'), params.push(faculty))
  const rows = await c.get('db').all<any>(
    `${PUB_SELECT} WHERE ${where.join(' AND ')}${pg.and} ORDER BY ${pg.order} LIMIT ${pg.fetch}`,
    [...params, ...pg.params]
  )
  const { rows: page, next_cursor } = pg.finish(rows, (r) => [r.slug, r.id])
  return c.json({ publications: page.map(pubOut), next_cursor })
})

openRoutes.get('/publications/:slug', async (c) => {
  const db = c.get('db')
  const p = await db.first<any>(`${PUB_SELECT} WHERE p.slug = ? AND p.status = 'active' AND p.deleted_at IS NULL`, [c.req.param('slug')])
  if (!p) throw notFound('نشریه یافت نشد')
  const categories = await db.all('SELECT c.slug, c.name FROM categories c JOIN publication_categories pc ON pc.category_id = c.id WHERE pc.publication_id = ?', [p.id])
  const issues = await db.all<any>(`${ISSUE_SELECT} WHERE ${PUBLISHED} AND p.id = ? ORDER BY i.number DESC`, [p.id])
  return c.json({ publication: { ...pubOut(p), categories }, issues: issues.map(issueOut) })
})

openRoutes.get('/issues', async (c) => {
  const pg = cursorPage(c, { col: 'i.published_at', idCol: 'i.id', def: 100, max: 200 })
  const where = [PUBLISHED]
  const params: unknown[] = []
  const pub = c.req.query('publication')
  if (pub) (where.push('p.slug = ?'), params.push(pub))
  const since = c.req.query('since')
  if (since && /^\d{4}-\d{2}-\d{2}/.test(since)) (where.push('i.published_at >= ?'), params.push(since))
  const q = normalizeFa(c.req.query('q') || '').trim()
  if (q) (where.push('i.search_text LIKE ?'), params.push(`%${q}%`))
  const rows = await c.get('db').all<any>(`${ISSUE_SELECT} WHERE ${where.join(' AND ')}${pg.and} ORDER BY ${pg.order} LIMIT ${pg.fetch}`, [...params, ...pg.params])
  const { rows: page, next_cursor } = pg.finish(rows, (r) => [r.published_at, r.id])
  return c.json({ issues: page.map(issueOut), next_cursor })
})

openRoutes.get('/issues/:id', async (c) => {
  const db = c.get('db')
  const i = await db.first<any>(`${ISSUE_SELECT} WHERE i.id = ? AND ${PUBLISHED}`, [c.req.param('id')])
  if (!i) throw notFound('شماره یافت نشد')
  const toc = await db.all<any>('SELECT id, parent_id, title, kind, page_start, page_end FROM issue_toc_items WHERE issue_id = ? ORDER BY sort_order', [i.id])
  const by = await db.all<any>(
    'SELECT ta.toc_item_id, ta.role, tm.full_name FROM toc_assignments ta JOIN team_members tm ON tm.id = ta.team_member_id JOIN issue_toc_items t ON t.id = ta.toc_item_id WHERE t.issue_id = ?',
    [i.id]
  )
  const categories = await db.all('SELECT c.slug, c.name FROM categories c JOIN issue_categories ic ON ic.category_id = c.id WHERE ic.issue_id = ?', [i.id])
  const origin = new URL(c.req.url).origin
  return c.json({
    issue: { ...issueOut(i), url: `${origin}/issue/${i.id}`, categories },
    toc: toc.map((t) => ({ ...t, bylines: by.filter((b) => b.toc_item_id === t.id).map((b) => ({ role: b.role, name: b.full_name })) }))
  })
})

openRoutes.get('/faculties', async (c) => {
  const rows = await c.get('db').all('SELECT id, name, code FROM faculties WHERE is_active = 1 ORDER BY sort_order, name')
  return c.json({ faculties: rows })
})

openRoutes.get('/categories', async (c) => {
  const rows = await c.get('db').all('SELECT slug, name, type, parent_id FROM categories WHERE is_active = 1 ORDER BY type, sort_order, name')
  return c.json({ categories: rows })
})

/** Machine-readable contract (no key needed). */
openRoutes.get('/openapi.json', (c) => {
  const origin = new URL(c.req.url).origin
  const list = (name: string, extra: Record<string, unknown> = {}) => ({
    get: {
      summary: name,
      parameters: [
        { name: 'cursor', in: 'query', schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 200 } },
        ...Object.entries(extra).map(([n, d]) => ({ name: n, in: 'query', description: d, schema: { type: 'string' } }))
      ],
      responses: { '200': { description: 'OK' }, '401': { description: 'کلید نامعتبر' }, '429': { description: 'سقف نرخ' } }
    }
  })
  const one = (name: string, param: string) => ({
    get: { summary: name, parameters: [{ name: param, in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' }, '404': { description: 'یافت نشد' } } }
  })
  return c.json({
    openapi: '3.0.3',
    info: { title: 'Nashriyar Open API (read-only)', version: '1.0.0', description: 'دادهٔ عمومی نشریات دانشجویی برای سامانه‌های دیگر دانشگاه' },
    servers: [{ url: `${origin}/api/open` }],
    components: { securitySchemes: { key: { type: 'apiKey', in: 'header', name: 'X-API-Key' } } },
    security: [{ key: [] }],
    paths: {
      '/publications': list('نشریات فعال', { faculty: 'شناسهٔ دانشکده' }),
      '/publications/{slug}': one('یک نشریه و شماره‌های منتشرشده', 'slug'),
      '/issues': list('شماره‌های منتشرشده (جدیدترین اول)', { publication: 'slug نشریه', since: 'تاریخ ISO', q: 'جست‌وجو' }),
      '/issues/{id}': one('یک شماره با فهرست مطالب و نویسندگان', 'id'),
      '/faculties': { get: { summary: 'دانشکده‌ها', responses: { '200': { description: 'OK' } } } },
      '/categories': { get: { summary: 'دسته‌بندی‌ها', responses: { '200': { description: 'OK' } } } }
    }
  })
})


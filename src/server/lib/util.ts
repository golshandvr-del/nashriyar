import type { Context } from 'hono'
import type { Db } from '../adapters/db'
import { newId } from './crypto'
import { deliverOutbound } from './notifier'
import { enqueueOutbound } from './channels'
import { academicYearRange, normalizeFa } from '../../shared/fa'
import { getClock } from '../adapters/clock'

export const nowIso = () => new Date(getClock().now()).toISOString()
export const today = () => nowIso().slice(0, 10)
export const addHours = (h: number, from = Date.now()) => new Date(from + h * 3600_000).toISOString()

// HTTP errors live in lib/errors.ts (shared with the zod validation layer); re-exported for existing imports.
import { bad } from './errors'
import { check, v as vz } from './validate'
export { HttpError, bad, notFound, forbidden } from './errors'

/** Read JSON body safely. */
export async function body<T = any>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T
  } catch {
    return {} as T
  }
}

/**
 * Field validation helpers — thin wrappers over the unified zod schemas in lib/validate.ts (ROADMAP phase 17), so routes
 * that validate field by field and routes that use `parseBody(c, shape)` share one implementation and one set of
 * Persian messages. Failures throw HttpError(400, message, 'validation', { fields }).
 */
export function str(v: unknown, name: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string {
  return check(vz.str(name, opts), v) as string
}

export function int(v: unknown, name: string, opts: { min?: number; max?: number; optional?: boolean } = {}): number | null {
  return check(vz.int(name, opts), v) as number | null
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], name: string, def?: T): T {
  return check(vz.oneOf(allowed, name, def), v)
}

export function slugify(s: string): string {
  const base = normalizeFa(s)
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return base || newId()
}

export function keywordsCsv(v: unknown): string {
  const arr = Array.isArray(v) ? v : String(v ?? '').split(/[,،\n]/)
  return Array.from(new Set(arr.map((x) => String(x).trim()).filter(Boolean))).slice(0, 30).join('،')
}

export async function audit(db: Db, actor: string | null | undefined, action: string, entityType: string, entityId: string | null, before?: unknown, after?: unknown) {
  await db.run(
    'INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, before_json, after_json, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [newId(), actor ?? null, action, entityType, entityId, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, nowIso()]
  )
}

export async function activity(db: Db, actor: string | null | undefined, type: string, publicationId?: string | null, issueId?: string | null, payload?: unknown) {
  await db.run(
    'INSERT INTO activity_events (id, actor_user_id, publication_id, issue_id, type, payload_json, created_at) VALUES (?,?,?,?,?,?,?)',
    [newId(), actor ?? null, publicationId ?? null, issueId ?? null, type, payload ? JSON.stringify(payload) : null, nowIso()]
  )
}

export async function notify(db: Db, userId: string, type: string, title: string, link?: string) {
  await db.run('INSERT INTO notifications (id, user_id, type, title, link, created_at) VALUES (?,?,?,?,?,?)', [newId(), userId, type, title, link ?? null, nowIso()])
  // Optional outbound channel (email/messenger); NullNotifier by default, never throws.
  await deliverOutbound({ userId, type, title, link })
  // ROADMAP phase 19: queue for the recipient's verified email / Bale / Eitaa channels (flushed after the response)
  await enqueueOutbound(db, { userId, type, title, link })
}

export async function getSetting<T>(db: Db, key: string, def: T): Promise<T> {
  const r = await db.first<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])
  if (!r) return def
  try {
    return JSON.parse(r.value) as T
  } catch {
    return def
  }
}

export async function setSetting(db: Db, key: string, value: unknown) {
  await db.run(
    'INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    [key, JSON.stringify(value), nowIso()]
  )
}

export function parseJson<T>(s: string | null | undefined, def: T): T {
  if (!s) return def
  try {
    return JSON.parse(s) as T
  } catch {
    return def
  }
}

/** Build "IN (?,?,?)" placeholder list. */
export const inList = (arr: unknown[]) => (arr.length ? arr.map(() => '?').join(',') : 'NULL')

export function dateRange(c: Context, defDays = 365) {
  // ?acad=1403 selects a whole academic year (1 Mehr 1403 → 31 Shahrivar 1404) — ROADMAP phase 17 academic-year dimension
  const acad = Number(c.req.query('acad'))
  if (Number.isInteger(acad) && acad >= 1380 && acad <= 1500) {
    const r = academicYearRange(acad)
    const to = r.to < today() ? r.to : today()
    return { from: r.from, to, fromTs: r.from + 'T00:00:00.000Z', toTs: to + 'T23:59:59.999Z' }
  }
  const to = c.req.query('to') || today()
  const from = c.req.query('from') || new Date(Date.now() - defDays * 86400000).toISOString().slice(0, 10)
  // inclusive end-of-day bound
  return { from, to, fromTs: from + 'T00:00:00.000Z', toTs: to + 'T23:59:59.999Z' }
}

/**
 * Keyset (cursor) pagination — ROADMAP phase 17. Stable under inserts and O(log n) on any page, unlike OFFSET.
 * Ordering is (col, idCol) in `dir`; the opaque cursor is the last row's [col, id] encoded as base64url JSON.
 * Usage:
 *   const pg = cursorPage(c, { col: 'a.created_at', idCol: 'a.id' })
 *   const rows = await db.all(`SELECT ... WHERE x = ?${pg.and} ORDER BY ${pg.order} LIMIT ${pg.fetch}`, [x, ...pg.params])
 *   return c.json({ items: ..., ...pg.finish(rows, (r) => [r.created_at, r.id]) })   // → { items, next_cursor }
 * Without ?cursor the first page is returned, so existing clients keep working. ?limit is clamped to [1, max].
 * `page` overrides ?cursor/?limit so a server-side export (ROADMAP phase 18) can walk every page of the same query.
 */
export interface PageOverride {
  cursor?: string | null
  limit?: number
}
export function cursorPage(c: Context, opts: { col: string; idCol: string; dir?: 'ASC' | 'DESC'; def?: number; max?: number; nullable?: boolean; page?: PageOverride }) {
  const dir = opts.dir || 'DESC'
  const max = opts.max ?? 200
  const n = Number(opts.page ? opts.page.limit : c.req.query('limit'))
  const limit = Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : (opts.def ?? Math.min(100, max))
  const raw = (opts.page ? opts.page.cursor : c.req.query('cursor')) || ''
  let after: [unknown, unknown] | null = null
  if (raw) {
    try {
      const v = JSON.parse(decodeURIComponent(atob(raw.replace(/-/g, '+').replace(/_/g, '/'))))
      if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string' || typeof x === 'number' || x === null)) after = [v[0], v[1]]
    } catch {
      /* fall through */
    }
    if (!after) throw bad('نشانگر صفحه (cursor) نامعتبر است', 'bad_cursor')
  }
  const op = dir === 'DESC' ? '<' : '>'
  // NOT NULL sort columns are used bare so an index can serve ORDER BY; nullable ones go through COALESCE so rows
  // without a value still paginate deterministically
  const k = opts.nullable ? `COALESCE(${opts.col}, '')` : opts.col
  const cond = after ? `(${k} ${op} ? OR (${k} = ? AND ${opts.idCol} ${op} ?))` : ''
  const params = after ? [after[0] ?? '', after[0] ?? '', after[1]] : []
  return {
    limit,
    /** LIMIT value to use: one extra row tells whether a next page exists */
    fetch: limit + 1,
    /** condition to splice after an existing WHERE (` AND (...)`) */
    and: cond ? ` AND ${cond}` : '',
    /** condition to use as the whole WHERE (`WHERE (...)`) when the query has no other filter */
    where: cond ? `WHERE ${cond}` : '',
    params,
    order: `${k} ${dir}, ${opts.idCol} ${dir}`,
    finish<T>(rows: T[], key: (r: T) => [unknown, unknown]): { next_cursor: string | null; rows: T[] } {
      const more = rows.length > limit
      const page = more ? rows.slice(0, limit) : rows
      const last = page[page.length - 1]
      const next_cursor = more && last ? btoa(encodeURIComponent(JSON.stringify(key(last)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : null
      return { next_cursor, rows: page }
    }
  }
}

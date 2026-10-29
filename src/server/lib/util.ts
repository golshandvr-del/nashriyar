import type { Context } from 'hono'
import type { Db } from '../adapters/db'
import { newId } from './crypto'
import { normalizeFa } from '../../shared/fa'

export const nowIso = () => new Date().toISOString()
export const today = () => new Date().toISOString().slice(0, 10)
export const addHours = (h: number, from = Date.now()) => new Date(from + h * 3600_000).toISOString()

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message)
  }
}

export const bad = (msg: string, code?: string) => new HttpError(400, msg, code)
export const notFound = (msg = 'یافت نشد') => new HttpError(404, msg)
export const forbidden = (msg = 'دسترسی ندارید') => new HttpError(403, msg)

/** Read JSON body safely. */
export async function body<T = any>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T
  } catch {
    return {} as T
  }
}

/** Minimal field validation helpers (keeps the worker bundle small). */
export function str(v: unknown, name: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim()
  if (!s) {
    if (opts.optional) return ''
    throw bad(`«${name}» الزامی است`)
  }
  if (opts.min && s.length < opts.min) throw bad(`«${name}» باید حداقل ${opts.min} نویسه باشد`)
  if (s.length > (opts.max ?? 5000)) throw bad(`«${name}» بیش از حد طولانی است`)
  return s
}

export function int(v: unknown, name: string, opts: { min?: number; max?: number; optional?: boolean } = {}): number | null {
  if (v === '' || v == null) {
    if (opts.optional) return null
    throw bad(`«${name}» الزامی است`)
  }
  const n = Number(v)
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw bad(`«${name}» باید عدد صحیح باشد`)
  if (opts.min != null && n < opts.min) throw bad(`«${name}» نباید کمتر از ${opts.min} باشد`)
  if (opts.max != null && n > opts.max) throw bad(`«${name}» نباید بیشتر از ${opts.max} باشد`)
  return n
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], name: string, def?: T): T {
  if ((v == null || v === '') && def) return def
  if (!allowed.includes(v as T)) throw bad(`مقدار «${name}» نامعتبر است`)
  return v as T
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
  const to = c.req.query('to') || today()
  const from = c.req.query('from') || new Date(Date.now() - defDays * 86400000).toISOString().slice(0, 10)
  // inclusive end-of-day bound
  return { from, to, fromTs: from + 'T00:00:00.000Z', toTs: to + 'T23:59:59.999Z' }
}

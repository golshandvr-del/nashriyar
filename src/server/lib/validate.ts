// Unified zod validation for API input (ROADMAP phase 17).
// Every field check in the API goes through zod with one consistent set of Persian messages:
//   - field schemas: `v.str`, `v.int`, `v.oneOf`, `v.bool`, `v.id`, `v.list` (cached by options, cheap to reuse per request)
//   - object input: `parseBody(c, shape)` / `parseQuery(c, shape)` / `parseInput(data, shape)`
//   - legacy helpers `str()` / `int()` / `oneOf()` in lib/util.ts delegate to the same schemas, so older routes and new
//     schema-based routes produce identical messages.
// A failure throws HttpError(400, <first message>, 'validation', { fields: { 'path.to.field': message } }); app.onError
// spreads `fields` into the JSON body, and raw ZodErrors thrown by `.parse()` anywhere are translated the same way.
import { z } from 'zod'
import type { Context } from 'hono'
import { HttpError } from './errors'

export { z }

// ── Persian messages (single source; identical wording to the pre-zod helpers) ──────────────────────────────────────
export const faMsg = {
  required: (l: string) => `«${l}» الزامی است`,
  minLen: (l: string, n: number) => `«${l}» باید حداقل ${n} نویسه باشد`,
  tooLong: (l: string) => `«${l}» بیش از حد طولانی است`,
  notInt: (l: string) => `«${l}» باید عدد صحیح باشد`,
  min: (l: string, n: number) => `«${l}» نباید کمتر از ${n} باشد`,
  max: (l: string, n: number) => `«${l}» نباید بیشتر از ${n} باشد`,
  invalid: (l: string) => `مقدار «${l}» نامعتبر است`,
  tooMany: (l: string, n: number) => `«${l}» حداکثر ${n} مورد می‌پذیرد`
}

/** Fallback Persian message for issues raised by schemas built without the `v` helpers (labels = field path). */
function fallbackMessage(iss: { code?: string; path?: PropertyKey[]; input?: unknown; minimum?: unknown; maximum?: unknown; origin?: string }): string {
  const l = (iss.path ?? []).map(String).join('.') || 'ورودی'
  switch (iss.code) {
    case 'invalid_type':
      return iss.input === undefined || iss.input === null ? faMsg.required(l) : faMsg.invalid(l)
    case 'too_small':
      return iss.origin === 'string' ? (Number(iss.minimum) <= 1 ? faMsg.required(l) : faMsg.minLen(l, Number(iss.minimum))) : faMsg.min(l, Number(iss.minimum))
    case 'too_big':
      return iss.origin === 'string' ? faMsg.tooLong(l) : iss.origin === 'array' ? faMsg.tooMany(l, Number(iss.maximum)) : faMsg.max(l, Number(iss.maximum))
    default:
      return faMsg.invalid(l)
  }
}
// Server-only global: every zod issue without an explicit message gets the Persian fallback above.
z.config({ customError: (iss) => fallbackMessage(iss as Parameters<typeof fallbackMessage>[0]) })

// ── Field schemas (memoised: zod schema construction is far costlier than parsing) ─────────────────────────────────
const cache = new Map<string, z.ZodType>()
function memo<T extends z.ZodType>(key: string, make: () => T): T {
  let s = cache.get(key) as T | undefined
  if (!s) {
    s = make()
    if (cache.size < 2000) cache.set(key, s)
  }
  return s
}

type StrOpts = { min?: number; max?: number; optional?: boolean }
type IntOpts = { min?: number; max?: number; optional?: boolean }

const trimmed = (x: unknown) => (typeof x === 'string' ? x.trim() : x == null ? '' : String(x).trim())

export const v = {
  /** Trimmed string; numbers are stringified; empty → required error unless optional (then ''). Default max 5000. */
  str(label: string, o: StrOpts = {}) {
    const max = o.max ?? 5000
    return memo(`s|${label}|${o.min ?? ''}|${max}|${o.optional ? 1 : 0}`, () => {
      let s = z.string()
      if (!o.optional) s = s.min(1, { error: faMsg.required(label), abort: true })
      if (o.min) s = s.refine((x) => !x || x.length >= o.min!, { error: faMsg.minLen(label, o.min) })
      s = s.max(max, { error: faMsg.tooLong(label) })
      return z.preprocess(trimmed, s)
    })
  },
  /** Integer (numeric strings accepted); '' / null / undefined → required error, or null when optional. */
  int(label: string, o: IntOpts = {}) {
    return memo(`i|${label}|${o.min ?? ''}|${o.max ?? ''}|${o.optional ? 1 : 0}`, () => {
      let n = z.number({ error: (iss) => (iss.input == null ? faMsg.required(label) : faMsg.notInt(label)) }).int({ error: faMsg.notInt(label) })
      if (o.min != null) n = n.min(o.min, { error: faMsg.min(label, o.min) })
      if (o.max != null) n = n.max(o.max, { error: faMsg.max(label, o.max) })
      const inner = o.optional ? n.nullable() : n
      return z.preprocess((x) => (x === '' || x == null ? null : typeof x === 'string' ? Number(x.trim()) : Number(x)), inner)
    })
  },
  /** One of a fixed set of values; empty input falls back to `def` when given. */
  oneOf<T extends string>(allowed: readonly T[], label: string, def?: T) {
    return memo(`e|${label}|${allowed.join(',')}|${def ?? ''}`, () =>
      z.preprocess((x) => ((x == null || x === '') && def ? def : x), z.enum(allowed as unknown as [T, ...T[]], { error: faMsg.invalid(label) }))
    ) as unknown as z.ZodType<T>
  },
  /** Boolean from true/false, 1/0, 'true'/'false', 'on'; missing → false. */
  bool(label: string) {
    return memo(`b|${label}`, () =>
      z.preprocess((x) => (x == null || x === '' ? false : x === true || x === 1 || x === '1' || x === 'true' || x === 'on' ? true : x === false || x === 0 || x === '0' || x === 'false' ? false : x), z.boolean({ error: faMsg.invalid(label) }))
    )
  },
  /** Opaque record id (ULID/UUID-like): 1–64 chars of [A-Za-z0-9_-]. */
  id(label: string, o: { optional?: boolean } = {}) {
    return memo(`id|${label}|${o.optional ? 1 : 0}`, () => {
      const s = z.string().regex(/^[\w-]{1,64}$/, { error: faMsg.invalid(label) })
      return o.optional ? z.preprocess((x) => (x === '' || x == null ? undefined : x), s.optional()) : z.preprocess(trimmed, z.string().min(1, { error: faMsg.required(label), abort: true }).pipe(s))
    })
  },
  /** Array of items (each validated by `item`), at most `max` entries; missing → []. */
  list<T extends z.ZodType>(item: T, label: string, max = 200) {
    return z.preprocess((x) => (x == null || x === '' ? [] : x), z.array(item, { error: faMsg.invalid(label) }).max(max, { error: faMsg.tooMany(label, max) }))
  }
}

// ── Running a schema ────────────────────────────────────────────────────────────────────────────────────────────────
/** Converts a ZodError into the API's 400 HttpError (first message as `error`, every field message in `fields`). */
export function validationError(err: z.ZodError): HttpError {
  const fields: Record<string, string> = {}
  for (const i of err.issues) {
    const k = i.path.map(String).join('.') || '_'
    if (!(k in fields)) fields[k] = i.message
  }
  return new HttpError(400, err.issues[0]?.message || 'ورودی نامعتبر است', 'validation', { fields })
}

/** Validates one value with a field schema (used by the legacy util helpers). */
export function check<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value)
  if (!r.success) throw validationError(r.error)
  return r.data
}

type Shape = Record<string, z.ZodType>
const objCache = new WeakMap<Shape, z.ZodType>()
const objectOf = (shape: Shape) => {
  let s = objCache.get(shape)
  if (!s) objCache.set(shape, (s = z.object(shape)))
  return s
}

/** Validates any plain data against an object shape; unknown keys are dropped. Define shapes at module level. */
export function parseInput<S extends Shape>(data: unknown, shape: S): z.infer<z.ZodObject<S>> {
  const r = objectOf(shape).safeParse(data && typeof data === 'object' ? data : {})
  if (!r.success) throw validationError(r.error)
  return r.data as z.infer<z.ZodObject<S>>
}

/** Reads the JSON body (invalid / missing JSON → {}) and validates it. */
export async function parseBody<S extends Shape>(c: Context, shape: S): Promise<z.infer<z.ZodObject<S>>> {
  let data: unknown = {}
  try {
    data = await c.req.json()
  } catch {
    data = {}
  }
  return parseInput(data, shape)
}

/** Validates the query string (single values). */
export function parseQuery<S extends Shape>(c: Context, shape: S): z.infer<z.ZodObject<S>> {
  return parseInput(c.req.query(), shape)
}

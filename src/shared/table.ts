// Unified table model (ROADMAP phase 18), shared by the browser DataTable and the server streaming export.
// One implementation of filtering, search, sorting and grouping ⇒ a file exported by the server contains exactly the
// rows, order and columns the user sees on screen (same state, same code).
//
// State lives in the URL (linkable, restorable) as `dt_*` query parameters:
//   dt_q=text                      free-text search over the visible columns (Persian-normalised, digit-insensitive)
//   dt_sort=key.asc|key.desc       sort column and direction
//   dt_group=key                   group rows by a column (groups ordered by the group label)
//   dt_cols=a,b,c                  visible / exported columns in order (absent = the table's defaults)
//   dt_f_<key>=v1,v2               select filter: any of the raw values (list columns: contains any)
//   dt_f_<key>=from~to             date filter: ISO yyyy-mm-dd bounds (either side optional), inclusive
//   dt_f_<key>=min~max             number filter (either side optional), inclusive
import { normalizeFa, toEnDigits } from './fa'
import type { ColType, SheetColumn } from './sheet'

export type FilterKind = 'select' | 'date' | 'number'
export interface TableColumn {
  key: string
  label: string
  /** cell type for sorting and export (dates become Jalali in the sheet) */
  type?: ColType
  /** comma/«،»-separated multi-value text (publications, roles…): select filters match any contained value */
  list?: boolean
  /** raw value → Persian label (status, role, gender…); used for display, search, export and filter options */
  labels?: Record<string, string>
  filter?: FilterKind
  /** hidden unless the user enables it in the column picker */
  hidden?: boolean
  sortable?: boolean
  groupable?: boolean
  total?: 'sum' | 'count'
  width?: number
}

export interface TableState {
  q: string
  sort: { key: string; dir: 'asc' | 'desc' } | null
  group: string | null
  cols: string[] | null
  filters: Record<string, string[] | { from?: string; to?: string }>
}

export type Row = Record<string, unknown>
export const EMPTY_STATE: TableState = { q: '', sort: null, group: null, cols: null, filters: {} }
const LIST_SPLIT = /\s*[,،]\s*/

// ── URL (de)serialisation ───────────────────────────────────────────────────────────────────────────────────────────
/** Reads table state from query parameters (URLSearchParams or a plain record, e.g. Hono's c.req.query()). */
export function parseTableState(src: URLSearchParams | Record<string, string | undefined>, columns?: TableColumn[]): TableState {
  const get = (k: string) => (src instanceof URLSearchParams ? src.get(k) : src[k]) ?? ''
  const keys = src instanceof URLSearchParams ? [...src.keys()] : Object.keys(src)
  const known = columns ? new Set(columns.map((c) => c.key)) : null
  const ok = (k: string) => !known || known.has(k)
  const st: TableState = { q: get('dt_q').slice(0, 200), sort: null, group: null, cols: null, filters: {} }
  const sm = /^([\w.]+)\.(asc|desc)$/.exec(get('dt_sort'))
  if (sm && ok(sm[1])) st.sort = { key: sm[1], dir: sm[2] as 'asc' | 'desc' }
  const g = get('dt_group')
  if (g && ok(g)) st.group = g
  const cols = get('dt_cols').split(',').filter((k) => k && ok(k))
  if (cols.length) st.cols = [...new Set(cols)]
  for (const k of keys) {
    if (!k.startsWith('dt_f_')) continue
    const key = k.slice(5)
    const v = get(k)
    if (!v || !ok(key)) continue
    const col = columns?.find((c) => c.key === key)
    if (v.includes('~') && (!col || col.filter === 'date' || col.filter === 'number')) {
      const [from, to] = v.split('~')
      st.filters[key] = { ...(from ? { from } : {}), ...(to ? { to } : {}) }
    } else st.filters[key] = v.split(',').filter(Boolean).slice(0, 50)
  }
  return st
}

/** Table state → `dt_*` parameters (only non-default parts, so URLs stay short). */
export function tableStateToParams(st: TableState): Record<string, string> {
  const p: Record<string, string> = {}
  if (st.q.trim()) p.dt_q = st.q.trim()
  if (st.sort) p.dt_sort = `${st.sort.key}.${st.sort.dir}`
  if (st.group) p.dt_group = st.group
  if (st.cols?.length) p.dt_cols = st.cols.join(',')
  for (const [k, v] of Object.entries(st.filters)) {
    if (Array.isArray(v)) {
      if (v.length) p[`dt_f_${k}`] = v.join(',')
    } else if (v.from || v.to) p[`dt_f_${k}`] = `${v.from || ''}~${v.to || ''}`
  }
  return p
}

// ── values ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const isEmpty = (v: unknown) => v == null || v === ''
/** Raw values of a cell (list columns split into their items). */
export function rawValues(col: TableColumn, v: unknown): string[] {
  if (isEmpty(v)) return []
  if (Array.isArray(v)) return v.map(String)
  return col.list ? String(v).split(LIST_SPLIT).filter(Boolean) : [String(v)]
}
/** Display text of a cell (labels applied). Numbers and dates stay raw here; the sheet/renderer formats them. */
export function displayValue(col: TableColumn, v: unknown): unknown {
  if (isEmpty(v)) return v
  if (col.labels) return rawValues(col, v).map((x) => col.labels![x] ?? x).join('، ')
  if (typeof v === 'boolean') return v ? 'بله' : 'خیر'
  return v
}
/** Search key: Persian-normalised, Latin digits, lower case. */
export const searchKey = (s: unknown) => normalizeFa(toEnDigits(String(s ?? ''))).toLowerCase()

export function visibleColumns(columns: TableColumn[], st: TableState): TableColumn[] {
  if (!st.cols) return columns.filter((c) => !c.hidden)
  const byKey = new Map(columns.map((c) => [c.key, c]))
  const picked = st.cols.map((k) => byKey.get(k)).filter(Boolean) as TableColumn[]
  return picked.length ? picked : columns.filter((c) => !c.hidden)
}

// ── filter / search ─────────────────────────────────────────────────────────────────────────────────────────────────
/** Row predicate for the state's filters and search (search covers the visible columns, by their display text). */
export function rowPredicate(columns: TableColumn[], st: TableState): (r: Row) => boolean {
  const byKey = new Map(columns.map((c) => [c.key, c]))
  const tests: ((r: Row) => boolean)[] = []
  for (const [key, f] of Object.entries(st.filters)) {
    const col = byKey.get(key)
    if (!col) continue
    if (Array.isArray(f)) {
      if (!f.length) continue
      const want = new Set(f)
      tests.push((r) => rawValues(col, r[key]).some((x) => want.has(x)))
    } else if (col.filter === 'number') {
      const lo = f.from ? Number(toEnDigits(f.from)) : null
      const hi = f.to ? Number(toEnDigits(f.to)) : null
      tests.push((r) => {
        const n = Number(r[key])
        return !isEmpty(r[key]) && Number.isFinite(n) && (lo == null || n >= lo) && (hi == null || n <= hi)
      })
    } else {
      const lo = f.from?.slice(0, 10)
      const hi = f.to?.slice(0, 10)
      tests.push((r) => {
        if (isEmpty(r[key])) return false
        const d = String(r[key]).slice(0, 10)
        return (!lo || d >= lo) && (!hi || d <= hi)
      })
    }
  }
  const words = searchKey(st.q).split(/\s+/).filter(Boolean)
  if (words.length) {
    const cols = visibleColumns(columns, st)
    tests.push((r) => {
      const hay = cols.map((c) => searchKey(displayValue(c, r[c.key]))).join(' ')
      return words.every((w) => hay.includes(w))
    })
  }
  return (r) => tests.every((t) => t(r))
}

// ── sort / group ────────────────────────────────────────────────────────────────────────────────────────────────────
const collator = typeof Intl !== 'undefined' ? new Intl.Collator('fa', { numeric: true, sensitivity: 'base' }) : null
const cmpText = (a: string, b: string) => (collator ? collator.compare(a, b) : a < b ? -1 : a > b ? 1 : 0)
/** Compares two cell values of a column; empty values always sort last (both directions). */
export function compareCells(col: TableColumn, a: unknown, b: unknown, dir: 'asc' | 'desc' = 'asc'): number {
  const ea = isEmpty(a)
  const eb = isEmpty(b)
  if (ea || eb) return ea && eb ? 0 : ea ? 1 : -1
  const t = col.type || 'text'
  let c: number
  if (t === 'number' || t === 'money') c = Number(a) - Number(b)
  else if (t === 'date' || t === 'datetime') c = String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
  else c = cmpText(String(displayValue(col, a)), String(displayValue(col, b)))
  if (Number.isNaN(c)) c = 0
  return dir === 'desc' ? -c : c
}
/** Group label of a row (display text; empty ⇒ «—»). */
export function groupLabel(col: TableColumn, r: Row): string {
  const v = displayValue(col, r[col.key])
  if (isEmpty(v)) return '—'
  return col.type === 'date' || col.type === 'datetime' ? String(v).slice(0, 7) : String(v)
}

/** Full comparator: group label first (ascending, «—» last), then the sort column, then the original order. */
export function rowComparator(columns: TableColumn[], st: TableState): ((a: Row, b: Row) => number) | null {
  const g = st.group ? columns.find((c) => c.key === st.group) : null
  const s = st.sort ? columns.find((c) => c.key === st.sort!.key) : null
  if (!g && !s) return null
  return (a, b) => {
    if (g) {
      const la = groupLabel(g, a)
      const lb = groupLabel(g, b)
      if (la !== lb) return la === '—' ? 1 : lb === '—' ? -1 : cmpText(la, lb)
    }
    return s ? compareCells(s, a[s.key], b[s.key], st.sort!.dir) : 0
  }
}

/** Filter + search + sort (+ group order) — the rows exactly as the table shows them. Stable. */
export function applyTable<T extends Row>(rows: T[], columns: TableColumn[], st: TableState): T[] {
  const keep = rowPredicate(columns, st)
  const out = rows.filter(keep)
  const cmp = rowComparator(columns, st)
  if (!cmp) return out
  return out
    .map((r, i) => ({ r, i }))
    .sort((x, y) => cmp(x.r, y.r) || x.i - y.i)
    .map((x) => x.r)
}

/** Groups of an already ordered row list (consecutive rows with the same label). */
export function groupRows<T extends Row>(rows: T[], columns: TableColumn[], st: TableState): { label: string; rows: T[] }[] {
  const g = st.group ? columns.find((c) => c.key === st.group) : null
  if (!g) return [{ label: '', rows }]
  const out: { label: string; rows: T[] }[] = []
  for (const r of rows) {
    const l = groupLabel(g, r)
    if (out.length && out[out.length - 1].label === l) out[out.length - 1].rows.push(r)
    else out.push({ label: l, rows: [r] })
  }
  return out
}

// ── export ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Sheet columns for the visible columns (a group column is moved first so the file reads like the screen). */
export function exportColumns(columns: TableColumn[], st: TableState): TableColumn[] {
  const vis = visibleColumns(columns, st)
  const g = st.group ? columns.find((c) => c.key === st.group) : null
  return g ? [g, ...vis.filter((c) => c.key !== g.key)] : vis
}
export const toSheetColumns = (cols: TableColumn[]): SheetColumn[] =>
  cols.map((c) => ({ key: c.key, label: c.label, type: c.labels ? 'text' : c.type, total: c.total, width: c.width }))
/** A row as written to the sheet: labels applied, lists joined. */
export function exportRow(cols: TableColumn[], r: Row): Row {
  const o: Row = {}
  for (const c of cols) o[c.key] = c.labels || c.list || typeof r[c.key] === 'boolean' ? displayValue(c, r[c.key]) : r[c.key]
  return o
}
/** One-line Persian description of the active filters (sheet subtitle / print header). */
export function describeState(columns: TableColumn[], st: TableState): string {
  const parts: string[] = []
  for (const [key, f] of Object.entries(st.filters)) {
    const col = columns.find((c) => c.key === key)
    if (!col) continue
    if (Array.isArray(f)) {
      if (f.length) parts.push(`${col.label}: ${f.map((x) => col.labels?.[x] ?? x).join('، ')}`)
    } else if (f.from || f.to) {
      const fmt = (x?: string) => (x ? (col.filter === 'date' ? String(x).slice(0, 10) : x) : '…')
      parts.push(`${col.label}: ${fmt(f.from)} تا ${fmt(f.to)}`)
    }
  }
  if (st.q.trim()) parts.push(`جست‌وجو: «${st.q.trim()}»`)
  const g = st.group && columns.find((c) => c.key === st.group)
  if (g) parts.push(`گروه‌بندی: ${g.label}`)
  const s = st.sort && columns.find((c) => c.key === st.sort!.key)
  if (s) parts.push(`مرتب‌سازی: ${s.label} (${st.sort!.dir === 'asc' ? 'صعودی' : 'نزولی'})`)
  return parts.length ? parts.join(' · ') : 'بدون فیلتر'
}

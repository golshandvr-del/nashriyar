// Unified DataTable (ROADMAP phase 18) for every data-entry tab.
//  - Combined filters (select / Jalali date range / number range), Persian search, sort, grouping, column picker.
//  - State lives in the URL (`dt_*`, linkable) and can be saved under a name (localStorage, per table).
//  - Excel (real XLSX: widths, wrap, frozen header, autofilter, RTL, Jalali dates, totals) and CSV (UTF-8 BOM).
//    With `exportUrl` the server streams the file from the same query + the same table state; otherwise it is built here.
//  - Professional print: A4/A3, portrait/landscape, header row repeated on every page, rows never split, «صفحه N از M»,
//    university letterhead, automatic scale to the paper width.
// Screen, file and print all go through src/shared/table.ts, so they show exactly the same rows in the same order.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, ArrowUpDown, Bookmark, ChevronDown, ChevronUp, Columns3, FileSpreadsheet, Filter, Layers, Link2, Printer, RotateCcw, Search, X } from 'lucide-react'
import { applyTable, describeState, displayValue, exportColumns, exportRow, groupRows, parseTableState, rawValues, tableStateToParams, toSheetColumns, visibleColumns, type Row, type TableColumn, type TableState } from '../../shared/table'
import { buildCsv, buildTableXlsx } from '../../shared/sheet'
import { isoToJalali, jalaliToIso } from '../../shared/fa'
import { api, qs } from '../lib/api'
import { cx, faDate, formatNumber, jalaliPresets, toEnDigits, toFaDigits } from '../lib/format'
import { usePublicSettings } from '../lib/features'
import { Button, Empty, Modal, useToast } from './ui'

export type { TableColumn } from '../../shared/table'

const PAGE = 300

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Loads every keyset page of a list endpoint (`{ [key]: [...], next_cursor }`) so the table holds the whole list. */
export async function fetchAllPages<T = any>(path: string, key: string, maxPages = 40): Promise<{ rows: T[]; first: any; truncated: boolean }> {
  const sep = path.includes('?') ? '&' : '?'
  let first: any = null
  let cursor: string | null = null
  const rows: T[] = []
  for (let i = 0; i < maxPages; i++) {
    const page: any = await api.get(`${path}${cursor ? `${sep}cursor=${encodeURIComponent(cursor)}` : ''}`)
    if (!first) first = page
    rows.push(...((page?.[key] as T[]) || []))
    if (!page?.next_cursor || page.next_cursor === cursor) return { rows, first, truncated: false }
    cursor = page.next_cursor
  }
  return { rows, first, truncated: true }
}

function download(name: string, data: BlobPart, type: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([data], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1500)
}

/** ISO date → «۱۴۰۵/۰۷/۰۱» for the date inputs. */
const isoToJalaliText = (iso?: string) => {
  if (!iso) return ''
  const j = isoToJalali(iso.slice(0, 10) + 'T12:00:00')
  return toFaDigits(`${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`)
}
/** «۱۴۰۵/۷/۱» (Persian or Latin digits, / - . separators) → ISO, or null if not a valid Jalali date. */
export function jalaliTextToIso(s: string): string | null {
  const m = /^\s*(\d{4})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*$/.exec(toEnDigits(s))
  if (!m) return null
  const [jy, jm, jd] = [+m[1], +m[2], +m[3]]
  if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12 || jd < 1 || jd > 31) return null
  return jalaliToIso(jy, jm, jd)
}

/** Default cell rendering by column type (labels applied, Persian digits, Jalali dates). */
export function renderCell(col: TableColumn, v: unknown): ReactNode {
  if (v == null || v === '') return <span className="text-muted">—</span>
  const t = col.type || 'text'
  if (!col.labels && (t === 'number' || t === 'money')) return formatNumber(Number(v))
  if (!col.labels && (t === 'date' || t === 'datetime')) return faDate(String(v), t === 'datetime')
  const d = displayValue(col, v)
  return typeof d === 'string' && /\d/.test(d) && !/[A-Za-z]/.test(d) ? toFaDigits(d) : String(d)
}

const PRINT_WIDTH_PX: Record<string, number> = { 'A4-portrait': 703, 'A4-landscape': 1032, 'A3-portrait': 1032, 'A3-landscape': 1497 }

interface SavedView {
  name: string
  params: Record<string, string>
}
const savedKey = (id: string) => `dt-saved:${id}`
const loadSaved = (id: string): SavedView[] => {
  try {
    const v = JSON.parse(localStorage.getItem(savedKey(id)) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export interface DataTableProps {
  /** stable id (saved filters are stored per table) */
  id: string
  /** title of the exported sheet and the printed page */
  title: string
  columns: TableColumn[]
  rows: Row[]
  rowKey: (r: Row) => string
  /** custom cell renderers (screen only; files and print use the plain text value) */
  render?: Record<string, (r: Row) => ReactNode>
  /** extra trailing column with row actions (never exported or printed) */
  actions?: (r: Row) => ReactNode
  /** fixed option lists for select filters (otherwise the distinct values in the rows) */
  options?: Record<string, { value: string; label: string }[]>
  /** server streaming export endpoint (receives `extraParams` + the table state + format/paper/orientation) */
  exportUrl?: string
  /** the page's own server-side filters, forwarded to `exportUrl` so the file matches the screen */
  extraParams?: Record<string, string | number | boolean | null | undefined>
  empty?: ReactNode
  /** extra controls placed in the toolbar */
  toolbar?: ReactNode
  /** shown under the toolbar when the list was too long to load completely */
  truncated?: boolean
  /** URL parameter prefix when several DataTables share one page (e.g. `req_` → `req_dt_q`); exports still send plain `dt_*` */
  urlPrefix?: string
}

export function DataTable(p: DataTableProps) {
  const [sp, setSp] = useSearchParams()
  const pre = p.urlPrefix || ''
  const st = useMemo(() => {
    if (!pre) return parseTableState(sp, p.columns)
    const own: Record<string, string> = {}
    sp.forEach((v, k) => k.startsWith(pre + 'dt_') && (own[k.slice(pre.length)] = v))
    return parseTableState(own, p.columns)
  }, [sp, p.columns, pre])
  const setState = (next: TableState) =>
    setSp(
      (prev) => {
        const out = new URLSearchParams()
        prev.forEach((v, k) => !k.startsWith(pre + 'dt_') && out.set(k, v))
        for (const [k, v] of Object.entries(tableStateToParams(next))) out.set(pre + k, v)
        return out
      },
      { replace: true }
    )
  const patch = (x: Partial<TableState>) => setState({ ...st, ...x })

  const [q, setQ] = useState(st.q)
  useEffect(() => setQ(st.q), [st.q])
  useEffect(() => {
    if (q === st.q) return
    const t = setTimeout(() => patch({ q }), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const shown = useMemo(() => applyTable(p.rows, p.columns, st), [p.rows, p.columns, st])
  const groups = useMemo(() => groupRows(shown, p.columns, st), [shown, p.columns, st])
  const cols = visibleColumns(p.columns, st)
  const [limit, setLimit] = useState(PAGE)
  useEffect(() => setLimit(PAGE), [st])
  const [panel, setPanel] = useState<null | 'filters' | 'columns' | 'saved' | 'print'>(null)
  const { toast } = useToast()
  const settings = usePublicSettings()
  const university = String(settings?.university_name || '')
  const description = describeState(p.columns, st)

  const optionsFor = (col: TableColumn) => {
    if (p.options?.[col.key]) return p.options[col.key]
    const seen = new Set<string>()
    for (const r of p.rows) for (const v of rawValues(col, r[col.key])) seen.add(v)
    return [...seen].map((v) => ({ value: v, label: col.labels?.[v] ?? v })).sort((a, b) => a.label.localeCompare(b.label, 'fa'))
  }
  const activeFilters = Object.entries(st.filters).filter(([, v]) => (Array.isArray(v) ? v.length : v.from || v.to))
  const setFilter = (key: string, v: string[] | { from?: string; to?: string } | null) => {
    const f = { ...st.filters }
    if (!v || (Array.isArray(v) ? !v.length : !v.from && !v.to)) delete f[key]
    else f[key] = v
    patch({ filters: f })
  }

  const sortBy = (col: TableColumn) => {
    if (col.sortable === false) return
    const cur = st.sort?.key === col.key ? st.sort.dir : null
    patch({ sort: cur === null ? { key: col.key, dir: 'asc' } : cur === 'asc' ? { key: col.key, dir: 'desc' } : null })
  }

  // ── export ──
  const fileStem = `${p.id}-${new Date().toISOString().slice(0, 10)}`
  const exportFile = (format: 'xlsx' | 'csv', paper = 'A4', orientation = '') => {
    if (p.exportUrl) {
      const a = document.createElement('a')
      a.href = p.exportUrl + qs({ ...(p.extraParams || {}), ...tableStateToParams(st), format, paper, orientation: orientation || undefined })
      a.click()
      return
    }
    const ec = exportColumns(p.columns, st)
    const data = shown.map((r) => exportRow(ec, r))
    if (format === 'csv') download(`${fileStem}.csv`, buildCsv(toSheetColumns(ec), data), 'text/csv;charset=utf-8')
    else
      download(
        `${fileStem}.xlsx`,
        buildTableXlsx(toSheetColumns(ec), data, { title: p.title, subtitle: [university, faDate(new Date().toISOString()), description].filter(Boolean).join(' · '), sheetName: p.title, paper: paper as 'A4' | 'A3' }) as unknown as BlobPart,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )
  }

  // ── print ──
  const [print, setPrint] = useState<{ paper: 'A4' | 'A3'; orientation: 'portrait' | 'landscape' } | null>(null)
  const [printOpts, setPrintOpts] = useState<{ paper: 'A4' | 'A3'; orientation: 'portrait' | 'landscape' }>({ paper: 'A4', orientation: cols.length > 6 ? 'landscape' : 'portrait' })
  const printRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!print) return
    const html = document.documentElement
    const style = document.createElement('style')
    style.id = 'dt-page-style'
    style.textContent = `@page { size: ${print.paper} ${print.orientation}; margin: 12mm; @bottom-center { content: "صفحه " counter(page) " از " counter(pages); font-size: 8pt; } }`
    document.head.appendChild(style)
    const el = printRef.current
    let raf = 0
    const done = () => setPrint(null)
    if (el) {
      // automatic scale: measure the table's natural width, shrink it to the printable width of the chosen paper
      el.style.zoom = '1'
      html.classList.add('dt-measuring')
      const natural = (el.querySelector('table') as HTMLTableElement | null)?.scrollWidth || 1
      html.classList.remove('dt-measuring')
      const avail = PRINT_WIDTH_PX[`${print.paper}-${print.orientation}`]
      el.style.zoom = String(Math.max(0.35, Math.min(1, avail / natural)))
    }
    html.classList.add('dt-printing')
    window.addEventListener('afterprint', done, { once: true })
    raf = requestAnimationFrame(() => setTimeout(() => window.print(), 50))
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('afterprint', done)
      html.classList.remove('dt-printing')
      style.remove()
    }
  }, [print])

  const totals = p.columns.some((c) => c.total)
    ? cols.map((c) => {
        if (!c.total) return null
        if (c.total === 'count') return shown.filter((r) => r[c.key] != null && r[c.key] !== '').length
        return shown.reduce((a, r) => a + (Number(r[c.key]) || 0), 0)
      })
    : null

  const sortIcon = (col: TableColumn) =>
    st.sort?.key === col.key ? st.sort.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />

  let rendered = 0
  return (
    <div className="data-table space-y-3" data-table-id={p.id}>
      <div className="no-print flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />
          <input className="input pr-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجو در جدول…" aria-label="جست‌وجو در جدول" />
        </div>
        <Button variant="ghost" icon={<Filter className="size-4" />} onClick={() => setPanel('filters')} aria-label="فیلترها">
          فیلتر{activeFilters.length ? ` (${toFaDigits(activeFilters.length)})` : ''}
        </Button>
        <label className="inline-flex items-center gap-1 text-sm">
          <Layers className="size-4 text-muted" />
          <select className="input !w-auto !py-1.5" value={st.group || ''} onChange={(e) => patch({ group: e.target.value || null })} aria-label="گروه‌بندی">
            <option value="">بدون گروه‌بندی</option>
            {p.columns
              .filter((c) => c.groupable)
              .map((c) => (
                <option key={c.key} value={c.key}>
                  گروه‌بندی: {c.label}
                </option>
              ))}
          </select>
        </label>
        <Button variant="ghost" icon={<Columns3 className="size-4" />} onClick={() => setPanel('columns')} aria-label="ستون‌ها">
          ستون‌ها
        </Button>
        <Button variant="ghost" icon={<Bookmark className="size-4" />} onClick={() => setPanel('saved')} aria-label="فیلترهای ذخیره‌شده">
          ذخیره
        </Button>
        <Button
          variant="ghost"
          icon={<Link2 className="size-4" />}
          aria-label="کپی پیوند همین نما"
          title="کپی پیوند همین نما"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(location.href)
              toast('پیوند این نما کپی شد', 'ok')
            } catch {
              toast(location.href, 'info')
            }
          }}
        />
        <Button variant="ghost" icon={<FileSpreadsheet className="size-4" />} onClick={() => exportFile('xlsx', printOpts.paper, printOpts.orientation)}>
          Excel
        </Button>
        <Button variant="ghost" onClick={() => exportFile('csv')}>
          CSV
        </Button>
        <Button variant="ghost" icon={<Printer className="size-4" />} onClick={() => setPanel('print')}>
          چاپ
        </Button>
        {p.toolbar}
      </div>

      {(activeFilters.length > 0 || st.q || st.sort || st.group || st.cols) && (
        <div className="no-print flex flex-wrap items-center gap-1.5 text-xs">
          {activeFilters.map(([k, v]) => {
            const col = p.columns.find((c) => c.key === k)!
            const text = Array.isArray(v) ? v.map((x) => col.labels?.[x] ?? x).join('، ') : col.filter === 'date' ? `${isoToJalaliText(v.from) || '…'} تا ${isoToJalaliText(v.to) || '…'}` : `${v.from ? toFaDigits(v.from) : '…'} تا ${v.to ? toFaDigits(v.to) : '…'}`
            return (
              <span key={k} className="chip">
                {col.label}: {text}
                <button type="button" aria-label={`حذف فیلتر ${col.label}`} onClick={() => setFilter(k, null)}>
                  <X className="size-3" />
                </button>
              </span>
            )
          })}
          <button type="button" className="chip text-muted" onClick={() => (setQ(''), setState({ q: '', sort: null, group: null, cols: null, filters: {} }))}>
            <RotateCcw className="size-3" /> بازنشانی نما
          </button>
        </div>
      )}

      <div className="no-print text-xs text-muted" aria-live="polite">
        {toFaDigits(shown.length)} ردیف{shown.length !== p.rows.length ? ` از ${toFaDigits(p.rows.length)}` : ''}
        {p.truncated && ' · فهرست بسیار بلند است؛ فقط بخش اول بارگذاری شد — خروجی Excel همهٔ ردیف‌ها را دارد'}
      </div>

      {!shown.length ? (
        p.rows.length ? <Empty title="ردیفی با این فیلترها پیدا نشد" /> : p.empty || <Empty />
      ) : (
        <div className="card overflow-x-auto">
          <table className="dt-table w-full text-sm">
            <thead className="sticky top-0 z-[1] bg-surface-2 text-xs text-muted">
              <tr>
                {cols.map((c) => (
                  <th key={c.key} className="p-3 text-right whitespace-nowrap" aria-sort={st.sort?.key === c.key ? (st.sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.sortable === false ? (
                      c.label
                    ) : (
                      <button type="button" className="inline-flex items-center gap-1 hover:text-text" onClick={() => sortBy(c)}>
                        {c.label} {sortIcon(c)}
                      </button>
                    )}
                  </th>
                ))}
                {p.actions && <th className="p-3" aria-label="عملیات" />}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                if (rendered >= limit) return null
                const slice = g.rows.slice(0, limit - rendered)
                rendered += slice.length
                return [
                  st.group ? (
                    <tr key={`g:${g.label}`} className="dt-group border-t border-line bg-surface-2/60">
                      <td colSpan={cols.length + (p.actions ? 1 : 0)} className="p-2 text-xs font-bold">
                        {g.label} <span className="font-normal text-muted">({toFaDigits(g.rows.length)})</span>
                      </td>
                    </tr>
                  ) : null,
                  ...slice.map((r) => (
                    <tr key={p.rowKey(r)} className="border-t border-line hover:bg-surface-2/50">
                      {cols.map((c) => (
                        <td key={c.key} className="p-3 align-top">
                          {p.render?.[c.key] ? p.render[c.key](r) : renderCell(c, r[c.key])}
                        </td>
                      ))}
                      {p.actions && <td className="p-2 align-top whitespace-nowrap">{p.actions(r)}</td>}
                    </tr>
                  ))
                ]
              })}
            </tbody>
            {totals && (
              <tfoot className="border-t-2 border-line bg-surface-2 text-xs font-bold">
                <tr>
                  {cols.map((c, i) => (
                    <td key={c.key} className="p-3">
                      {totals[i] != null ? formatNumber(totals[i]!) : i === 0 ? `جمع (${toFaDigits(shown.length)} ردیف)` : ''}
                    </td>
                  ))}
                  {p.actions && <td />}
                </tr>
              </tfoot>
            )}
          </table>
          {shown.length > limit && (
            <div className="no-print border-t border-line p-2 text-center">
              <Button variant="ghost" onClick={() => setLimit((n) => n + PAGE)}>
                نمایش {toFaDigits(Math.min(PAGE, shown.length - limit))} ردیف دیگر (از {toFaDigits(shown.length - limit)})
              </Button>
            </div>
          )}
        </div>
      )}

      <FiltersPanel open={panel === 'filters'} onClose={() => setPanel(null)} columns={p.columns} st={st} optionsFor={optionsFor} setFilter={setFilter} />
      <ColumnsPanel open={panel === 'columns'} onClose={() => setPanel(null)} columns={p.columns} st={st} patch={patch} />
      <SavedPanel open={panel === 'saved'} onClose={() => setPanel(null)} id={p.id} st={st} apply={(params) => setState(parseTableState(params, p.columns))} />
      <Modal
        open={panel === 'print'}
        onClose={() => setPanel(null)}
        title="چاپ جدول"
        footer={
          <Button icon={<Printer className="size-4" />} onClick={() => (setPanel(null), setPrint({ ...printOpts }))}>
            چاپ
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="label">اندازهٔ کاغذ</span>
            <select className="input" value={printOpts.paper} onChange={(e) => setPrintOpts((o) => ({ ...o, paper: e.target.value as 'A4' | 'A3' }))}>
              <option value="A4">A4</option>
              <option value="A3">A3</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="label">جهت</span>
            <select className="input" value={printOpts.orientation} onChange={(e) => setPrintOpts((o) => ({ ...o, orientation: e.target.value as 'portrait' | 'landscape' }))}>
              <option value="portrait">عمودی</option>
              <option value="landscape">افقی</option>
            </select>
          </label>
        </div>
        <p className="mt-3 text-xs text-muted">
          همین {toFaDigits(shown.length)} ردیف با همین ترتیب چاپ می‌شود؛ سرستون در هر صفحه تکرار می‌شود، ردیف‌ها نمی‌شکنند و جدول خودکار به عرض کاغذ کوچک می‌شود. اندازه و جهت انتخاب‌شده برای خروجی Excel هم به کار می‌رود.
        </p>
      </Modal>

      {print &&
        createPortal(
          <div className="dt-print" ref={printRef} dir="rtl">
            <header className="dt-print-head">
              <div className="dt-print-uni">{university}</div>
              <h1>{p.title}</h1>
              <div className="dt-print-meta">
                {faDate(new Date().toISOString(), true)} · {toFaDigits(shown.length)} ردیف · {description}
              </div>
            </header>
            <table>
              <thead>
                <tr>
                  {exportColumns(p.columns, st).map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => [
                  st.group ? (
                    <tr key={`pg:${g.label}`} className="dt-print-group">
                      <td colSpan={exportColumns(p.columns, st).length}>
                        {g.label} ({toFaDigits(g.rows.length)})
                      </td>
                    </tr>
                  ) : null,
                  ...g.rows.map((r) => (
                    <tr key={p.rowKey(r)}>
                      {exportColumns(p.columns, st).map((c) => (
                        <td key={c.key}>{renderCell(c, r[c.key])}</td>
                      ))}
                    </tr>
                  ))
                ])}
              </tbody>
              {totals && (
                <tfoot>
                  <tr>
                    {exportColumns(p.columns, st).map((c, i) => {
                      const ti = cols.findIndex((x) => x.key === c.key)
                      return <td key={c.key}>{ti >= 0 && totals[ti] != null ? formatNumber(totals[ti]!) : i === 0 ? `جمع (${toFaDigits(shown.length)} ردیف)` : ''}</td>
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>,
          document.body
        )}
    </div>
  )
}

// ── panels ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function FiltersPanel({
  open,
  onClose,
  columns,
  st,
  optionsFor,
  setFilter
}: {
  open: boolean
  onClose: () => void
  columns: TableColumn[]
  st: TableState
  optionsFor: (c: TableColumn) => { value: string; label: string }[]
  setFilter: (key: string, v: string[] | { from?: string; to?: string } | null) => void
}) {
  const presets = useMemo(() => jalaliPresets(), [])
  return (
    <Modal open={open} onClose={onClose} title="فیلترهای ترکیبی" wide footer={<Button onClick={onClose}>نمایش نتیجه</Button>}>
      <div className="space-y-4">
        {columns
          .filter((c) => c.filter)
          .map((c) => {
            const cur = st.filters[c.key]
            if (c.filter === 'select') {
              const sel = new Set(Array.isArray(cur) ? cur : [])
              const opts = optionsFor(c)
              return (
                <fieldset key={c.key}>
                  <legend className="label">{c.label}</legend>
                  {!opts.length ? (
                    <p className="text-xs text-muted">مقداری برای انتخاب نیست</p>
                  ) : (
                    <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                      {opts.map((o) => (
                        <label key={o.value} className={cx('chip cursor-pointer', sel.has(o.value) && 'border-brand bg-brand-soft text-brand')}>
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={sel.has(o.value)}
                            onChange={() => {
                              const n = new Set(sel)
                              if (n.has(o.value)) n.delete(o.value)
                              else n.add(o.value)
                              setFilter(c.key, [...n])
                            }}
                          />
                          {o.label}
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>
              )
            }
            const range = cur && !Array.isArray(cur) ? cur : {}
            if (c.filter === 'number')
              return (
                <fieldset key={c.key}>
                  <legend className="label">{c.label}</legend>
                  <div className="flex items-center gap-2">
                    <input className="input" inputMode="numeric" placeholder="از" defaultValue={range.from ? toFaDigits(range.from) : ''} onBlur={(e) => setFilter(c.key, { ...range, from: toEnDigits(e.target.value.trim()) || undefined })} aria-label={`${c.label} از`} />
                    <span className="text-muted">تا</span>
                    <input className="input" inputMode="numeric" placeholder="تا" defaultValue={range.to ? toFaDigits(range.to) : ''} onBlur={(e) => setFilter(c.key, { ...range, to: toEnDigits(e.target.value.trim()) || undefined })} aria-label={`${c.label} تا`} />
                  </div>
                </fieldset>
              )
            return (
              <fieldset key={c.key}>
                <legend className="label">{c.label} (تاریخ شمسی)</legend>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="input !w-auto"
                    value=""
                    onChange={(e) => {
                      const pr = presets.find((x) => x.key === e.target.value)
                      if (pr) setFilter(c.key, { from: pr.from, to: pr.to })
                    }}
                    aria-label={`بازهٔ آمادهٔ ${c.label}`}
                  >
                    <option value="">بازهٔ آماده…</option>
                    {presets.map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                  <JalaliInput label={`${c.label} از`} value={range.from} onChange={(v) => setFilter(c.key, { ...range, from: v || undefined })} />
                  <span className="text-muted">تا</span>
                  <JalaliInput label={`${c.label} تا`} value={range.to} onChange={(v) => setFilter(c.key, { ...range, to: v || undefined })} />
                </div>
              </fieldset>
            )
          })}
      </div>
    </Modal>
  )
}

function JalaliInput({ label, value, onChange }: { label: string; value?: string; onChange: (iso: string | null) => void }) {
  const [text, setText] = useState(isoToJalaliText(value))
  const [bad, setBad] = useState(false)
  useEffect(() => setText(isoToJalaliText(value)), [value])
  return (
    <input
      className={cx('input !w-36 text-center', bad && '!border-danger')}
      dir="ltr"
      placeholder="۱۴۰۵/۰۷/۰۱"
      aria-label={label}
      aria-invalid={bad || undefined}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (!text.trim()) return (setBad(false), onChange(null))
        const iso = jalaliTextToIso(text)
        setBad(!iso)
        if (iso) onChange(iso)
      }}
    />
  )
}

function ColumnsPanel({ open, onClose, columns, st, patch }: { open: boolean; onClose: () => void; columns: TableColumn[]; st: TableState; patch: (x: Partial<TableState>) => void }) {
  const order = st.cols || columns.filter((c) => !c.hidden).map((c) => c.key)
  const rest = columns.filter((c) => !order.includes(c.key)).map((c) => c.key)
  const label = (k: string) => columns.find((c) => c.key === k)?.label || k
  const move = (i: number, d: number) => {
    const n = [...order]
    const j = i + d
    if (j < 0 || j >= n.length) return
    ;[n[i], n[j]] = [n[j], n[i]]
    patch({ cols: n })
  }
  return (
    <Modal open={open} onClose={onClose} title="ستون‌های قابل نمایش و خروجی" footer={<Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => patch({ cols: null })}>پیش‌فرض</Button>}>
      <p className="mb-2 text-xs text-muted">ستون‌های انتخاب‌شده با همین ترتیب در صفحه، خروجی Excel/CSV و چاپ می‌آیند.</p>
      <ul className="divide-y divide-line text-sm">
        {order.map((k, i) => (
          <li key={k} className="flex items-center gap-2 py-1.5">
            <input type="checkbox" checked onChange={() => order.length > 1 && patch({ cols: order.filter((x) => x !== k) })} aria-label={`نمایش ${label(k)}`} />
            <span className="flex-1">{label(k)}</span>
            <button type="button" className="rounded p-1 hover:bg-surface-2" onClick={() => move(i, -1)} aria-label={`بالا بردن ${label(k)}`}>
              <ChevronUp className="size-4" />
            </button>
            <button type="button" className="rounded p-1 hover:bg-surface-2" onClick={() => move(i, 1)} aria-label={`پایین بردن ${label(k)}`}>
              <ChevronDown className="size-4" />
            </button>
          </li>
        ))}
        {rest.map((k) => (
          <li key={k} className="flex items-center gap-2 py-1.5 text-muted">
            <input type="checkbox" checked={false} onChange={() => patch({ cols: [...order, k] })} aria-label={`نمایش ${label(k)}`} />
            <span className="flex-1">{label(k)}</span>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

function SavedPanel({ open, onClose, id, st, apply }: { open: boolean; onClose: () => void; id: string; st: TableState; apply: (params: Record<string, string>) => void }) {
  const [list, setList] = useState<SavedView[]>([])
  const [name, setName] = useState('')
  useEffect(() => {
    if (open) setList(loadSaved(id))
  }, [open, id])
  const persist = (l: SavedView[]) => {
    setList(l)
    try {
      localStorage.setItem(savedKey(id), JSON.stringify(l))
    } catch {
      /* storage full or disabled */
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="فیلترهای ذخیره‌شده">
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const n = name.trim()
          if (!n) return
          persist([{ name: n, params: tableStateToParams(st) }, ...list.filter((x) => x.name !== n)].slice(0, 30))
          setName('')
        }}
      >
        <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="نام این نما (مثلاً «دانشجویان ورودی ۱۴۰۲»)" aria-label="نام نمای ذخیره‌شده" />
        <Button type="submit" disabled={!name.trim()}>
          ذخیره
        </Button>
      </form>
      {!list.length ? (
        <p className="text-sm text-muted">هنوز نمایی ذخیره نشده است. فیلتر، مرتب‌سازی، گروه‌بندی و ستون‌ها با هم ذخیره می‌شوند.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {list.map((v) => (
            <li key={v.name} className="flex items-center gap-2 py-2">
              <button type="button" className="flex-1 text-right font-medium hover:text-brand" onClick={() => (apply(v.params), onClose())}>
                {v.name}
              </button>
              <button type="button" className="rounded p-1 text-muted hover:bg-surface-2" aria-label={`حذف ${v.name}`} onClick={() => persist(list.filter((x) => x.name !== v.name))}>
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

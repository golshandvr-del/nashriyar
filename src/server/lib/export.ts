// Server-side streaming table export (ROADMAP phase 18).
// A list endpoint exposes its query as `fetchPage(cursor)` (the same keyset query the screen uses); this helper walks
// every page, applies the table state from the URL (`dt_*`: filters, search, sort, grouping, visible columns — the
// exact state of the on-screen DataTable, via the shared model in src/shared/table.ts) and streams an XLSX or CSV.
//  - No sort/group: rows go from the database to the client page by page; memory stays bounded by one page.
//  - Sort or group requested: the filtered rows must be ordered first, so they are buffered (capped at MAX_ROWS) and
//    then written out in batches — still streamed to the client, and the same comparator as the screen.
// Query: ?format=xlsx|csv  &paper=A4|A3  &orientation=portrait|landscape  &dt_*…
import type { Context } from 'hono'
import type { AppEnv } from '../context'
import { buildCsv, csvHeader, csvLine, streamTableXlsx } from '../../shared/sheet'
import { applyTable, describeState, exportColumns, exportRow, parseTableState, rowPredicate, toSheetColumns, type Row, type TableColumn } from '../../shared/table'
import { faDate } from '../../shared/fa'
import { HttpError } from './errors'
import { getSetting } from './util'

export const MAX_ROWS = 200_000
const BATCH = 500
const enc = new TextEncoder()

export interface ExportSpec {
  /** file name stem (ASCII) */
  name: string
  /** sheet title shown above the table */
  title: string
  columns: TableColumn[]
  /** one page of the endpoint's own query; `next_cursor: null` ends the walk */
  fetchPage: (cursor: string | null) => Promise<{ rows: Row[]; next_cursor: string | null }>
}

const asciiName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'export'

/** Walks every page of the endpoint, yielding the rows that pass the table's filters and search. */
async function* filteredPages(spec: ExportSpec, keep: (r: Row) => boolean): AsyncGenerator<Row[]> {
  let cursor: string | null = null
  let seen = 0
  for (let guard = 0; guard < 100_000; guard++) {
    const page: { rows: Row[]; next_cursor: string | null } = await spec.fetchPage(cursor)
    seen += page.rows.length
    if (seen > MAX_ROWS * 5) throw new HttpError(413, 'حجم داده برای خروجی بیش از حد است؛ فیلتر محدودتری انتخاب کنید', 'export_too_large')
    const rows = page.rows.filter(keep)
    if (rows.length) yield rows
    if (!page.next_cursor || page.next_cursor === cursor) return
    cursor = page.next_cursor
  }
}

export async function streamExport(c: Context<AppEnv>, spec: ExportSpec): Promise<Response> {
  const q = c.req.query()
  const st = parseTableState(q, spec.columns)
  const format = q.format === 'csv' ? 'csv' : 'xlsx'
  const cols = exportColumns(spec.columns, st)
  const sheetCols = toSheetColumns(cols)
  const university = await getSetting(c.get('db'), 'university_name', 'دانشگاه').catch(() => 'دانشگاه')
  const subtitle = `${university} · ${faDate(new Date().toISOString())} · ${describeState(spec.columns, st)}`
  const keep = rowPredicate(spec.columns, st)
  const ordered = !!(st.sort || st.group)

  // batches of export-ready rows, in screen order
  async function* batches(): AsyncGenerator<Row[]> {
    if (!ordered) {
      for await (const rows of filteredPages(spec, keep)) yield rows.map((r) => exportRow(cols, r))
      return
    }
    const all: Row[] = []
    for await (const rows of filteredPages(spec, keep)) {
      for (const r of rows) all.push(r)
      if (all.length > MAX_ROWS) throw new HttpError(413, `خروجی مرتب‌شده حداکثر ${MAX_ROWS.toLocaleString('fa-IR')} ردیف است؛ فیلتر محدودتری انتخاب کنید`, 'export_too_large')
    }
    // filters already applied; applyTable re-checks them (cheap) and sorts/groups with the screen's comparator
    const sorted = applyTable(all, spec.columns, st)
    for (let i = 0; i < sorted.length; i += BATCH) yield sorted.slice(i, i + BATCH).map((r) => exportRow(cols, r))
  }

  const it = batches()
  // the first batch is pulled before the response starts, so validation/permission errors still become a JSON error
  const first = await it.next()
  const stamp = new Date().toISOString().slice(0, 10)
  const file = `${asciiName(spec.name)}-${stamp}.${format}`
  const headers = {
    'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${file}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }

  if (format === 'csv' && first.done) return new Response(buildCsv(sheetCols, []), { headers })

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  const pump = async () => {
    try {
      if (format === 'csv') {
        await writer.write(enc.encode('\uFEFF' + csvHeader(sheetCols) + '\r\n'))
        let batch: IteratorResult<Row[]> = first
        while (!batch.done) {
          await writer.write(enc.encode(batch.value.map((r) => csvLine(sheetCols, r) + '\r\n').join('')))
          batch = await it.next()
        }
      } else {
        let pending: IteratorResult<Row[]> | null = first
        const chunks: Promise<void>[] = []
        await streamTableXlsx(
          sheetCols,
          { title: spec.title, subtitle, sheetName: spec.title, paper: q.paper === 'A3' ? 'A3' : 'A4', orientation: q.orientation === 'landscape' ? 'landscape' : q.orientation === 'portrait' ? 'portrait' : undefined },
          async () => {
            const b: IteratorResult<Row[]> = pending ?? (await it.next())
            pending = null
            return b.done ? [] : b.value
          },
          (chunk) => {
            chunks.push(writer.write(chunk))
          }
        )
        await Promise.all(chunks)
      }
      await writer.close()
    } catch (e) {
      // headers are already sent: abort the stream so the client sees a failed (not a truncated-but-valid) download
      await writer.abort(e).catch(() => {})
    }
  }
  pump()
  return new Response(readable, { headers })
}

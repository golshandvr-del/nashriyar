// Presentation-grade table export (ROADMAP phase 18), shared by the browser (DataTable) and the server (streaming export).
//  - Real XLSX: column widths sized to the Persian content, wrapped text + row heights, bold frozen header row,
//    Excel autofilter, right-to-left sheet, Jalali dates, a totals row (SUBTOTAL ⇒ follows Excel's own filter),
//    print setup (A4/A3, orientation, fit-to-width, header row repeated on every page, «صفحه N از M» footer).
//  - CSV with a UTF-8 BOM (opens correctly in Excel) and formula-injection protection.
// The writer is incremental (head → row… → tail) so the server can stream very large exports through ZipStream.
import { toFaDigits, isoToJalali } from './fa'
import { ZipStream, zipStore } from './zip'

export type ColType = 'text' | 'number' | 'money' | 'date' | 'datetime'
export interface SheetColumn {
  key: string
  label: string
  type?: ColType
  /** totals row: sum of numbers, or count of non-empty cells */
  total?: 'sum' | 'count'
  /** fixed width in Excel character units (otherwise sized from the content) */
  width?: number
}
export interface SheetOptions {
  title?: string
  /** second line under the title: filters, date, university letterhead… */
  subtitle?: string
  sheetName?: string
  paper?: 'A4' | 'A3'
  orientation?: 'portrait' | 'landscape'
}
export type Row = Record<string, unknown>

const enc = new TextEncoder()
const MIN_W = 6
const MAX_W = 50

// ── cell values ─────────────────────────────────────────────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0')
/** ISO timestamp/date → Jalali «۱۴۰۵/۰۸/۱۰» (or with « ۱۴:۰۵» for datetime). Non-dates pass through as text. */
export function jalaliCell(v: unknown, withTime = false): string {
  if (v == null || v === '') return ''
  const s = String(v)
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  if (Number.isNaN(d.getTime())) return s
  const j = isoToJalali(d.toISOString())
  const base = `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`
  return toFaDigits(withTime ? `${base} ${pad(d.getHours())}:${pad(d.getMinutes())}` : base)
}

/** The value exactly as it is written to a cell / CSV field: numbers stay numbers, dates become Jalali text. */
export function cellValue(col: SheetColumn, v: unknown): string | number | null {
  if (v == null || v === '') return null
  const t = col.type || 'text'
  if (t === 'number' || t === 'money') {
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[,٬]/g, ''))
    return Number.isFinite(n) ? n : String(v)
  }
  if (t === 'date' || t === 'datetime') return jalaliCell(v, t === 'datetime')
  if (typeof v === 'boolean') return v ? 'بله' : 'خیر'
  if (Array.isArray(v)) return v.join('، ')
  return String(v)
}

// ── CSV ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** RFC-4180 field; text that a spreadsheet would run as a formula (=, +, @, tab, CR, or «-» + non-digit) is neutralised. */
export function csvField(v: string | number | null): string {
  if (v == null) return ''
  if (typeof v === 'number') return String(v)
  let s = v
  if (/^[=+@\t\r]/.test(s) || /^-[^\d.]/.test(s)) s = "'" + s
  return /[",\n\r]/.test(s) || s !== v ? `"${s.replace(/"/g, '""')}"` : s
}
export const csvLine = (cols: SheetColumn[], r: Row) => cols.map((c) => csvField(cellValue(c, r[c.key]))).join(',')
export const csvHeader = (cols: SheetColumn[]) => cols.map((c) => csvField(c.label)).join(',')
/** Whole CSV text with a UTF-8 BOM (Excel then detects UTF-8 and shows Persian correctly). */
export function buildCsv(cols: SheetColumn[], rows: Row[]): string {
  return '\ufeff' + [csvHeader(cols), ...rows.map((r) => csvLine(cols, r))].join('\r\n') + '\r\n'
}

// ── XLSX ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const xmlSafe = (s: string) => {
  let out = ''
  for (const ch of s) {
    const n = ch.charCodeAt(0)
    if (n >= 0x20 || n === 0x09 || n === 0x0a || n === 0x0d) out += ch
  }
  return out
}
export const xmlEsc = (s: string) => xmlSafe(s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!))

export function colName(i: number): string {
  let s = ''
  i++
  while (i > 0) {
    const m = (i - 1) % 26
    s = String.fromCharCode(65 + m) + s
    i = Math.floor((i - 1) / 26)
  }
  return s
}

const displayLen = (v: string | number | null) => (v == null ? 0 : typeof v === 'number' ? v.toLocaleString('en-US').length : Math.max(...v.split('\n').map((l) => l.length)))

/** Column widths (Excel character units) from the header and a sample of rows; long text wraps at MAX_W. */
export function columnWidths(cols: SheetColumn[], sample: Row[]): number[] {
  return cols.map((c) => {
    if (c.width) return c.width
    let w = c.label.length + 2 // header is bold + carries the autofilter arrow
    for (const r of sample) w = Math.max(w, displayLen(cellValue(c, r[c.key])))
    return Math.round(Math.min(MAX_W, Math.max(MIN_W, w * 1.15 + 2)))
  })
}

// cellXfs indices in STYLES (keep in sync)
const S = { header: 1, text: 2, num: 3, totalLabel: 4, totalNum: 5, title: 6, subtitle: 7 } as const
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="4"><font><sz val="11"/><name val="Tahoma"/><family val="2"/></font><font><b/><sz val="11"/><name val="Tahoma"/><family val="2"/></font><font><b/><sz val="14"/><name val="Tahoma"/><family val="2"/></font><font><sz val="10"/><color rgb="FF555555"/><name val="Tahoma"/><family val="2"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF0"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3EBD6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFB7C3C7"/></left><right style="thin"><color rgb="FFB7C3C7"/></right><top style="thin"><color rgb="FFB7C3C7"/></top><bottom style="thin"><color rgb="FFB7C3C7"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top" wrapText="1" readingOrder="2"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf><xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf><xf numFmtId="3" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
const WB_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`

export const safeSheetName = (n?: string) => (n || 'Sheet1').replace(/[\\/?*[\]:']/g, ' ').trim().slice(0, 31) || 'Sheet1'

/**
 * Incremental worksheet writer. Widths are fixed up front from `sample` (the first rows), so rows can be streamed.
 * head() → row(r)… → tail(); then workbookXml() (needs the final row count for the autofilter / print names).
 */
export class SheetWriter {
  readonly widths: number[]
  readonly headerRow: number
  private r: number
  private sums: number[]
  private counts: number[]
  constructor(readonly cols: SheetColumn[], readonly opts: SheetOptions = {}, sample: Row[] = []) {
    this.widths = columnWidths(cols, sample)
    this.headerRow = (opts.title ? 1 : 0) + (opts.subtitle ? 1 : 0) + 1
    this.r = this.headerRow
    this.sums = cols.map(() => 0)
    this.counts = cols.map(() => 0)
  }
  get hasTotals() {
    return this.cols.some((c) => c.total)
  }
  get dataRows() {
    return this.r - this.headerRow
  }
  private get lastCol() {
    return colName(this.cols.length - 1)
  }
  private textCell(ref: string, s: string, style: number) {
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(s)}</t></is></c>`
  }
  head(): string {
    const n = this.cols.length
    const cols = this.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')
    let rows = ''
    let ri = 0
    if (this.opts.title) rows += `<row r="${++ri}" ht="26" customHeight="1">${this.textCell(`A${ri}`, this.opts.title, S.title)}</row>`
    if (this.opts.subtitle) rows += `<row r="${++ri}" ht="20" customHeight="1">${this.textCell(`A${ri}`, this.opts.subtitle, S.subtitle)}</row>`
    const hdrLines = Math.max(...this.cols.map((c, i) => Math.ceil((c.label.length + 2) / Math.max(1, this.widths[i] - 1))))
    rows += `<row r="${this.headerRow}"${hdrLines > 1 ? ` ht="${hdrLines * 15 + 4}" customHeight="1"` : ''}>${this.cols.map((c, i) => this.textCell(`${colName(i)}${this.headerRow}`, c.label, S.header)).join('')}</row>`
    const pane = `<pane ySplit="${this.headerRow}" topLeftCell="A${this.headerRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${this.headerRow + 1}" sqref="A${this.headerRow + 1}"/>`
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${colName(n - 1)}${this.headerRow}"/><sheetViews><sheetView workbookViewId="0" rightToLeft="1">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${rows}`
  }
  row(rec: Row): string {
    const ri = ++this.r
    let lines = 1
    const cells = this.cols
      .map((c, i) => {
        const v = cellValue(c, rec[c.key])
        if (v == null) return ''
        this.counts[i]++
        const ref = `${colName(i)}${ri}`
        if (typeof v === 'number') {
          this.sums[i] += v
          return `<c r="${ref}" s="${S.num}"><v>${v}</v></c>`
        }
        const per = Math.max(1, this.widths[i] - 1)
        lines = Math.max(lines, v.split('\n').reduce((a, l) => a + Math.max(1, Math.ceil(l.length / per)), 0))
        return this.textCell(ref, v, S.text)
      })
      .join('')
    return `<row r="${ri}"${lines > 1 ? ` ht="${Math.min(409, lines * 15 + 3)}" customHeight="1"` : ''}>${cells}</row>`
  }
  tail(): string {
    const n = this.cols.length
    const first = this.headerRow + 1
    const last = Math.max(this.r, first)
    let total = ''
    if (this.hasTotals) {
      const tr = this.r + 1
      const labelAt = this.cols.findIndex((c) => !c.total)
      total = `<row r="${tr}" ht="20" customHeight="1">${this.cols
        .map((c, i) => {
          const ref = `${colName(i)}${tr}`
          if (!c.total) return i === labelAt ? this.textCell(ref, `جمع (${toFaDigits(this.dataRows)} ردیف)`, S.totalLabel) : `<c r="${ref}" s="${S.totalLabel}"/>`
          const range = `${colName(i)}${first}:${colName(i)}${last}`
          const fn = c.total === 'sum' ? 109 : 103
          const val = c.total === 'sum' ? Math.round(this.sums[i] * 100) / 100 : this.counts[i]
          return `<c r="${ref}" s="${S.totalNum}"><f>SUBTOTAL(${fn},${range})</f><v>${val}</v></c>`
        })
        .join('')}</row>`
    }
    const merges = [this.opts.title ? 1 : 0, this.opts.subtitle ? (this.opts.title ? 2 : 1) : 0].filter(Boolean).map((r) => `<mergeCell ref="A${r}:${this.lastCol}${r}"/>`)
    const paper = this.opts.paper === 'A3' ? 8 : 9
    const orient = this.opts.orientation || (n > 6 ? 'landscape' : 'portrait')
    const name = xmlEsc(this.opts.title || safeSheetName(this.opts.sheetName))
    return (
      `${total}</sheetData><autoFilter ref="A${this.headerRow}:${this.lastCol}${last}"/>` +
      (merges.length ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : '') +
      `<printOptions horizontalCentered="1"/><pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>` +
      `<pageSetup paperSize="${paper}" orientation="${orient}" fitToWidth="1" fitToHeight="0"/>` +
      `<headerFooter><oddHeader>&amp;C${name}</oddHeader><oddFooter>&amp;Cصفحه &amp;P از &amp;N&amp;R&amp;D</oddFooter></headerFooter></worksheet>`
    )
  }
  workbookXml(): string {
    const sn = safeSheetName(this.opts.sheetName)
    const q = `'${xmlEsc(sn)}'`
    const last = Math.max(this.r, this.headerRow + 1)
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView rightToLeft="1"/></bookViews><sheets><sheet name="${xmlEsc(sn)}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${q}!$A$${this.headerRow}:$${this.lastCol}$${last}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">${q}!$${this.headerRow}:$${this.headerRow}</definedName></definedNames></workbook>`
  }
}

/** Static package parts (everything except the worksheet and workbook). */
export const STATIC_PARTS: { name: string; xml: string }[] = [
  { name: '[Content_Types].xml', xml: CONTENT_TYPES },
  { name: '_rels/.rels', xml: ROOT_RELS },
  { name: 'xl/_rels/workbook.xml.rels', xml: WB_RELS },
  { name: 'xl/styles.xml', xml: STYLES }
]

/** In-memory XLSX for a fully loaded table (client-side exports). */
export function buildTableXlsx(cols: SheetColumn[], rows: Row[], opts: SheetOptions = {}): Uint8Array {
  const w = new SheetWriter(cols, opts, rows.slice(0, 1000))
  let sheet = w.head()
  for (const r of rows) sheet += w.row(r)
  sheet += w.tail()
  return zipStore([...STATIC_PARTS, { name: 'xl/worksheets/sheet1.xml', xml: sheet }, { name: 'xl/workbook.xml', xml: w.workbookXml() }].map((f) => ({ name: f.name, data: enc.encode(f.xml) })))
}

/**
 * Streaming XLSX: rows arrive in batches from `next()` (empty batch = done) and leave as ZIP chunks immediately.
 * Column widths come from the first batch. Memory stays bounded by one batch whatever the table size.
 */
export async function streamTableXlsx(cols: SheetColumn[], opts: SheetOptions, next: () => Promise<Row[]>, emit: (chunk: Uint8Array) => void): Promise<number> {
  const zip = new ZipStream(emit)
  for (const p of STATIC_PARTS) {
    zip.begin(p.name)
    zip.write(p.xml)
  }
  let batch = await next()
  const w = new SheetWriter(cols, opts, batch)
  zip.begin('xl/worksheets/sheet1.xml')
  zip.write(w.head())
  while (batch.length) {
    let buf = ''
    for (const r of batch) buf += w.row(r)
    zip.write(buf)
    batch = await next()
  }
  zip.write(w.tail())
  zip.begin('xl/workbook.xml') // after the rows: the autofilter / print-title names need the final row count
  zip.write(w.workbookXml())
  zip.finish()
  return w.dataRows
}

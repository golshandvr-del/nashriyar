// Dependency-free XLSX writer (ROADMAP phase 8: Excel export for every table/chart).
// Builds a minimal Office Open XML workbook (one RTL sheet, inline strings, numeric cells)
// inside an uncompressed ("stored") ZIP — a few KB of code instead of a 400 KB library.

import { zipStore } from '../../shared/zip'

export { zipStore }
const enc = new TextEncoder()

// XML 1.0 forbids C0 control characters except TAB, LF and CR: drop them (char-code filter, no control-char regex)
const xmlSafe = (s: string) => {
  let out = ''
  for (const ch of s) {
    const n = ch.charCodeAt(0)
    if (n >= 0x20 || n === 0x09 || n === 0x0a || n === 0x0d) out += ch
  }
  return out
}
const xmlEsc = (s: string) => xmlSafe(s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!))

function colName(i: number): string {
  let s = ''
  i++
  while (i > 0) {
    const m = (i - 1) % 26
    s = String.fromCharCode(65 + m) + s
    i = Math.floor((i - 1) / 26)
  }
  return s
}

/** Build an .xlsx (bytes) from a 2-D array; the first row is treated as the header (bold not needed). */
export function buildXlsx(rows: unknown[][], sheetName = 'Sheet1'): Uint8Array {
  const body = rows
    .map((r, ri) => {
      const cells = r
        .map((v, ci) => {
          const ref = `${colName(ci)}${ri + 1}`
          if (v === null || v === undefined || v === '') return ''
          if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`
          const str = String(v)
          if (ri > 0 && /^-?\d+(\.\d+)?$/.test(str) && str.length < 16) return `<c r="${ref}"><v>${str}</v></c>`
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(str)}</t></is></c>`
        })
        .join('')
      return `<row r="${ri + 1}">${cells}</row>`
    })
    .join('')
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" rightToLeft="1"/></sheetViews><sheetData>${body}</sheetData></worksheet>`
  const safeName = xmlEsc(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1')
  const files = [
    {
      name: '[Content_Types].xml',
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
    },
    {
      name: '_rels/.rels',
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    },
    {
      name: 'xl/workbook.xml',
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets></workbook>`
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
    },
    { name: 'xl/worksheets/sheet1.xml', xml: sheet }
  ]
  return zipStore(files.map((f) => ({ name: f.name, data: enc.encode(f.xml) })))
}

/** RFC-4180 CSV → rows (handles quotes, escaped quotes, newlines inside quotes, optional BOM). */
export function csvToRows(csv: string): string[][] {
  const s = csv.replace(/^\ufeff/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"'
          i++
        } else q = false
      } else cell += ch
    } else if (ch === '"') q = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

export function downloadXlsx(name: string, rows: unknown[][]) {
  const bytes = buildXlsx(rows, name)
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${name}.xlsx`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** Convenience: every existing CSV export can also be offered as Excel. */
export const downloadXlsxFromCsv = (name: string, csv: string) => downloadXlsx(name, csvToRows(csv))

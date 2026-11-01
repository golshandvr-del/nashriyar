// Dependency-free EPUB 3 builder (ROADMAP phase 19 — reflowable text editions for mobile reading).
// Input: issue metadata + the text layer of each page (issue_pages.text_content) + optional TOC.
// Output: a valid EPUB 3 container (zip "stored"; `mimetype` first and uncompressed as the spec requires),
// right-to-left page progression, one XHTML document per page, nav.xhtml with the TOC and a page list.
import { zipStore } from './zip'

export interface EpubInput {
  id: string // stable identifier (urn:nashriyar:<issue id>)
  title: string
  publication: string
  number: number
  lang?: string // default 'fa'
  date?: string | null // ISO
  description?: string | null
  authors?: string[]
  pages: { n: number; text: string }[]
  toc?: { title: string; page: number | null }[]
  modified?: string // ISO; defaults to now
}

const enc = new TextEncoder()

export function xmlEsc(s: string): string {
  // strip characters that are illegal in XML 1.0, then escape
  return String(s ?? '')
    .replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Splits a page's raw text layer into paragraphs (blank lines; otherwise sentence-ish line joins). */
export function paragraphs(text: string): string[] {
  const t = String(text || '').replace(/\r\n?/g, '\n').trim()
  if (!t) return []
  const blocks = t.split(/\n\s*\n/)
  const out: string[] = []
  for (const b of blocks) {
    // pdftotext breaks lines at the column edge: join lines inside a block
    const joined = b.split('\n').map((l) => l.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
    if (joined) out.push(joined)
  }
  return out
}

const pageFile = (n: number) => `p${String(n).padStart(4, '0')}.xhtml`

function xhtml(lang: string, title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}" dir="rtl">
<head><meta charset="UTF-8"/><title>${xmlEsc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body dir="rtl">
${body}
</body>
</html>
`
}

const CSS = `body{direction:rtl;text-align:justify;font-family:Vazirmatn,Tahoma,serif;line-height:1.9;margin:0 4%}
h1,h2{line-height:1.4}h1{font-size:1.5em}h2{font-size:1.1em;color:#555;margin-top:2em}
p{margin:0 0 .8em;text-indent:1em}.meta{color:#555;text-indent:0}.empty{color:#888;font-style:italic;text-indent:0}
nav ol{list-style:none;padding:0}nav li{margin:.3em 0}`

export function buildEpub(input: EpubInput): Uint8Array {
  const lang = input.lang || 'fa'
  const modified = (input.modified || new Date().toISOString()).replace(/\.\d+Z$/, 'Z')
  const pages = [...input.pages].sort((a, b) => a.n - b.n)
  const files: { name: string; data: Uint8Array }[] = []
  const add = (name: string, s: string) => files.push({ name, data: enc.encode(s) })

  add('mimetype', 'application/epub+zip')
  add(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`
  )
  add('OEBPS/style.css', CSS)

  const fullTitle = `${input.publication} — شمارهٔ ${input.number}: ${input.title}`
  add(
    'OEBPS/title.xhtml',
    xhtml(
      lang,
      fullTitle,
      `<section epub:type="titlepage"><h1>${xmlEsc(input.title)}</h1>
<p class="meta">${xmlEsc(input.publication)} · شمارهٔ ${input.number}${input.date ? ` · ${xmlEsc(input.date.slice(0, 10))}` : ''}</p>
${input.description ? `<p>${xmlEsc(input.description)}</p>` : ''}
<p class="meta">نسخهٔ متنی بازچینی‌پذیر، ساخته‌شده از لایهٔ متنی صفحه‌ها؛ برای صفحه‌آرایی و تصاویر نسخهٔ اصلی را ببینید.</p></section>`
    )
  )
  for (const p of pages) {
    const paras = paragraphs(p.text)
    add(
      `OEBPS/${pageFile(p.n)}`,
      xhtml(
        lang,
        `صفحهٔ ${p.n}`,
        `<section><span epub:type="pagebreak" id="page${p.n}" title="${p.n}"></span><h2>صفحهٔ ${p.n}</h2>
${paras.length ? paras.map((t) => `<p>${xmlEsc(t)}</p>`).join('\n') : '<p class="empty">این صفحه متنی ندارد (احتمالاً تصویر یا جلد).</p>'}</section>`
      )
    )
  }
  const pageSet = new Set(pages.map((p) => p.n))
  const tocItems = (input.toc || []).filter((t) => t.title && t.page && pageSet.has(t.page))
  const navToc = tocItems.length
    ? tocItems.map((t) => `<li><a href="${pageFile(t.page!)}">${xmlEsc(t.title)}</a></li>`).join('\n')
    : pages.map((p) => `<li><a href="${pageFile(p.n)}">صفحهٔ ${p.n}</a></li>`).join('\n')
  add(
    'OEBPS/nav.xhtml',
    xhtml(
      lang,
      'فهرست',
      `<nav epub:type="toc" id="toc"><h1>فهرست</h1><ol>
<li><a href="title.xhtml">${xmlEsc(input.title)}</a></li>
${navToc}
</ol></nav>
<nav epub:type="page-list" hidden=""><ol>
${pages.map((p) => `<li><a href="${pageFile(p.n)}#page${p.n}">${p.n}</a></li>`).join('\n')}
</ol></nav>`
    )
  )
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    '<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>',
    ...pages.map((p) => `<item id="p${p.n}" href="${pageFile(p.n)}" media-type="application/xhtml+xml"/>`)
  ]
  const spine = ['<itemref idref="title"/>', '<itemref idref="nav" linear="no"/>', ...pages.map((p) => `<itemref idref="p${p.n}"/>`)]
  add(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${lang}" dir="rtl">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${xmlEsc(input.id)}</dc:identifier>
    <dc:title>${xmlEsc(fullTitle)}</dc:title>
    <dc:language>${lang}</dc:language>
    <dc:publisher>${xmlEsc(input.publication)}</dc:publisher>
${(input.authors || []).map((a) => `    <dc:creator>${xmlEsc(a)}</dc:creator>`).join('\n')}
${input.date ? `    <dc:date>${xmlEsc(input.date.slice(0, 10))}</dc:date>` : ''}
${input.description ? `    <dc:description>${xmlEsc(input.description)}</dc:description>` : ''}
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    ${manifest.join('\n    ')}
  </manifest>
  <spine page-progression-direction="rtl">
    ${spine.join('\n    ')}
  </spine>
</package>
`
  )
  return zipStore(files)
}

// Article index & persistent identifiers (ROADMAP phase 19) — public, no login, no key:
//   GET /api/articles/:pid            JSON record (only for visible = published issues of active publications)
//   GET /api/articles/:pid/cite.bib   BibTeX       GET /api/articles/:pid/cite.ris   RIS (EndNote/Zotero/Mendeley)
//   GET /api/articles/oai             OAI-PMH 2.0 (Identify, ListMetadataFormats, ListSets, ListIdentifiers, ListRecords, GetRecord; oai_dc)
// The human/crawler landing page with citation_* meta tags is `/a/:pid` (server-rendered in app.ts → articlePage()).
// Only metadata is exposed — never page images or PDFs of paid issues.
import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { citedAuthors, getArticle, listArticles, PID_RE, toApa, toBibtex, toRis, type ArticleRecord } from '../lib/articles'
import { notFound } from '../lib/util'
import { isoToJalali } from '../../shared/fa'

export const articleRoutes = new Hono<AppEnv>()

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const landing = (origin: string, pid: string) => `${origin}/a/${pid}`

export function articleJson(a: ArticleRecord, origin: string) {
  const url = landing(origin, a.pid)
  return { ...a, url, issue_url: `${origin}/issue/${a.issue.id}`, doi_url: a.doi ? `https://doi.org/${a.doi}` : null, citation: toApa(a, url) }
}

// OAI-PMH must be registered before /:pid
articleRoutes.get('/oai', async (c) => {
  const db = c.get('db')
  const origin = new URL(c.req.url).origin
  const base = `${origin}/api/articles/oai`
  const q = c.req.query()
  const verb = q.verb || ''
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const host = new URL(origin).hostname
  const oaiId = (pid: string) => `oai:${host}:${pid}`
  const reqAttrs = Object.entries(q)
    .filter(([k]) => ['verb', 'identifier', 'metadataPrefix', 'from', 'until', 'set', 'resumptionToken'].includes(k))
    .map(([k, v]) => ` ${k}="${xmlEsc(String(v))}"`)
    .join('')
  const wrap = (inner: string) =>
    c.body(
      `<?xml version="1.0" encoding="UTF-8"?>\n<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/ http://www.openarchives.org/OAI/2.0/OAI-PMH.xsd">\n<responseDate>${now}</responseDate>\n<request${reqAttrs}>${xmlEsc(base)}</request>\n${inner}\n</OAI-PMH>\n`,
      200,
      { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' }
    )
  const err = (code: string, msg: string) => wrap(`<error code="${code}">${xmlEsc(msg)}</error>`)
  const header = (a: ArticleRecord) =>
    `<header><identifier>${oaiId(a.pid)}</identifier><datestamp>${(a.updated_at || a.created_at).replace(/\.\d{3}Z$/, 'Z')}</datestamp><setSpec>pub:${xmlEsc(a.publication.slug)}</setSpec></header>`
  const dc = (a: ArticleRecord) => {
    const url = landing(origin, a.pid)
    const f: string[] = [`<dc:title>${xmlEsc(a.title)}</dc:title>`]
    for (const n of citedAuthors(a)) f.push(`<dc:creator>${xmlEsc(n)}</dc:creator>`)
    for (const k of a.keywords) f.push(`<dc:subject>${xmlEsc(k)}</dc:subject>`)
    if (a.abstract) f.push(`<dc:description>${xmlEsc(a.abstract)}</dc:description>`)
    f.push(`<dc:publisher>${xmlEsc(a.publication.title)}</dc:publisher>`)
    f.push(`<dc:date>${a.issue.published_at.slice(0, 10)}</dc:date>`, '<dc:type>text</dc:type>', `<dc:language>${xmlEsc(a.lang)}</dc:language>`)
    f.push(`<dc:identifier>${xmlEsc(url)}</dc:identifier>`, `<dc:identifier>${a.pid}</dc:identifier>`)
    if (a.doi) f.push(`<dc:identifier>https://doi.org/${xmlEsc(a.doi)}</dc:identifier>`)
    f.push(`<dc:source>${xmlEsc(`${a.publication.title}، شمارهٔ ${a.issue.number}`)}</dc:source>`)
    f.push(`<dc:rights>${a.issue.pricing === 'free' ? 'info:eu-repo/semantics/openAccess' : 'info:eu-repo/semantics/restrictedAccess'}</dc:rights>`)
    return `<metadata><oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/oai_dc/ http://www.openarchives.org/OAI/2.0/oai_dc.xsd">${f.join('')}</oai_dc:dc></metadata>`
  }

  if (verb === 'Identify') {
    const first = (await listArticles(db, { limit: 1 }))[0]
    return wrap(
      `<Identify><repositoryName>نشریار — نمایهٔ مقالات نشریات دانشجویی</repositoryName><baseURL>${xmlEsc(base)}</baseURL><protocolVersion>2.0</protocolVersion><adminEmail>noreply@${xmlEsc(host)}</adminEmail><earliestDatestamp>${(first?.created_at || now).replace(/\.\d{3}Z$/, 'Z')}</earliestDatestamp><deletedRecord>no</deletedRecord><granularity>YYYY-MM-DDThh:mm:ssZ</granularity></Identify>`
    )
  }
  if (verb === 'ListMetadataFormats')
    return wrap(
      '<ListMetadataFormats><metadataFormat><metadataPrefix>oai_dc</metadataPrefix><schema>http://www.openarchives.org/OAI/2.0/oai_dc.xsd</schema><metadataNamespace>http://www.openarchives.org/OAI/2.0/oai_dc/</metadataNamespace></metadataFormat></ListMetadataFormats>'
    )
  if (verb === 'ListSets') {
    const pubs = await db.all<{ slug: string; title: string }>("SELECT slug, title FROM publications WHERE status = 'active' AND deleted_at IS NULL ORDER BY slug")
    return wrap(`<ListSets>${pubs.map((p) => `<set><setSpec>pub:${xmlEsc(p.slug)}</setSpec><setName>${xmlEsc(p.title)}</setName></set>`).join('')}</ListSets>`)
  }
  if (verb === 'GetRecord') {
    if (q.metadataPrefix !== 'oai_dc') return err('cannotDisseminateFormat', 'فقط oai_dc پشتیبانی می‌شود')
    const pid = String(q.identifier || '').split(':').pop() || ''
    const a = await getArticle(db, pid)
    if (!a) return err('idDoesNotExist', 'شناسه یافت نشد')
    return wrap(`<GetRecord><record>${header(a)}${dc(a)}</record></GetRecord>`)
  }
  if (verb === 'ListIdentifiers' || verb === 'ListRecords') {
    let after: [string, string] | null = null
    let from = q.from
    let until = q.until
    let set = q.set
    if (q.resumptionToken) {
      try {
        const t = JSON.parse(atob(q.resumptionToken.replace(/-/g, '+').replace(/_/g, '/')))
        after = [String(t.a[0]), String(t.a[1])]
        from = t.f || undefined
        until = t.u || undefined
        set = t.s || undefined
      } catch {
        return err('badResumptionToken', 'resumptionToken نامعتبر است')
      }
    } else if (q.metadataPrefix !== 'oai_dc') return err(q.metadataPrefix ? 'cannotDisseminateFormat' : 'badArgument', 'metadataPrefix=oai_dc لازم است')
    const day = (s?: string, end = false) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s + (end ? 'T23:59:59.999Z' : 'T00:00:00.000Z') : s && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s) ? s.replace('Z', end ? '.999Z' : '.000Z') : undefined)
    if ((from && !day(from)) || (until && !day(until, true))) return err('badArgument', 'قالب تاریخ from/until نامعتبر است')
    const PAGE = 100
    let rows = await listArticles(db, { after, from: day(from), until: day(until, true), limit: PAGE + 1 })
    if (set) rows = rows.filter((a) => `pub:${a.publication.slug}` === set)
    const more = rows.length > PAGE
    const page = rows.slice(0, PAGE)
    if (!page.length) return err('noRecordsMatch', 'رکوردی یافت نشد')
    const last = page[page.length - 1]
    const token = more ? btoa(JSON.stringify({ a: [last.created_at, last.pid], f: from || '', u: until || '', s: set || '' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : ''
    const items = page.map((a) => (verb === 'ListRecords' ? `<record>${header(a)}${dc(a)}</record>` : header(a))).join('')
    return wrap(`<${verb}>${items}${more ? `<resumptionToken>${token}</resumptionToken>` : ''}</${verb}>`)
  }
  return err('badVerb', 'verb نامعتبر یا ناموجود است')
})

articleRoutes.get('/:pid', async (c) => {
  const a = await getArticle(c.get('db'), c.req.param('pid'))
  if (!a) throw notFound('مقاله یافت نشد')
  return c.json({ article: articleJson(a, new URL(c.req.url).origin) })
})

articleRoutes.get('/:pid/cite.bib', async (c) => {
  const a = await getArticle(c.get('db'), c.req.param('pid'))
  if (!a) throw notFound('مقاله یافت نشد')
  return c.body(toBibtex(a, landing(new URL(c.req.url).origin, a.pid)), 200, {
    'Content-Type': 'application/x-bibtex; charset=utf-8',
    'Content-Disposition': `attachment; filename="${a.pid}.bib"`
  })
})

articleRoutes.get('/:pid/cite.ris', async (c) => {
  const a = await getArticle(c.get('db'), c.req.param('pid'))
  if (!a) throw notFound('مقاله یافت نشد')
  return c.body(toRis(a, landing(new URL(c.req.url).origin, a.pid)), 200, {
    'Content-Type': 'application/x-research-info-systems; charset=utf-8',
    'Content-Disposition': `attachment; filename="${a.pid}.ris"`
  })
})

/** Server-rendered landing page `/a/:pid` (Google Scholar / Highwire citation_* meta; no script, works without JS). */
export async function articlePage(c: any): Promise<Response> {
  const pid = String(c.req.param('pid') || '')
  const deps = c.get('deps')
  const db = c.get('db') || deps?.db
  const a = PID_RE.test(pid) && db ? await getArticle(db, pid) : null
  const h = (s: string) => xmlEsc(s)
  if (!a) {
    return c.html(
      `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>مقاله یافت نشد — نشریار</title></head><body style="font-family:Vazirmatn,Tahoma,sans-serif;padding:2rem"><h1>مقاله یافت نشد</h1><p><a href="/">بازگشت به نشریار</a></p></body></html>`,
      404
    )
  }
  const origin = new URL(c.req.url).origin
  const url = landing(origin, a.pid)
  const authors = citedAuthors(a)
  const d = a.issue.published_at.slice(0, 10).replace(/-/g, '/')
  const meta: [string, string][] = [
    ['citation_title', a.title],
    ...authors.map((n) => ['citation_author', n] as [string, string]),
    ['citation_publication_date', d],
    ['citation_journal_title', a.publication.title],
    ['citation_issue', String(a.issue.number)],
    ...(a.page_start ? [['citation_firstpage', String(a.page_start)] as [string, string]] : []),
    ...(a.page_end ? [['citation_lastpage', String(a.page_end)] as [string, string]] : []),
    ...(a.doi ? [['citation_doi', a.doi] as [string, string]] : []),
    ...a.keywords.map((k) => ['citation_keywords', k] as [string, string]),
    ...(a.abstract ? [['citation_abstract', a.abstract] as [string, string]] : []),
    ['citation_language', a.lang],
    ['citation_publisher', a.publication.association || a.publication.title],
    ['citation_abstract_html_url', url],
    ['DC.identifier', a.pid],
    ['description', a.abstract || `${a.title} — ${a.publication.title}، شمارهٔ ${a.issue.number}`]
  ]
  const jalali = isoToJalali(a.issue.published_at)
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'ScholarlyArticle',
    headline: a.title,
    identifier: [a.pid, ...(a.doi ? [`https://doi.org/${a.doi}`] : [])],
    author: authors.map((n) => ({ '@type': 'Person', name: n })),
    datePublished: a.issue.published_at.slice(0, 10),
    inLanguage: a.lang,
    keywords: a.keywords.join(', ') || undefined,
    abstract: a.abstract || undefined,
    isPartOf: { '@type': 'PublicationIssue', issueNumber: String(a.issue.number), isPartOf: { '@type': 'Periodical', name: a.publication.title } },
    url
  }
  const roles = a.authors.map((x) => `<li>${h(x.name)} <small>(${h(x.role)})</small></li>`).join('')
  const html = `<!doctype html>
<html lang="${h(a.lang)}" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(a.title)} — ${h(a.publication.title)}</title>
<link rel="canonical" href="${h(url)}">
${meta.map(([n, v]) => `<meta name="${n}" content="${h(v)}">`).join('\n')}
<meta property="og:type" content="article"><meta property="og:title" content="${h(a.title)}"><meta property="og:url" content="${h(url)}">
<link rel="alternate" type="application/json" href="/api/articles/${a.pid}">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<style>
body{font-family:Vazirmatn,Tahoma,sans-serif;margin:0;background:#f7f5f0;color:#1f2937;line-height:1.9}
main{max-width:46rem;margin:0 auto;padding:2rem 1.25rem}
.card{background:#fff;border:1px solid #e5e1d8;border-radius:1rem;padding:1.5rem;margin-bottom:1rem}
h1{font-size:1.6rem;line-height:1.6;margin:.25rem 0 1rem}
.muted{color:#4b5563;font-size:.9rem}
code{direction:ltr;unicode-bidi:embed;background:#f3f0e8;padding:.1rem .4rem;border-radius:.4rem}
a{color:#0f5d6b}
.btns a{display:inline-block;margin:.25rem 0 .25rem .5rem;padding:.4rem .9rem;border:1px solid #0f5d6b;border-radius:.6rem;text-decoration:none}
ul{padding-inline-start:1.25rem}
</style>
</head>
<body>
<main>
<p class="muted"><a href="/">نشریار</a> › <a href="/p/${encodeURIComponent(a.publication.slug)}">${h(a.publication.title)}</a> › <a href="/issue/${h(a.issue.id)}">شمارهٔ ${a.issue.number}</a></p>
<article class="card">
<p class="muted">${h(a.kind === 'article' ? 'مقاله' : a.kind)} · ${h(a.publication.title)}، شمارهٔ ${a.issue.number} (${h(a.issue.title)}) · ${jalali.jy}/${jalali.jm}/${jalali.jd}${a.page_start ? ` · ص ${a.page_start}${a.page_end && a.page_end !== a.page_start ? `–${a.page_end}` : ''}` : ''}</p>
<h1>${h(a.title)}</h1>
${roles ? `<ul>${roles}</ul>` : ''}
${a.abstract ? `<h2>چکیده</h2><p>${h(a.abstract)}</p>` : ''}
${a.keywords.length ? `<p><strong>کلیدواژه‌ها:</strong> ${a.keywords.map(h).join('، ')}</p>` : ''}
<p>شناسهٔ پایدار: <code>${a.pid}</code>${a.doi ? ` · DOI: <a dir="ltr" href="https://doi.org/${h(a.doi)}">${h(a.doi)}</a>` : ''}</p>
<p class="btns"><a href="/issue/${h(a.issue.id)}">${a.issue.pricing === 'free' ? 'خواندن در نشریار' : 'مشاهدهٔ شماره'}</a><a href="/api/articles/${a.pid}/cite.bib">BibTeX</a><a href="/api/articles/${a.pid}/cite.ris">RIS (EndNote / Zotero)</a></p>
</article>
<section class="card"><h2>استناد</h2><p>${h(toApa(a, url))}</p></section>
</main>
</body>
</html>`
  return c.html(html, 200, { 'Cache-Control': 'public, max-age=600' })
}

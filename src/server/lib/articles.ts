// Article index with persistent identifiers (ROADMAP phase 19).
// Every TOC item of a published issue gets a PID once (NSH-<jalali year>-<8 chars Crockford base32>); the PID never
// changes or gets reused, so `/a/<pid>` is a permanent citation target. Assigned on publish approval, by maintenance
// (backfill for old/archival issues) and at the end of the demo seed. Metadata (abstract, keywords, DOI) is optional.
import type { Db } from '../adapters/db'
import { isoToJalali } from '../../shared/fa'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const SQL_NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`
/** Same visibility rule as the storefront: published (or archived), release time reached, publication active. */
export const ARTICLE_VISIBLE = `i.status IN ('published','archived') AND i.published_at <= ${SQL_NOW} AND i.deleted_at IS NULL AND p.status = 'active' AND p.deleted_at IS NULL`
/** Section kinds that are never cited (covers, ads, …). Everything else (article, interview, report, …) is indexed. */
const SKIP_KINDS = ['cover', 'ad', 'ads', 'advert', 'toc', 'index']

export const PID_RE = /^NSH-\d{4}-[0-9A-HJKMNP-TV-Z]{8}$/
export const DOI_RE = /^10\.\d{4,9}\/[^\s"<>]+$/

export function newPid(publishedAt: string): string {
  const year = publishedAt ? isoToJalali(publishedAt).jy : 1400
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  let code = ''
  for (const b of bytes) code += CROCKFORD[b & 31]
  return `NSH-${year}-${code}`
}

/** Assigns PIDs to every not-yet-indexed TOC item of the given issue (idempotent). Returns how many were added. */
export async function indexIssueArticles(db: Db, issueId: string): Promise<number> {
  const rows = await db.all<{ id: string; kind: string | null; published_at: string | null }>(
    `SELECT t.id, t.kind, i.published_at FROM issue_toc_items t JOIN issues i ON i.id = t.issue_id
     WHERE t.issue_id = ? AND i.status IN ('published','archived') AND i.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM article_index a WHERE a.toc_item_id = t.id)`,
    [issueId]
  )
  let added = 0
  const now = new Date().toISOString()
  for (const r of rows) {
    if (SKIP_KINDS.includes(String(r.kind || '').toLowerCase())) continue
    // a collision is astronomically unlikely (32^8 per year); retry a few times anyway
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await db.run('INSERT INTO article_index (pid, toc_item_id, issue_id, lang, created_at) VALUES (?,?,?,?,?)', [newPid(r.published_at || now), r.id, issueId, 'fa', now])
        added++
        break
      } catch (e) {
        if (attempt === 3) throw e
      }
    }
  }
  return added
}

/** Backfill: indexes published issues that have unindexed sections (bounded per run). */
export async function backfillArticleIndex(db: Db, maxIssues = 200): Promise<number> {
  const issues = await db.all<{ id: string }>(
    `SELECT DISTINCT t.issue_id AS id FROM issue_toc_items t JOIN issues i ON i.id = t.issue_id
     WHERE i.status IN ('published','archived') AND i.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM article_index a WHERE a.toc_item_id = t.id) LIMIT ?`,
    [maxIssues]
  )
  let n = 0
  for (const i of issues) n += await indexIssueArticles(db, i.id)
  return n
}

export interface ArticleRecord {
  pid: string
  doi: string | null
  title: string
  kind: string
  abstract: string | null
  keywords: string[]
  lang: string
  page_start: number | null
  page_end: number | null
  authors: { role: string; name: string }[]
  issue: { id: string; number: number; title: string; published_at: string; pricing: string }
  publication: { id: string; slug: string; title: string; license_number: string | null; association: string | null }
  created_at: string
  updated_at: string | null
}

const SELECT = `SELECT a.pid, a.doi, a.abstract, a.keywords, a.lang, a.created_at, a.updated_at, t.id AS toc_item_id, t.title, t.kind, t.page_start, t.page_end,
  i.id AS issue_id, i.number, i.title AS issue_title, i.published_at, i.pricing, p.id AS publication_id, p.slug, p.title AS publication_title,
  p.license_number, s.name AS association_name
  FROM article_index a JOIN issue_toc_items t ON t.id = a.toc_item_id JOIN issues i ON i.id = a.issue_id
  JOIN publications p ON p.id = i.publication_id LEFT JOIN associations s ON s.id = p.association_id`

async function hydrate(db: Db, rows: any[]): Promise<ArticleRecord[]> {
  if (!rows.length) return []
  const ids = rows.map((r) => r.toc_item_id)
  const by = await db.all<{ toc_item_id: string; role: string; full_name: string }>(
    `SELECT ta.toc_item_id, ta.role, tm.full_name FROM toc_assignments ta JOIN team_members tm ON tm.id = ta.team_member_id
     WHERE ta.toc_item_id IN (${ids.map(() => '?').join(',')}) ORDER BY ta.role`,
    ids
  )
  return rows.map((r) => ({
    pid: r.pid,
    doi: r.doi || null,
    title: r.title,
    kind: r.kind || 'article',
    abstract: r.abstract || null,
    keywords: String(r.keywords || '').split(/[،,]/).map((k: string) => k.trim()).filter(Boolean),
    lang: r.lang || 'fa',
    page_start: r.page_start ?? null,
    page_end: r.page_end ?? null,
    authors: by.filter((b) => b.toc_item_id === r.toc_item_id).map((b) => ({ role: b.role, name: b.full_name })),
    issue: { id: r.issue_id, number: r.number, title: r.issue_title, published_at: r.published_at, pricing: r.pricing },
    publication: { id: r.publication_id, slug: r.slug, title: r.publication_title, license_number: r.license_number || null, association: r.association_name || null },
    created_at: r.created_at,
    updated_at: r.updated_at || null
  }))
}

/** One visible article by PID (null when unknown or not public). */
export async function getArticle(db: Db, pid: string): Promise<ArticleRecord | null> {
  if (!PID_RE.test(pid)) return null
  const r = await db.first<any>(`${SELECT} WHERE a.pid = ? AND ${ARTICLE_VISIBLE}`, [pid])
  return r ? (await hydrate(db, [r]))[0] : null
}

/** Visible articles in (created_at, pid) order after an optional cursor — used by OAI-PMH. */
export async function listArticles(db: Db, opts: { after?: [string, string] | null; from?: string; until?: string; limit: number }): Promise<ArticleRecord[]> {
  const where = [ARTICLE_VISIBLE]
  const params: unknown[] = []
  if (opts.from) (where.push('a.created_at >= ?'), params.push(opts.from))
  if (opts.until) (where.push('a.created_at <= ?'), params.push(opts.until))
  if (opts.after) (where.push('(a.created_at > ? OR (a.created_at = ? AND a.pid > ?))'), params.push(opts.after[0], opts.after[0], opts.after[1]))
  const rows = await db.all<any>(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY a.created_at, a.pid LIMIT ${Math.max(1, Math.min(500, opts.limit))}`, params)
  return hydrate(db, rows)
}

export const isAuthorRole = (role: string) => /author|writer|translator|نویسنده|مترجم/i.test(role)

/** Authors for citations: author/translator roles; falls back to everyone credited on the section. */
export function citedAuthors(a: ArticleRecord): string[] {
  const main = a.authors.filter((x) => isAuthorRole(x.role)).map((x) => x.name)
  return main.length ? main : a.authors.map((x) => x.name)
}

const year = (iso: string) => String(isoToJalali(iso).jy)
const pages = (a: ArticleRecord) => (a.page_start ? (a.page_end && a.page_end !== a.page_start ? `${a.page_start}-${a.page_end}` : String(a.page_start)) : '')

export function toBibtex(a: ArticleRecord, url: string): string {
  const esc = (s: string) => s.replace(/[{}\\]/g, '')
  const f: [string, string][] = [
    ['title', a.title],
    ['author', citedAuthors(a).join(' and ')],
    ['journal', a.publication.title],
    ['number', String(a.issue.number)],
    ['year', year(a.issue.published_at)],
    ['pages', pages(a)],
    ['doi', a.doi || ''],
    ['url', url],
    ['keywords', a.keywords.join(', ')],
    ['abstract', a.abstract || ''],
    ['language', a.lang === 'fa' ? 'persian' : a.lang],
    ['note', `شناسهٔ پایدار: ${a.pid}`]
  ]
  const body = f.filter(([, v]) => v).map(([k, v]) => `  ${k} = {${esc(v)}}`).join(',\n')
  return `@article{${a.pid},\n${body}\n}\n`
}

export function toRis(a: ArticleRecord, url: string): string {
  const lines: string[] = ['TY  - JOUR', `TI  - ${a.title}`]
  for (const n of citedAuthors(a)) lines.push(`AU  - ${n}`)
  lines.push(`JO  - ${a.publication.title}`, `IS  - ${a.issue.number}`, `PY  - ${year(a.issue.published_at)}`, `DA  - ${a.issue.published_at.slice(0, 10).replace(/-/g, '/')}`)
  if (a.page_start) lines.push(`SP  - ${a.page_start}`)
  if (a.page_end) lines.push(`EP  - ${a.page_end}`)
  if (a.doi) lines.push(`DO  - ${a.doi}`)
  for (const k of a.keywords) lines.push(`KW  - ${k}`)
  if (a.abstract) lines.push(`AB  - ${a.abstract.replace(/\s+/g, ' ')}`)
  lines.push(`LA  - ${a.lang}`, `UR  - ${url}`, `ID  - ${a.pid}`, 'ER  - ')
  return lines.join('\r\n') + '\r\n'
}

/** A short Persian APA-like reference line for display. */
export function toApa(a: ArticleRecord, url: string): string {
  const au = citedAuthors(a)
  const who = au.length ? au.join('، ') : a.publication.title
  return `${who} (${year(a.issue.published_at)}). ${a.title}. ${a.publication.title}، شمارهٔ ${a.issue.number}${pages(a) ? `، ص ${pages(a)}` : ''}. ${a.doi ? `https://doi.org/${a.doi}` : url}`
}

// Admin domain module: digitisation & archive of old printed issues (ROADMAP phase 19).
// The publications officer registers an old printed issue directly (no team production workflow / approval):
//   1. POST /print-archive                 → issue row with archival = 1, status 'planning', original print date
//   2. scanned PDF through the normal pipeline (team room → media tab: browser pdf.js or server pdftoppm + pdftotext;
//      the text layer lands in issue_pages.text_content and feeds full-text search)
//   3. POST /print-archive/:id/publish     → status 'published', published_at = ORIGINAL date (never floods "new" shelves),
//      cover = first page when none was set, persistent article ids for its TOC. No follower notifications.
// Mounted by routes/admin.ts (parent middleware applies).
import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { newId } from '../../lib/crypto'
import { audit, bad, body, int, keywordsCsv, notFound, nowIso, oneOf, str } from '../../lib/util'
import { indexIssueArticles } from '../../lib/articles'
import { jalaliMonthLength, jalaliToIso, normalizeFa, toFaDigits } from '../../../shared/fa'
import { admin, monitor, scope } from './service'

export const printArchiveRoutes = new Hono<AppEnv>()

const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']

/** Original print date from Jalali parts (month/day optional) → { iso: YYYY-MM-DD, label }. */
export function originalDate(jy: number, jm: number | null, jd: number | null): { iso: string; label: string } {
  if (jd && !jm) throw bad('برای روز، ماه هم لازم است')
  if (jm && jd && jd > jalaliMonthLength(jy, jm)) throw bad('روز انتخاب‌شده در این ماه وجود ندارد')
  const iso = jalaliToIso(jy, jm || 1, jd || 1)
  const label = jd ? `${toFaDigits(jd)} ${MONTHS[jm! - 1]} ${toFaDigits(jy)}` : jm ? `${MONTHS[jm - 1]} ${toFaDigits(jy)}` : toFaDigits(jy)
  return { iso, label }
}

printArchiveRoutes.get('/print-archive', async (c) => {
  monitor(c)
  const s = scope(c)
  const rows = await c.get('db').all(
    `SELECT i.id, i.number, i.title, i.status, i.page_count, i.cover_key, i.main_pdf_key IS NOT NULL AS has_pdf, i.original_date, i.original_label,
       i.published_at, i.created_at, p.id AS publication_id, p.title AS publication_title,
       (SELECT COUNT(*) FROM issue_pages ip WHERE ip.issue_id = i.id) AS pages_uploaded,
       (SELECT COUNT(*) FROM issue_pages ip WHERE ip.issue_id = i.id AND ip.text_content IS NOT NULL AND ip.text_content <> '') AS pages_with_text
     FROM issues i JOIN publications p ON p.id = i.publication_id
     WHERE i.archival = 1 AND i.deleted_at IS NULL${s.sql} ORDER BY i.original_date DESC, i.number DESC LIMIT 500`,
    s.params
  )
  return c.json({ issues: rows })
})

printArchiveRoutes.post('/print-archive', async (c) => {
  const u = admin(c)
  const db = c.get('db')
  const b = await body<any>(c)
  const p = await db.first<any>('SELECT id, title FROM publications WHERE id = ? AND deleted_at IS NULL', [String(b.publication_id || '')])
  if (!p) throw notFound('نشریه یافت نشد')
  const number = int(b.number, 'شمارهٔ ترتیبی', { min: 1, max: 100000 })!
  if (await db.first('SELECT 1 FROM issues WHERE publication_id = ? AND number = ? AND deleted_at IS NULL', [p.id, number])) throw bad(`شمارهٔ ${number} برای این نشریه قبلاً ثبت شده است`)
  const title = str(b.title, 'عنوان شماره', { min: 2, max: 160 })
  const jy = int(b.original_jy, 'سال انتشار چاپی', { min: 1300, max: 1500 })!
  const jm = int(b.original_jm, 'ماه', { min: 1, max: 12, optional: true })
  const jd = int(b.original_jd, 'روز', { min: 1, max: 31, optional: true })
  const od = originalDate(jy, jm, jd)
  if (od.iso > nowIso().slice(0, 10)) throw bad('تاریخ انتشار چاپی نمی‌تواند در آینده باشد')
  const label = str(b.original_label, 'برچسب تاریخ', { max: 60, optional: true }) || od.label
  const summary = str(b.summary, 'خلاصه', { max: 3000, optional: true }) || null
  const keywords = keywordsCsv(b.keywords)
  // optional table of contents (title + free-text authors), so the archive is searchable by article and author
  const toc = (Array.isArray(b.toc) ? b.toc : []).slice(0, 300)
  const tocTitles = toc.map((t: any) => String(t?.title || '').trim().slice(0, 200)).filter(Boolean)
  const id = newId()
  const now = nowIso()
  const stmts: { sql: string; params: unknown[] }[] = [
    {
      sql: `INSERT INTO issues (id, publication_id, number, title, summary, keywords, status, pricing, free_preview_pages, archival, original_date, original_label, search_text, created_by, created_at, updated_at)
            VALUES (?,?,?,?,?,?, 'planning', 'free', 0, 1, ?,?,?,?,?,?)`,
      params: [id, p.id, number, title, summary, keywords, od.iso, label, normalizeFa([title, summary, keywords, p.title, 'شماره ' + number, 'آرشیو چاپی', label, ...tocTitles].join(' ')), u.id, now, now]
    }
  ]
  toc.forEach((t: any, idx: number) => {
    const tTitle = String(t?.title || '').trim().slice(0, 200)
    if (!tTitle) return
    const tid = newId()
    stmts.push({
      sql: "INSERT INTO issue_toc_items (id, issue_id, parent_id, sort_order, title, kind, status, page_start, page_end, created_at) VALUES (?,?,NULL,?,?,?, 'done', ?,?,?)",
      params: [tid, id, idx, tTitle, String(t.kind || 'article').slice(0, 30), Number(t.page_start) > 0 ? Math.floor(Number(t.page_start)) : null, Number(t.page_end) > 0 ? Math.floor(Number(t.page_end)) : null, now]
    })
  })
  await db.batch(stmts)
  await audit(db, u.id, 'issue.archival_create', 'issue', id, null, { publication_id: p.id, number, title, original_date: od.iso })
  return c.json({ ok: true, id, publication_id: p.id, original_date: od.iso, original_label: label })
})

printArchiveRoutes.post('/print-archive/:id/publish', async (c) => {
  const u = admin(c)
  const db = c.get('db')
  const i = await db.first<any>('SELECT * FROM issues WHERE id = ? AND archival = 1 AND deleted_at IS NULL', [c.req.param('id')])
  if (!i) throw notFound('شمارهٔ آرشیوی یافت نشد')
  if (i.status === 'published') throw bad('این شماره قبلاً در آرشیو منتشر شده است')
  const first = await db.first<{ image_key: string }>('SELECT image_key FROM issue_pages WHERE issue_id = ? ORDER BY page_number LIMIT 1', [i.id])
  if (!first) throw bad('ابتدا نسخهٔ اسکن‌شده (PDF) را بارگذاری و پردازش کنید')
  const pages = (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM issue_pages WHERE issue_id = ?', [i.id]))?.n ?? 0
  const b = await body<any>(c)
  const pricing = oneOf(b.pricing, ['free', 'paid'] as const, 'نوع دسترسی', 'free')
  const price = pricing === 'paid' ? int(b.price_digital, 'قیمت نسخهٔ دیجیتال', { min: 1000, max: 100000000 }) : null
  const publishedAt = `${i.original_date || nowIso().slice(0, 10)}T08:00:00.000Z`
  const now = nowIso()
  await db.run(
    `UPDATE issues SET status = 'published', published_at = ?, pricing = ?, price_digital = ?, cover_key = COALESCE(cover_key, ?), page_count = CASE WHEN page_count > 0 THEN page_count ELSE ? END, updated_at = ? WHERE id = ?`,
    [publishedAt, pricing, price, first.image_key, pages, now, i.id]
  )
  const indexed = await indexIssueArticles(db, i.id)
  await audit(db, u.id, 'issue.archival_publish', 'issue', i.id, { status: i.status }, { status: 'published', published_at: publishedAt, pages, pricing })
  return c.json({ ok: true, published_at: publishedAt, pages, articles_indexed: indexed })
})

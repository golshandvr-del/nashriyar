import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { clientIp, requireUser } from '../auth'
import { hmac, newId, timingSafeEqual } from '../lib/crypto'
import { body, HttpError, int, notFound, nowIso, str } from '../lib/util'
import { trackView } from './public'
import { buildEpub } from '../../shared/epub'

export const readerRoutes = new Hono<AppEnv>()

const URL_TTL_SEC = 300 // signed page URLs expire after 5 minutes

/**
 * Invisible watermark code (ROADMAP phase 5): 8 hex chars = HMAC(secret, user|issue). Stateless —
 * staff resolve a code found in a leaked image by recomputing it for the issue's readers
 * (POST /api/team/:pubId/issues/:issueId/trace). Never contains the student number itself.
 */
export async function traceCode(secret: string, userId: string, issueId: string): Promise<string> {
  return (await hmac(secret, `mark|${userId}|${issueId}`)).slice(0, 8)
}
const PAGE_RATE_WINDOW_SEC = 60
const PAGE_RATE_MAX = 90 // page images per viewer per minute; normal reading is far below this
const PAGE_RATE_LOCK_MIN = 5

/**
 * Page-request rate monitoring (ROADMAP phase 5 — anti-scraping). Reuses the generic login_attempts
 * counter table (key/count/window_start/locked_until). Exceeding the limit pauses page delivery for a few
 * minutes and records a `reader.signal` (kind=rate) so the team/officer can see suspicious readers.
 */
async function checkPageRate(c: any, issueId: string) {
  const db = c.get('db')
  const key = 'pages:' + (await viewerBinding(c))
  const now = Date.now()
  const r = await db.first('SELECT count, window_start, locked_until FROM login_attempts WHERE key = ?', [key])
  if (r?.locked_until && r.locked_until > new Date(now).toISOString()) {
    throw new HttpError(429, 'درخواست صفحات بیش از حد سریع بود؛ چند دقیقهٔ دیگر ادامه دهید', 'page_rate')
  }
  if (!r || new Date(r.window_start).getTime() < now - PAGE_RATE_WINDOW_SEC * 1000) {
    await db.run(
      'INSERT INTO login_attempts (key, count, window_start, locked_until) VALUES (?,1,?,NULL) ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start, locked_until = NULL',
      [key, new Date(now).toISOString()]
    )
    return
  }
  const count = r.count + 1
  if (count > PAGE_RATE_MAX) {
    await db.run('UPDATE login_attempts SET count = ?, locked_until = ? WHERE key = ?', [count, new Date(now + PAGE_RATE_LOCK_MIN * 60_000).toISOString(), key])
    await db.run('INSERT INTO activity_events (id, actor_user_id, issue_id, type, payload_json, created_at) VALUES (?,?,?,?,?,?)', [
      newId(), c.get('user')?.id ?? null, issueId, 'reader.signal', JSON.stringify({ kind: 'rate', count }), nowIso()
    ])
    throw new HttpError(429, 'درخواست صفحات بیش از حد سریع بود؛ چند دقیقهٔ دیگر ادامه دهید', 'page_rate')
  }
  await db.run('UPDATE login_attempts SET count = ? WHERE key = ?', [count, key])
}

/** Binding for page signatures: the session (logged-in) or a per-day viewer fingerprint (anonymous). */
async function viewerBinding(c: any): Promise<string> {
  const sid = c.get('sessionId')
  if (sid) return 's:' + sid.slice(0, 32)
  return 'a:' + (await hmac(c.get('deps').secret, clientIp(c) + '|' + (c.req.header('user-agent') || ''))).slice(0, 32)
}

async function signPage(c: any, issueId: string, page: number, exp: number) {
  return (await hmac(c.get('deps').secret, `page|${issueId}|${page}|${exp}|${await viewerBinding(c)}`)).slice(0, 40)
}

/** Determine how many pages the current visitor may read. */
async function accessFor(c: any, issueId: string) {
  const db = c.get('db')
  const i = await db.first(
    `SELECT i.id, i.title, i.number, i.status, i.published_at, i.pricing, i.page_count, i.free_preview_pages, i.publication_id, p.title AS publication_title, p.slug AS publication_slug
     FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.id = ? AND i.deleted_at IS NULL`,
    [issueId]
  )
  if (!i) throw notFound('شماره یافت نشد')
  const u = c.get('user')
  let full = false
  let staff = false
  if (u) {
    if (['super_admin', 'pub_officer', 'analyst'].includes(u.system_role)) staff = true
    else if (u.system_role === 'faculty_supervisor') staff = !!(await db.first('SELECT 1 FROM publications WHERE id = ? AND faculty_id = ?', [i.publication_id, u.scope_faculty_id]))
    else if (await db.first('SELECT 1 FROM publication_roles WHERE user_id = ? AND publication_id = ? AND ended_at IS NULL', [u.id, i.publication_id])) staff = true
    if (!staff && (await db.first('SELECT 1 FROM entitlements WHERE user_id = ? AND issue_id = ? AND revoked_at IS NULL', [u.id, i.id]))) full = true
  }
  // scheduled publishing: hidden from readers until published_at (team/staff can preview before)
  if ((i.status !== 'published' || !i.published_at || i.published_at > nowIso()) && !staff) throw notFound('شماره یافت نشد')
  if (staff || i.pricing === 'free') full = true
  const allowed = full ? i.page_count : Math.min(i.page_count, Math.max(0, i.free_preview_pages || 0))
  return { issue: i, full, allowed, user: u }
}

readerRoutes.get('/:issueId/manifest', async (c) => {
  const { issue, full, allowed, user } = await accessFor(c, c.req.param('issueId'))
  const db = c.get('db')
  const exp = Math.floor(Date.now() / 1000) + URL_TTL_SEC
  const pages = []
  for (let n = 1; n <= allowed; n++) pages.push({ n, url: `/api/reader/${issue.id}/page/${n}?e=${exp}&s=${await signPage(c, issue.id, n, exp)}` })
  const toc = await db.all('SELECT id, title, page_start, parent_id FROM issue_toc_items WHERE issue_id = ? ORDER BY sort_order', [issue.id])
  let progress = null
  let bookmarks: any[] = []
  if (user) {
    progress = await db.first('SELECT last_page, percent FROM reading_progress WHERE user_id = ? AND issue_id = ?', [user.id, issue.id])
    bookmarks = await db.all('SELECT id, page, note, created_at FROM reader_bookmarks WHERE user_id = ? AND issue_id = ? ORDER BY page', [user.id, issue.id])
  }
  if (full) await trackView(c, 'issue_read', issue.id, issue.publication_id)
  // reading-session log for paid content (ROADMAP phase 5 — SECURITY.md §4): who opened what, when, from which client
  if (user && full && issue.pricing === 'paid') {
    await db.run('INSERT INTO activity_events (id, actor_user_id, publication_id, issue_id, type, payload_json, created_at) VALUES (?,?,?,?,?,?,?)', [
      newId(), user.id, issue.publication_id, issue.id, 'reader.session',
      JSON.stringify({ ip: (await hmac(c.get('deps').secret, clientIp(c))).slice(0, 12), ua: (c.req.header('user-agent') || '').slice(0, 120) }), nowIso()
    ])
  }
  return c.json({
    issue: { id: issue.id, title: issue.title, number: issue.number, page_count: issue.page_count, pricing: issue.pricing, publication_title: issue.publication_title, publication_slug: issue.publication_slug },
    full,
    allowed,
    pages,
    expires_at: exp,
    toc,
    progress,
    bookmarks,
    // visible traceable watermark — student number + date (see docs/SECURITY.md §4)
    watermark: user ? `${user.student_number || user.username} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}` : issue.pricing === 'free' ? '' : 'پیش‌نمایش',
    // invisible watermark payload (embedded in pixel LSBs + near-transparent text by the reader)
    mark: user && issue.pricing !== 'free' ? await traceCode(c.get('deps').secret, user.id, issue.id) : ''
  })
})

readerRoutes.get('/:issueId/page/:n', async (c) => {
  const issueId = c.req.param('issueId')
  const n = Number(c.req.param('n'))
  const exp = Number(c.req.query('e'))
  const sig = String(c.req.query('s') || '')
  if (!Number.isInteger(n) || n < 1 || !exp || exp < Date.now() / 1000) throw new HttpError(403, 'پیوند صفحه منقضی شده است', 'expired')
  if (!timingSafeEqual(sig, await signPage(c, issueId, n, exp))) throw new HttpError(403, 'امضای پیوند نامعتبر است', 'bad_sig')
  await checkPageRate(c, issueId)
  const { allowed } = await accessFor(c, issueId)
  if (n > allowed) throw new HttpError(403, 'برای خواندن این صفحه باید شماره را تهیه کنید', 'locked')
  const page = await c.get('db').first<{ image_key: string }>('SELECT image_key FROM issue_pages WHERE issue_id = ? AND page_number = ?', [issueId, n])
  if (!page) throw notFound('صفحه یافت نشد')
  const obj = await c.get('deps').storage.get(page.image_key)
  if (!obj) throw notFound('تصویر صفحه یافت نشد')
  return new Response(obj.body as any, {
    headers: {
      'Content-Type': obj.contentType,
      'Cache-Control': 'private, max-age=240, no-transform',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff'
    }
  })
})

/**
 * Reflowable text mode (ROADMAP phase 19): the text layer of the pages this visitor may read — never more than the
 * image reader would show (free preview pages for a paid issue without entitlement). Same page-rate guard as images.
 */
readerRoutes.get('/:issueId/text', async (c) => {
  const issueId = c.req.param('issueId')
  await checkPageRate(c, issueId)
  const { issue, full, allowed } = await accessFor(c, issueId)
  const db = c.get('db')
  const pages = allowed
    ? await db.all<{ n: number; text: string | null }>('SELECT page_number AS n, text_content AS text FROM issue_pages WHERE issue_id = ? AND page_number <= ? ORDER BY page_number', [issue.id, allowed])
    : []
  const toc = await db.all('SELECT title, page_start FROM issue_toc_items WHERE issue_id = ? AND page_start IS NOT NULL AND page_start <= ? ORDER BY sort_order', [issue.id, allowed])
  const withText = pages.filter((p) => (p.text || '').trim()).length
  return c.json(
    {
      issue: { id: issue.id, title: issue.title, number: issue.number, page_count: issue.page_count, pricing: issue.pricing, publication_title: issue.publication_title },
      full,
      allowed,
      pages: pages.map((p) => ({ n: p.n, text: p.text || '' })),
      toc,
      has_text: withText > 0,
      epub: issue.pricing === 'free' && withText > 0
    },
    200,
    { 'Cache-Control': 'private, no-store' }
  )
})

/** EPUB 3 edition built on the fly from the text layer — free issues only (paid content stays inside the protected reader). */
readerRoutes.get('/:issueId/epub', async (c) => {
  const { issue } = await accessFor(c, c.req.param('issueId'))
  if (issue.pricing !== 'free') throw new HttpError(403, 'نسخهٔ EPUB فقط برای شماره‌های رایگان ارائه می‌شود', 'paid')
  const db = c.get('db')
  const pages = await db.all<{ n: number; text: string | null }>('SELECT page_number AS n, text_content AS text FROM issue_pages WHERE issue_id = ? ORDER BY page_number', [issue.id])
  if (!pages.some((p) => (p.text || '').trim())) throw new HttpError(404, 'این شماره لایهٔ متنی ندارد', 'no_text')
  const toc = await db.all<{ title: string; page_start: number | null }>('SELECT title, page_start FROM issue_toc_items WHERE issue_id = ? ORDER BY sort_order', [issue.id])
  const meta = await db.first<{ summary: string | null; updated_at: string | null }>('SELECT summary, updated_at FROM issues WHERE id = ?', [issue.id])
  const bytes = buildEpub({
    id: `urn:nashriyar:${issue.id}`,
    title: issue.title,
    publication: issue.publication_title,
    number: issue.number,
    date: issue.published_at,
    description: meta?.summary || null,
    pages: pages.map((p) => ({ n: p.n, text: p.text || '' })),
    toc: toc.map((t) => ({ title: t.title, page: t.page_start })),
    modified: meta?.updated_at || issue.published_at || undefined
  })
  await trackView(c, 'issue_read', issue.id, issue.publication_id)
  const name = `${issue.publication_slug}-${issue.number}.epub`
  return new Response(bytes as any, {
    headers: {
      'Content-Type': 'application/epub+zip',
      'Content-Disposition': `attachment; filename="${name.replace(/[^\w.-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff'
    }
  })
})

readerRoutes.post('/:issueId/progress', async (c) => {
  const u = requireUser(c)
  const b = await body<{ page?: number }>(c)
  const { issue } = await accessFor(c, c.req.param('issueId'))
  const page = int(b.page, 'صفحه', { min: 1, max: Math.max(1, issue.page_count) })!
  const percent = issue.page_count ? Math.round((page / issue.page_count) * 100) : 0
  await c.get('db').run(
    `INSERT INTO reading_progress (user_id, issue_id, last_page, percent, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(user_id, issue_id) DO UPDATE SET last_page = excluded.last_page, percent = MAX(reading_progress.percent, excluded.percent), updated_at = excluded.updated_at`,
    [u.id, issue.id, page, percent, nowIso()]
  )
  return c.json({ ok: true })
})

readerRoutes.post('/:issueId/bookmarks', async (c) => {
  const u = requireUser(c)
  const b = await body<{ page?: number; note?: string }>(c)
  const { issue } = await accessFor(c, c.req.param('issueId'))
  const id = newId()
  await c.get('db').run('INSERT INTO reader_bookmarks (id, user_id, issue_id, page, note, created_at) VALUES (?,?,?,?,?,?)', [
    id,
    u.id,
    issue.id,
    int(b.page, 'صفحه', { min: 1, max: Math.max(1, issue.page_count) }),
    str(b.note, 'یادداشت', { max: 500, optional: true }),
    nowIso()
  ])
  return c.json({ ok: true, id })
})

readerRoutes.delete('/bookmarks/:id', async (c) => {
  const u = requireUser(c)
  await c.get('db').run('DELETE FROM reader_bookmarks WHERE id = ? AND user_id = ?', [c.req.param('id'), u.id])
  return c.json({ ok: true })
})

/** Client reports suspicious behaviour (PrintScreen, devtools) — logged for the team/officer. */
readerRoutes.post('/:issueId/signal', async (c) => {
  const u = c.get('user')
  const b = await body<{ kind?: string }>(c)
  const kind = ['printscreen', 'devtools', 'blur', 'print'].includes(String(b.kind)) ? String(b.kind) : 'other'
  await c.get('db').run('INSERT INTO activity_events (id, actor_user_id, issue_id, type, payload_json, created_at) VALUES (?,?,?,?,?,?)', [
    newId(),
    u?.id ?? null,
    c.req.param('issueId'),
    'reader.signal',
    JSON.stringify({ kind }),
    nowIso()
  ])
  return c.json({ ok: true })
})

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../context'
import { requirePubAccess } from '../auth'
import { newId } from '../lib/crypto'
import { activity, bad, forbidden, HttpError, int, notFound, nowIso, str } from '../lib/util'
import { verifyMediaSig } from '../lib/media-sign'

// Media pipeline (Phase 3). Files go to Storage (R2 / disk); metadata lives in media_assets.
// URL shape for stored objects: /api/media/k/<storage_key>
// Reader page images are NEVER served from here — only via signed URLs in routes/reader.ts.

export const mediaRoutes = new Hono<AppEnv>()

const MB = 1024 * 1024
type Kind = 'image' | 'pdf' | 'audio' | 'video'

/** Detects the real file type from magic bytes (never trust the client's Content-Type). SVG is rejected. */
export function sniff(b: Uint8Array): { kind: Kind; mime: string; ext: string } | null {
  const at = (i: number, sig: number[]) => sig.every((v, k) => b[i + k] === v)
  const ascii = (i: number, s: string) => at(i, Array.from(s, (ch) => ch.charCodeAt(0)))
  if (b.length < 12) return null
  if (at(0, [0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' }
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'image', mime: 'image/png', ext: 'png' }
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { kind: 'image', mime: 'image/webp', ext: 'webp' }
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return { kind: 'image', mime: 'image/gif', ext: 'gif' }
  if (ascii(0, '%PDF-')) return { kind: 'pdf', mime: 'application/pdf', ext: 'pdf' }
  if (ascii(0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { kind: 'audio', mime: 'audio/mpeg', ext: 'mp3' }
  if (ascii(0, 'OggS')) return { kind: 'audio', mime: 'audio/ogg', ext: 'ogg' }
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return { kind: 'audio', mime: 'audio/wav', ext: 'wav' }
  if (ascii(4, 'ftyp')) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11])
    if (brand.startsWith('M4A') || brand.startsWith('M4B')) return { kind: 'audio', mime: 'audio/mp4', ext: 'm4a' }
    return { kind: 'video', mime: 'video/mp4', ext: 'mp4' }
  }
  if (at(0, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: 'video', mime: 'video/webm', ext: 'webm' }
  return null
}

const MAX_SIZE: Record<Kind, number> = { image: 10 * MB, pdf: 95 * MB, audio: 95 * MB, video: 95 * MB }

/** Which detected kinds are acceptable for each asset role. */
const ROLE_KINDS: Record<string, Kind[]> = {
  cover: ['image'],
  logo: ['image'],
  post: ['image'],
  gallery: ['image'],
  main_pdf: ['pdf'],
  podcast: ['audio'],
  clip: ['video'],
  attachment: ['pdf', 'image', 'audio', 'video']
}

async function readFile(c: Context<AppEnv>) {
  const form = await c.req.parseBody().catch(() => null)
  if (!form) throw bad('فرم بارگذاری نامعتبر است')
  const f = form['file']
  if (!f || typeof f === 'string') throw bad('فایلی انتخاب نشده است')
  const bytes = new Uint8Array(await (f as File).arrayBuffer())
  if (!bytes.length) throw bad('فایل خالی است')
  return { form, bytes, name: (f as File).name || '' }
}

/**
 * POST /api/media/upload  (multipart: file, pub, role, [issue], [title], [access], [toc_item_id])
 * Team members of the publication (or admins) only.
 */
mediaRoutes.post('/upload', async (c) => {
  const { form, bytes, name } = await readFile(c)
  const pubId = String(form['pub'] || '')
  const role = String(form['role'] || '')
  if (!ROLE_KINDS[role]) throw bad('نوع کاربرد فایل نامعتبر است')
  const { user } = await requirePubAccess(c, pubId, { write: true })
  const db = c.get('db')
  const pub = await db.first<any>('SELECT id FROM publications WHERE id = ? AND deleted_at IS NULL', [pubId])
  if (!pub) throw notFound('نشریه یافت نشد')

  const t = sniff(bytes)
  if (!t) throw bad('نوع فایل پشتیبانی نمی‌شود (فقط JPG، PNG، WebP، GIF، PDF، MP3، M4A، OGG، WAV، MP4، WebM)')
  if (!ROLE_KINDS[role].includes(t.kind)) throw bad('نوع فایل با کاربرد انتخاب‌شده سازگار نیست')
  if (bytes.length > MAX_SIZE[t.kind]) throw bad(`حجم فایل بیش از حد مجاز است (حداکثر ${Math.round(MAX_SIZE[t.kind] / MB)} مگابایت)`)

  let issue: any = null
  const issueId = String(form['issue'] || '')
  if (issueId) {
    issue = await db.first<any>('SELECT id, status FROM issues WHERE id = ? AND publication_id = ? AND deleted_at IS NULL', [issueId, pubId])
    if (!issue) throw notFound('شماره یافت نشد')
    // published issues can still receive supplementary media, but not a new main PDF / cover
    if (['awaiting_approval', 'published'].includes(issue.status) && ['main_pdf', 'cover'].includes(role)) {
      throw bad('این شماره در انتظار تأیید یا منتشرشده است؛ نسخهٔ اصلی و جلد قابل تغییر نیست')
    }
  } else if (!['logo', 'post'].includes(role)) {
    throw bad('برای این نوع فایل باید شماره مشخص شود')
  }

  let tocItemId: string | null = String(form['toc_item_id'] || '') || null
  if (tocItemId) {
    if (!issue) throw bad('بخش فهرست مطالب بدون شماره معنا ندارد')
    if (!(await db.first('SELECT 1 FROM issue_toc_items WHERE id = ? AND issue_id = ?', [tocItemId, issue.id]))) tocItemId = null
  }

  const id = newId()
  const key = `pub/${pubId}/${issue ? issue.id : 'misc'}/${role}-${id}.${t.ext}`
  await c.get('deps').storage.put(key, bytes, t.mime)
  const access = ['free', 'paid', 'private'].includes(String(form['access'])) ? String(form['access']) : role === 'main_pdf' ? 'private' : 'free'
  const now = nowIso()
  await db.run(
    'INSERT INTO media_assets (id, publication_id, issue_id, kind, role, title, storage_key, mime, size_bytes, toc_item_id, access, sort_order, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, pubId, issue?.id ?? null, t.kind, role, str(form['title'], 'عنوان', { max: 200, optional: true }) || name.slice(0, 200) || null, key, t.mime, bytes.length, tocItemId, access,
      Date.now() % 1_000_000_000, user.id, now]
  )
  if (role === 'cover' && issue) await db.run('UPDATE issues SET cover_key = ?, updated_at = ? WHERE id = ?', [key, now, issue.id])
  if (role === 'main_pdf' && issue) await db.run('UPDATE issues SET main_pdf_key = ?, updated_at = ? WHERE id = ?', [key, now, issue.id])
  if (role === 'logo') await db.run('UPDATE publications SET logo_key = ? WHERE id = ?', [key, pubId])
  await activity(db, user.id, 'media.uploaded', pubId, issue?.id ?? null, { role, kind: t.kind, size: bytes.length })
  return c.json({ ok: true, id, key, url: `/api/media/k/${key}`, kind: t.kind, mime: t.mime, size: bytes.length })
})

/**
 * POST /api/media/pages/:issueId  (multipart: file, page_number, [text])
 * Receives one page image rendered in the browser by pdf.js (WebP/JPEG/PNG). Re-uploading a page replaces it.
 */
mediaRoutes.post('/pages/:issueId', async (c) => {
  const db = c.get('db')
  const issue = await db.first<any>('SELECT id, publication_id, status FROM issues WHERE id = ? AND deleted_at IS NULL', [c.req.param('issueId')])
  if (!issue) throw notFound('شماره یافت نشد')
  await requirePubAccess(c, issue.publication_id, { write: true })
  if (['awaiting_approval', 'published'].includes(issue.status)) throw bad('صفحات شمارهٔ منتشرشده یا در انتظار تأیید قابل تغییر نیست')
  const { form, bytes } = await readFile(c)
  const t = sniff(bytes)
  if (!t || t.kind !== 'image') throw bad('تصویر صفحه باید WebP، JPEG یا PNG باشد')
  if (bytes.length > 8 * MB) throw bad('حجم تصویر صفحه بیش از حد است')
  const n = int(form['page_number'], 'شمارهٔ صفحه', { min: 1, max: 2000 })!
  const key = `pub/${issue.publication_id}/${issue.id}/pages/${String(n).padStart(4, '0')}-${newId().slice(0, 8)}.${t.ext}`
  const old = await db.first<{ image_key: string }>('SELECT image_key FROM issue_pages WHERE issue_id = ? AND page_number = ?', [issue.id, n])
  await c.get('deps').storage.put(key, bytes, t.mime)
  const text = typeof form['text'] === 'string' ? String(form['text']).slice(0, 20000) : null
  await db.run(
    `INSERT INTO issue_pages (id, issue_id, page_number, image_key, text_content) VALUES (?,?,?,?,?)
     ON CONFLICT(issue_id, page_number) DO UPDATE SET image_key = excluded.image_key, text_content = excluded.text_content`,
    [newId(), issue.id, n, key, text]
  )
  if (old?.image_key && old.image_key !== key) await c.get('deps').storage.delete(old.image_key).catch(() => {})
  return c.json({ ok: true, page: n })
})

/** POST /api/media/pages/:issueId/finalize  { page_count } — fixes the page count and drops stale extra pages. */
mediaRoutes.post('/pages/:issueId/finalize', async (c) => {
  const db = c.get('db')
  const issue = await db.first<any>('SELECT id, publication_id, status FROM issues WHERE id = ? AND deleted_at IS NULL', [c.req.param('issueId')])
  if (!issue) throw notFound('شماره یافت نشد')
  const { user } = await requirePubAccess(c, issue.publication_id, { write: true })
  if (['awaiting_approval', 'published'].includes(issue.status)) throw bad('این شماره قابل تغییر نیست')
  const b = (await c.req.json().catch(() => ({}))) as any
  const count = int(b.page_count, 'تعداد صفحات', { min: 1, max: 2000 })!
  const have = (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM issue_pages WHERE issue_id = ? AND page_number <= ?', [issue.id, count]))?.n ?? 0
  if (have < count) throw new HttpError(400, `فقط ${have} صفحه از ${count} صفحه بارگذاری شده است؛ بارگذاری را ادامه دهید`, 'incomplete')
  const stale = await db.all<{ image_key: string }>('SELECT image_key FROM issue_pages WHERE issue_id = ? AND page_number > ?', [issue.id, count])
  for (const s of stale) await c.get('deps').storage.delete(s.image_key).catch(() => {})
  await db.run('DELETE FROM issue_pages WHERE issue_id = ? AND page_number > ?', [issue.id, count])
  await db.run('UPDATE issues SET page_count = ?, updated_at = ? WHERE id = ?', [count, nowIso(), issue.id])
  await activity(db, user.id, 'issue.pages_processed', issue.publication_id, issue.id, { pages: count })
  return c.json({ ok: true, page_count: count })
})

/** GET /api/media/pages/:issueId/status — which pages already exist (lets an interrupted upload resume). */
mediaRoutes.get('/pages/:issueId/status', async (c) => {
  const db = c.get('db')
  const issue = await db.first<any>('SELECT id, publication_id, page_count FROM issues WHERE id = ? AND deleted_at IS NULL', [c.req.param('issueId')])
  if (!issue) throw notFound('شماره یافت نشد')
  await requirePubAccess(c, issue.publication_id)
  const rows = await db.all<{ page_number: number }>('SELECT page_number FROM issue_pages WHERE issue_id = ? ORDER BY page_number', [issue.id])
  return c.json({ page_count: issue.page_count, uploaded: rows.map((r) => r.page_number) })
})

/** DELETE /api/media/:id — remove an asset (team of the publication or admin). */
mediaRoutes.delete('/:id', async (c) => {
  const db = c.get('db')
  const m = await db.first<any>('SELECT * FROM media_assets WHERE id = ?', [c.req.param('id')])
  if (!m) throw notFound('فایل یافت نشد')
  const { user } = await requirePubAccess(c, m.publication_id, { write: true })
  if (m.issue_id && ['main_pdf', 'cover'].includes(m.role)) {
    const i = await db.first<any>('SELECT status FROM issues WHERE id = ?', [m.issue_id])
    if (i && ['awaiting_approval', 'published'].includes(i.status)) throw bad('فایل اصلی شمارهٔ منتشرشده قابل حذف نیست')
  }
  if (m.role === 'post' && (await db.first("SELECT 1 FROM posts WHERE publication_id = ? AND images_json LIKE ?", [m.publication_id, `%${m.storage_key}%`]))) {
    throw bad('این تصویر در یک پست استفاده شده است؛ ابتدا پست را حذف یا پنهان کنید')
  }
  await db.run('DELETE FROM media_assets WHERE id = ?', [m.id])
  if (m.role === 'cover') await db.run('UPDATE issues SET cover_key = NULL WHERE id = ? AND cover_key = ?', [m.issue_id, m.storage_key])
  if (m.role === 'main_pdf') await db.run('UPDATE issues SET main_pdf_key = NULL WHERE id = ? AND main_pdf_key = ?', [m.issue_id, m.storage_key])
  if (m.role === 'logo') await db.run('UPDATE publications SET logo_key = NULL WHERE id = ? AND logo_key = ?', [m.publication_id, m.storage_key])
  await c.get('deps').storage.delete(m.storage_key).catch(() => {})
  await activity(db, user.id, 'media.deleted', m.publication_id, m.issue_id, { role: m.role })
  return c.json({ ok: true })
})

/** Staff of a publication: its three main accounts, admins/officers/analysts, and the faculty supervisor of its faculty. */
async function isStaff(c: Context<AppEnv>, publicationId: string): Promise<boolean> {
  const u = c.get('user')
  if (!u) return false
  if (['super_admin', 'pub_officer', 'analyst'].includes(u.system_role)) return true
  const db = c.get('db')
  if (u.system_role === 'faculty_supervisor') return !!(await db.first('SELECT 1 FROM publications WHERE id = ? AND faculty_id = ?', [publicationId, u.scope_faculty_id]))
  return !!(await db.first('SELECT 1 FROM publication_roles WHERE user_id = ? AND publication_id = ? AND ended_at IS NULL', [u.id, publicationId]))
}

/**
 * GET /api/media/k/<key> — access-controlled file serving.
 * Public: logos, covers of published issues, images of published posts, free supplementary media of published issues.
 * Entitled readers: paid supplementary media. Staff only: main PDF, private media, unpublished content.
 * Page images: never here (reader only).
 */
mediaRoutes.get('/k/*', async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^.*?\/api\/media\/k\//, ''))
  if (!key || key.includes('..') || key.includes('/pages/')) throw notFound('فایل یافت نشد')
  const db = c.get('db')
  const m = await db.first<any>(
    `SELECT m.*, i.status AS issue_status FROM media_assets m LEFT JOIN issues i ON i.id = m.issue_id WHERE m.storage_key = ?`,
    [key]
  )
  let publicOk = false
  let pubId: string | null = m?.publication_id ?? null
  if (m) {
    const published = !m.issue_id || m.issue_status === 'published'
    if (m.role === 'logo') publicOk = true
    else if (m.role === 'cover') publicOk = m.issue_status === 'published'
    else if (m.role === 'post') publicOk = !!(await db.first("SELECT 1 FROM posts WHERE status = 'published' AND images_json LIKE ?", [`%${key}%`]))
    else if (['podcast', 'clip', 'gallery', 'attachment'].includes(m.role)) {
      if (published && m.access === 'free') publicOk = true
      else if (published && m.access === 'paid') {
        // paid audio/video: entitlement AND a short-lived signature bound to this session (lib/media-sign.ts)
        const u = c.get('user')
        const signed = await verifyMediaSig(c.get('deps').secret, key, c.get('sessionId'), c.req.query('exp'), c.req.query('sig'))
        if (u && signed && (await db.first('SELECT 1 FROM entitlements WHERE user_id = ? AND issue_id = ? AND revoked_at IS NULL', [u.id, m.issue_id]))) publicOk = true
      }
    }
  } else {
    // keys referenced directly (e.g. seeded data) without a media_assets row
    const p = await db.first<any>('SELECT id FROM publications WHERE logo_key = ?', [key])
    const i = p ? null : await db.first<any>('SELECT publication_id, status FROM issues WHERE cover_key = ?', [key])
    if (p) publicOk = true
    else if (i) {
      pubId = i.publication_id
      publicOk = i.status === 'published'
    } else {
      const po = await db.first<any>('SELECT publication_id, status FROM posts WHERE images_json LIKE ?', [`%${key}%`])
      if (!po) throw notFound('فایل یافت نشد')
      pubId = po.publication_id
      publicOk = po.status === 'published'
    }
  }
  if (!publicOk && !(pubId && (await isStaff(c, pubId)))) {
    if (!c.get('user')) throw new HttpError(401, 'برای دسترسی به این فایل وارد شوید', 'login_required')
    throw forbidden('به این فایل دسترسی ندارید')
  }
  const obj = await c.get('deps').storage.get(key)
  if (!obj) throw notFound('فایل یافت نشد')
  const headers: Record<string, string> = {
    'Content-Type': obj.contentType,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
    // public images may be cached briefly; everything else stays private
    'Cache-Control': publicOk && (!m || ['logo', 'cover', 'post'].includes(m.role)) ? 'public, max-age=3600' : 'private, max-age=300, no-transform'
  }
  if (obj.size) headers['Content-Length'] = String(obj.size)
  return new Response(obj.body as any, { headers })
})

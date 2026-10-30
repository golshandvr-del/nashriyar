import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { clientIp } from '../auth'
import { hmac, newId } from '../lib/crypto'
import { body, getSetting, inList, notFound, nowIso, parseJson, today } from '../lib/util'
import { normalizeFa } from '../../shared/fa'
import { getFeatures, requireFeature } from '../lib/features'

export const publicRoutes = new Hono<AppEnv>()

// NOTE: no public endpoint ever returns follower or view counts (see docs/ROLES.md rule 2).

const ISSUE_CARD = `i.id, i.number, i.title, i.cover_key, i.pricing, i.price_digital, i.published_at, i.page_count,
  p.id AS publication_id, p.slug AS publication_slug, p.title AS publication_title, p.theme_color`
/** ISO-8601 "now" in SQL, same format as JS toISOString() — works in both SQLite (node) and D1. */
const SQL_NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`
// Scheduled publishing: an approved issue with a future published_at stays hidden until that moment.
const PUBLISHED = `i.status = 'published' AND i.published_at <= ${SQL_NOW} AND i.deleted_at IS NULL AND p.status = 'active' AND p.deleted_at IS NULL`

// SEO sitemap (referenced from /robots.txt). Lives under /api so the Cloudflare worker serves it;
// URLs are absolute, built from the request origin so the same code works on any domain.
publicRoutes.get('/sitemap.xml', async (c) => {
  const db = c.get('db')
  const origin = new URL(c.req.url).origin
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const day = (iso?: string | null) => (iso ? iso.slice(0, 10) : undefined)
  const urls: { loc: string; lastmod?: string; priority: string }[] = [
    { loc: '/', priority: '1.0' },
    { loc: '/explore', priority: '0.8' },
    { loc: '/categories', priority: '0.6' },
    { loc: '/recruitment', priority: '0.4' }
  ]
  const pubs = await db.all<{ slug: string; last: string | null }>(
    `SELECT p.slug, (SELECT MAX(i.published_at) FROM issues i WHERE i.publication_id = p.id AND i.status = 'published' AND i.published_at <= ${SQL_NOW} AND i.deleted_at IS NULL) AS last
     FROM publications p WHERE p.status = 'active' AND p.deleted_at IS NULL`
  )
  for (const p of pubs) urls.push({ loc: `/p/${encodeURIComponent(p.slug)}`, lastmod: day(p.last), priority: '0.8' })
  const issues = await db.all<{ id: string; published_at: string | null; updated_at: string | null }>(
    `SELECT i.id, i.published_at, i.updated_at FROM issues i JOIN publications p ON p.id = i.publication_id WHERE ${PUBLISHED} ORDER BY i.published_at DESC LIMIT 5000`
  )
  for (const i of issues) urls.push({ loc: `/issue/${i.id}`, lastmod: day(i.updated_at || i.published_at), priority: '0.7' })
  const cats = await db.all<{ slug: string }>('SELECT slug FROM categories WHERE is_active = 1')
  for (const k of cats) urls.push({ loc: `/c/${encodeURIComponent(k.slug)}`, priority: '0.5' })
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${esc(origin + u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<priority>${u.priority}</priority></url>`).join('\n') +
    '\n</urlset>\n'
  return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' })
})

publicRoutes.get('/home', async (c) => {
  const db = c.get('db')
  const latest = await db.all(`SELECT ${ISSUE_CARD} FROM issues i JOIN publications p ON p.id = i.publication_id WHERE ${PUBLISHED} ORDER BY i.published_at DESC LIMIT 18`)
  const shelvesRaw = await db.all<{ id: string; title: string; issue_ids_json: string }>(
    'SELECT id, title, issue_ids_json FROM featured_shelves WHERE is_active = 1 ORDER BY sort_order LIMIT 6'
  )
  const shelves = []
  for (const s of shelvesRaw) {
    const ids = parseJson<string[]>(s.issue_ids_json, [])
    if (!ids.length) continue
    const items = await db.all(`SELECT ${ISSUE_CARD} FROM issues i JOIN publications p ON p.id = i.publication_id WHERE ${PUBLISHED} AND i.id IN (${inList(ids)})`, ids)
    if (items.length) shelves.push({ id: s.id, title: s.title, items })
  }
  const cats = await db.all<{ id: string; name: string; slug: string; icon: string; color: string }>(
    "SELECT id, name, slug, icon, color FROM categories WHERE is_active = 1 AND type = 'subject' AND parent_id IS NULL ORDER BY sort_order LIMIT 8"
  )
  const categoryShelves = []
  for (const cat of cats) {
    const items = await db.all(
      `SELECT ${ISSUE_CARD} FROM issues i JOIN publications p ON p.id = i.publication_id
       WHERE ${PUBLISHED} AND (i.id IN (SELECT issue_id FROM issue_categories WHERE category_id = ?) OR p.id IN (SELECT publication_id FROM publication_categories WHERE category_id = ?))
       ORDER BY i.published_at DESC LIMIT 12`,
      [cat.id, cat.id]
    )
    if (items.length) categoryShelves.push({ category: cat, items })
  }
  const free = await db.all(`SELECT ${ISSUE_CARD} FROM issues i JOIN publications p ON p.id = i.publication_id WHERE ${PUBLISHED} AND i.pricing = 'free' ORDER BY i.published_at DESC LIMIT 12`)
  const banners = await getSetting<any[]>(db, 'home_banners', [])
  return c.json({ latest, shelves, categoryShelves, free, categories: cats, banners })
})

publicRoutes.get('/categories', async (c) => {
  const db = c.get('db')
  const categories = await db.all('SELECT id, parent_id, type, name, slug, icon, color FROM categories WHERE is_active = 1 ORDER BY type, sort_order, name')
  const faculties = await db.all('SELECT id, name FROM faculties WHERE is_active = 1 ORDER BY sort_order, name')
  const associations = await db.all('SELECT id, name, kind, faculty_id FROM associations WHERE is_active = 1 ORDER BY name')
  return c.json({ categories, faculties, associations })
})

publicRoutes.get('/categories/:slug', async (c) => {
  const db = c.get('db')
  const cat = await db.first<{ id: string; name: string; type: string }>('SELECT id, name, type, slug, icon, color FROM categories WHERE slug = ? AND is_active = 1', [c.req.param('slug')])
  if (!cat) throw notFound('دسته یافت نشد')
  const ids = [cat.id, ...(await db.all<{ id: string }>('SELECT id FROM categories WHERE parent_id = ?', [cat.id])).map((r) => r.id)]
  const issues = await db.all(
    `SELECT ${ISSUE_CARD} FROM issues i JOIN publications p ON p.id = i.publication_id
     WHERE ${PUBLISHED} AND (i.id IN (SELECT issue_id FROM issue_categories WHERE category_id IN (${inList(ids)}))
       OR p.id IN (SELECT publication_id FROM publication_categories WHERE category_id IN (${inList(ids)})))
     ORDER BY i.published_at DESC LIMIT 120`,
    [...ids, ...ids]
  )
  const publications = await db.all(
    `SELECT p.id, p.slug, p.title, p.tagline, p.logo_key, p.theme_color FROM publications p
     WHERE p.status = 'active' AND p.deleted_at IS NULL AND p.id IN (SELECT publication_id FROM publication_categories WHERE category_id IN (${inList(ids)})) ORDER BY p.title`,
    ids
  )
  await trackView(c, 'category', cat.id, null, cat.id)
  return c.json({ category: cat, issues, publications })
})

publicRoutes.get('/publications', async (c) => {
  const db = c.get('db')
  const faculty = c.req.query('faculty')
  const association = c.req.query('association')
  const where = ["p.status = 'active'", 'p.deleted_at IS NULL']
  const params: unknown[] = []
  if (faculty) (where.push('p.faculty_id = ?'), params.push(faculty))
  if (association) (where.push('p.association_id = ?'), params.push(association))
  const rows = await db.all(
    `SELECT p.id, p.slug, p.title, p.tagline, p.logo_key, p.theme_color, a.name AS association_name, f.name AS faculty_name,
       (SELECT COUNT(*) FROM issues i WHERE i.publication_id = p.id AND i.status = 'published' AND i.published_at <= ${SQL_NOW} AND i.deleted_at IS NULL) AS issue_count
     FROM publications p JOIN associations a ON a.id = p.association_id LEFT JOIN faculties f ON f.id = p.faculty_id
     WHERE ${where.join(' AND ')} ORDER BY p.title`,
    params
  )
  return c.json({ publications: rows })
})

publicRoutes.get('/publications/:slug', async (c) => {
  const db = c.get('db')
  const p = await db.first<any>(
    `SELECT p.id, p.slug, p.title, p.tagline, p.description, p.logo_key, p.theme_color, p.frequency, p.license_number, p.keywords,
       p.contacts_json, p.founded_at, a.id AS association_id, a.name AS association_name, a.kind AS association_kind, f.name AS faculty_name, f.id AS faculty_id
     FROM publications p JOIN associations a ON a.id = p.association_id LEFT JOIN faculties f ON f.id = p.faculty_id
     WHERE p.slug = ? AND p.status = 'active' AND p.deleted_at IS NULL`,
    [c.req.param('slug')]
  )
  if (!p) throw notFound('نشریه یافت نشد')
  const issues = await db.all(`SELECT ${ISSUE_CARD} FROM issues i JOIN publications p ON p.id = i.publication_id WHERE ${PUBLISHED} AND p.id = ? ORDER BY i.number DESC`, [p.id])
  const roles = await db.all(
    `SELECT r.role, u.display_name FROM publication_roles r JOIN users u ON u.id = r.user_id WHERE r.publication_id = ? AND r.ended_at IS NULL`,
    [p.id]
  )
  const team = await db.all('SELECT full_name, default_role FROM team_members WHERE publication_id = ? AND is_active = 1 ORDER BY full_name', [p.id])
  const categories = await db.all(
    'SELECT c.id, c.name, c.slug FROM categories c JOIN publication_categories pc ON pc.category_id = c.id WHERE pc.publication_id = ?',
    [p.id]
  )
  const highlights = await db.all<{ id: string; title: string }>('SELECT id, title FROM highlights WHERE publication_id = ? ORDER BY sort_order', [p.id])
  const hl = []
  for (const h of highlights) {
    const posts = await db.all<{ id: string; images_json: string }>(
      `SELECT po.id, po.images_json FROM posts po JOIN highlight_items hi ON hi.post_id = po.id WHERE hi.highlight_id = ? AND po.status = 'published' ORDER BY po.published_at DESC`,
      [h.id]
    )
    if (posts.length) hl.push({ ...h, cover: parseJson<string[]>(posts[0].images_json, [])[0] || null, post_ids: posts.map((x) => x.id) })
  }
  const recruitment = await db.all('SELECT id, title, roles_needed, body, contact, open_until FROM recruitment_calls WHERE publication_id = ? AND (open_until IS NULL OR open_until >= ?) ORDER BY created_at DESC', [p.id, today()])
  const u = c.get('user')
  const following = u ? !!(await db.first('SELECT 1 FROM follows WHERE user_id = ? AND publication_id = ? AND unfollowed_at IS NULL', [u.id, p.id])) : false
  await trackView(c, 'publication', p.id, p.id)
  return c.json({ publication: { ...p, contacts: parseJson(p.contacts_json, []), contacts_json: undefined }, issues, roles, team, categories, highlights: hl, recruitment, following })
})

publicRoutes.get('/publications/:slug/posts', async (c) => {
  const db = c.get('db')
  const p = await db.first<{ id: string }>("SELECT id FROM publications WHERE slug = ? AND status = 'active' AND deleted_at IS NULL", [c.req.param('slug')])
  if (!p) throw notFound('نشریه یافت نشد')
  const posts = await db.all<any>(
    `SELECT po.id, po.caption, po.images_json, po.published_at, po.is_story, po.expires_at FROM posts po
     WHERE po.publication_id = ? AND po.status = 'published' AND (po.is_story = 0 OR po.expires_at > ?) ORDER BY po.published_at DESC LIMIT 120`,
    [p.id, nowIso()]
  )
  return c.json({ posts: posts.map((x) => ({ ...x, images: parseJson(x.images_json, []), images_json: undefined })) })
})

publicRoutes.get('/issues/:id', async (c) => {
  const db = c.get('db')
  const i = await db.first<any>(
    `SELECT i.id, i.number, i.title, i.summary, i.keywords, i.cover_key, i.pricing, i.price_digital, i.price_print, i.print_run,
       i.free_preview_pages, i.published_at, i.page_count, p.id AS publication_id, p.slug AS publication_slug, p.title AS publication_title,
       p.theme_color, p.logo_key, p.contacts_json, a.name AS association_name
     FROM issues i JOIN publications p ON p.id = i.publication_id JOIN associations a ON a.id = p.association_id
     WHERE i.id = ? AND ${PUBLISHED}`,
    [c.req.param('id')]
  )
  if (!i) throw notFound('شماره یافت نشد')
  const toc = await db.all<any>('SELECT id, parent_id, title, kind, page_start, page_end, sort_order FROM issue_toc_items WHERE issue_id = ? ORDER BY sort_order', [i.id])
  const assigns = await db.all<any>(
    `SELECT ta.toc_item_id, ta.role, tm.full_name FROM toc_assignments ta JOIN team_members tm ON tm.id = ta.team_member_id
     JOIN issue_toc_items t ON t.id = ta.toc_item_id WHERE t.issue_id = ?`,
    [i.id]
  )
  const tocOut = toc.map((t) => ({ ...t, bylines: assigns.filter((a) => a.toc_item_id === t.id).map((a) => ({ role: a.role, name: a.full_name })) }))
  const media = await db.all(
    "SELECT id, kind, role, title, mime, access, toc_item_id, storage_key FROM media_assets WHERE issue_id = ? AND role IN ('podcast','clip','gallery','attachment') ORDER BY sort_order",
    [i.id]
  )
  const credits = await db.all(
    'SELECT im.production_role, tm.full_name FROM issue_members im JOIN team_members tm ON tm.id = im.team_member_id WHERE im.issue_id = ? ORDER BY im.production_role',
    [i.id]
  )
  const categories = await db.all('SELECT c.id, c.name, c.slug FROM categories c JOIN issue_categories ic ON ic.category_id = c.id WHERE ic.issue_id = ?', [i.id])
  const others = await db.all(`SELECT ${ISSUE_CARD} FROM issues i JOIN publications p ON p.id = i.publication_id WHERE ${PUBLISHED} AND p.id = ? AND i.id <> ? ORDER BY i.number DESC LIMIT 10`, [i.publication_id, i.id])
  const u = c.get('user')
  let access: 'full' | 'preview' = i.pricing === 'free' ? 'full' : 'preview'
  let inLibrary = false
  if (u) {
    const ent = await db.first('SELECT 1 FROM entitlements WHERE user_id = ? AND issue_id = ? AND revoked_at IS NULL', [u.id, i.id])
    inLibrary = !!ent
    if (ent || ['super_admin', 'pub_officer'].includes(u.system_role)) access = 'full'
    else if (await db.first('SELECT 1 FROM publication_roles WHERE user_id = ? AND publication_id = ? AND ended_at IS NULL', [u.id, i.publication_id])) access = 'full'
  }
  await trackView(c, 'issue', i.id, i.publication_id)
  return c.json({
    issue: { ...i, contacts: parseJson(i.contacts_json, []), contacts_json: undefined },
    toc: tocOut,
    media,
    credits,
    categories,
    others,
    access,
    inLibrary
  })
})

publicRoutes.get('/search', async (c) => {
  const db = c.get('db')
  const raw = (c.req.query('q') || '').slice(0, 100)
  const q = normalizeFa(raw)
  if (q.length < 2) return c.json({ q: raw, publications: [], issues: [], people: [] })
  const like = `%${q}%`
  const pricing = c.req.query('pricing')
  const pubs = await db.all(
    `SELECT p.id, p.slug, p.title, p.tagline, p.logo_key, p.theme_color FROM publications p WHERE p.status = 'active' AND p.deleted_at IS NULL AND p.search_text LIKE ? ORDER BY p.title LIMIT 20`,
    [like]
  )
  const issueWhere = [PUBLISHED, `(i.search_text LIKE ? OR i.id IN (SELECT t.issue_id FROM issue_toc_items t WHERE t.title LIKE ?)
      OR i.id IN (SELECT t.issue_id FROM issue_toc_items t JOIN toc_assignments ta ON ta.toc_item_id = t.id JOIN team_members tm ON tm.id = ta.team_member_id WHERE tm.full_name LIKE ?)
      OR i.id IN (SELECT ip.issue_id FROM issue_pages ip WHERE ip.text_content LIKE ?))`]
  const params: unknown[] = [like, like, like, like]
  if (pricing === 'free' || pricing === 'paid') (issueWhere.push('i.pricing = ?'), params.push(pricing))
  const issues = await db.all(`SELECT ${ISSUE_CARD} FROM issues i JOIN publications p ON p.id = i.publication_id WHERE ${issueWhere.join(' AND ')} ORDER BY i.published_at DESC LIMIT 60`, params)
  const people = await db.all(
    `SELECT tm.full_name, COUNT(DISTINCT t.issue_id) AS issue_count FROM team_members tm JOIN toc_assignments ta ON ta.team_member_id = tm.id
     JOIN issue_toc_items t ON t.id = ta.toc_item_id JOIN issues i ON i.id = t.issue_id WHERE i.status = 'published' AND i.published_at <= ${SQL_NOW} AND tm.full_name LIKE ? GROUP BY tm.full_name LIMIT 10`,
    [like]
  )
  await trackView(c, 'search', q.slice(0, 60), null)
  return c.json({ q: raw, publications: pubs, issues, people })
})

publicRoutes.get('/faculties/:id', async (c) => {
  const db = c.get('db')
  const f = await db.first('SELECT id, name FROM faculties WHERE id = ? AND is_active = 1', [c.req.param('id')])
  if (!f) throw notFound()
  const publications = await db.all(
    "SELECT p.id, p.slug, p.title, p.tagline, p.logo_key, p.theme_color FROM publications p WHERE p.faculty_id = ? AND p.status = 'active' AND p.deleted_at IS NULL ORDER BY p.title",
    [c.req.param('id')]
  )
  const issues = await db.all(`SELECT ${ISSUE_CARD} FROM issues i JOIN publications p ON p.id = i.publication_id WHERE ${PUBLISHED} AND p.faculty_id = ? ORDER BY i.published_at DESC LIMIT 30`, [c.req.param('id')])
  return c.json({ faculty: f, publications, issues })
})

/** Association (scientific society) / cultural club page — ROADMAP phase 4. */
publicRoutes.get('/associations/:id', async (c) => {
  const db = c.get('db')
  const a = await db.first<any>(
    'SELECT a.id, a.name, a.kind, f.id AS faculty_id, f.name AS faculty_name FROM associations a LEFT JOIN faculties f ON f.id = a.faculty_id WHERE a.id = ? AND a.is_active = 1',
    [c.req.param('id')]
  )
  if (!a) throw notFound()
  const publications = await db.all(
    "SELECT p.id, p.slug, p.title, p.tagline, p.logo_key, p.theme_color FROM publications p WHERE p.association_id = ? AND p.status = 'active' AND p.deleted_at IS NULL ORDER BY p.title",
    [a.id]
  )
  const issues = await db.all(`SELECT ${ISSUE_CARD} FROM issues i JOIN publications p ON p.id = i.publication_id WHERE ${PUBLISHED} AND p.association_id = ? ORDER BY i.published_at DESC LIMIT 30`, [a.id])
  return c.json({ association: a, publications, issues })
})

// ───────── Explore (image-only feed) ─────────
publicRoutes.get('/explore', async (c) => {
  await requireFeature(c.get('db'), 'explore')
  const db = c.get('db')
  const before = c.req.query('before') || '9999'
  const cat = c.req.query('category')
  const params: unknown[] = [before, nowIso()]
  let catWhere = ''
  if (cat) {
    catWhere = ' AND po.publication_id IN (SELECT publication_id FROM publication_categories WHERE category_id = ?)'
    params.push(cat)
  }
  const posts = await db.all<any>(
    `SELECT po.id, po.caption, po.images_json, po.published_at, p.slug AS publication_slug, p.title AS publication_title, p.logo_key, p.theme_color
     FROM posts po JOIN publications p ON p.id = po.publication_id
     WHERE po.status = 'published' AND po.published_at < ? AND (po.is_story = 0 OR po.expires_at > ?) AND p.status = 'active'${catWhere}
     ORDER BY po.published_at DESC LIMIT 30`,
    params
  )
  // Mixed ordering (ROADMAP phase 6): recency first, but never two posts of the same publication in a row when
  // another candidate exists (diversity over popularity). Paging uses `next` (oldest timestamp of this page).
  const pool = [...posts]
  const mixed: typeof pool = []
  while (pool.length) {
    const prev = mixed[mixed.length - 1]?.publication_slug
    let k = pool.findIndex((x) => x.publication_slug !== prev)
    if (k < 0) k = 0
    mixed.push(pool.splice(k, 1)[0])
  }
  const next = posts.length ? posts[posts.length - 1].published_at : null
  return c.json({ next, posts: mixed.map((x) => ({ ...x, images: parseJson(x.images_json, []), images_json: undefined })) })
})

publicRoutes.get('/stories', async (c) => {
  const db = c.get('db')
  const rows = await db.all<any>(
    `SELECT po.id, po.images_json, po.caption, po.published_at, p.slug AS publication_slug, p.title AS publication_title, p.logo_key, p.theme_color
     FROM posts po JOIN publications p ON p.id = po.publication_id
     WHERE po.status = 'published' AND po.is_story = 1 AND po.expires_at > ? AND p.status = 'active' ORDER BY po.published_at DESC LIMIT 60`,
    [nowIso()]
  )
  return c.json({ stories: rows.map((x) => ({ ...x, images: parseJson(x.images_json, []), images_json: undefined })) })
})

publicRoutes.get('/posts/:id', async (c) => {
  await requireFeature(c.get('db'), 'explore')
  const db = c.get('db')
  const po = await db.first<any>(
    `SELECT po.id, po.caption, po.images_json, po.published_at, po.publication_id, po.source_issue_id, po.source_toc_item_id,
       p.slug AS publication_slug, p.title AS publication_title, p.logo_key, p.theme_color,
       i.title AS source_issue_title, i.number AS source_issue_number, t.title AS source_toc_title, t.page_start AS source_page
     FROM posts po JOIN publications p ON p.id = po.publication_id JOIN issues i ON i.id = po.source_issue_id
     LEFT JOIN issue_toc_items t ON t.id = po.source_toc_item_id
     WHERE po.id = ? AND po.status = 'published'`,
    [c.req.param('id')]
  )
  if (!po) throw notFound('پست یافت نشد')
  const comments = await db.all(
    `SELECT cm.id, cm.body, cm.created_at, cm.parent_id, cm.is_team_reply, CASE WHEN cm.is_team_reply = 1 THEN ? ELSE u.display_name END AS author
     FROM comments cm LEFT JOIN users u ON u.id = cm.user_id WHERE cm.post_id = ? AND cm.status = 'approved' ORDER BY cm.created_at`,
    [po.publication_title, po.id]
  )
  const u = c.get('user')
  const saved = u ? !!(await db.first('SELECT 1 FROM saved_posts WHERE user_id = ? AND post_id = ?', [u.id, po.id])) : false
  await trackView(c, 'post', po.id, po.publication_id)
  return c.json({ post: { ...po, images: parseJson(po.images_json, []), images_json: undefined }, comments, saved })
})

publicRoutes.get('/recruitment', async (c) => {
  await requireFeature(c.get('db'), 'recruitment')
  const rows = await c.get('db').all(
    `SELECT r.id, r.title, r.roles_needed, r.body, r.contact, r.open_until, p.slug AS publication_slug, p.title AS publication_title
     FROM recruitment_calls r JOIN publications p ON p.id = r.publication_id WHERE (r.open_until IS NULL OR r.open_until >= ?) AND p.status = 'active' ORDER BY r.created_at DESC`,
    [today()]
  )
  return c.json({ calls: rows })
})

publicRoutes.get('/certificates/:code', async (c) => {
  await requireFeature(c.get('db'), 'certificates')
  const r = await c.get('db').first(
    `SELECT ce.verify_code, ce.roles, ce.issued_at, tm.full_name, i.title AS issue_title, i.number AS issue_number, p.title AS publication_title
     FROM certificates ce JOIN team_members tm ON tm.id = ce.team_member_id JOIN issues i ON i.id = ce.issue_id JOIN publications p ON p.id = i.publication_id
     WHERE ce.verify_code = ?`,
    [c.req.param('code').toUpperCase()]
  )
  if (!r) throw notFound('گواهی با این کد یافت نشد')
  return c.json({ certificate: r })
})

publicRoutes.get('/settings', async (c) => {
  const db = c.get('db')
  return c.json({
    site_name: await getSetting(db, 'site_name', 'نشریار'),
    university_name: await getSetting(db, 'university_name', 'دانشگاه'),
    registration_open: await getSetting(db, 'registration_open', true),
    ai_enabled: await getSetting(db, 'ai_enabled', false),
    features: await getFeatures(db)
  })
})

/** Client-side beacon for views that do not hit an API (e.g. reader page turns are tracked server-side). */
publicRoutes.post('/track', async (c) => {
  const b = await body<{ type?: string; id?: string }>(c)
  if (b.type === 'explore') await trackView(c, 'explore', null, null)
  return c.json({ ok: true })
})

/** Records a de-duplicated (per viewer per day) view event. Viewer identity is an HMAC of IP+UA or user id. */
export async function trackView(c: any, entityType: string, entityId: string | null, publicationId: string | null, categoryId: string | null = null) {
  try {
    const db = c.get('db')
    const u = c.get('user')
    const day = today()
    const viewer = await hmac(c.get('deps').secret, `${day}|${u?.id || clientIp(c) + '|' + (c.req.header('user-agent') || '')}`)
    const vh = viewer.slice(0, 24)
    const dup = await db.first('SELECT 1 FROM view_events WHERE entity_type = ? AND entity_id IS ? AND viewer_hash = ? AND day = ?', [entityType, entityId, vh, day])
    if (dup) return
    await db.run(
      'INSERT INTO view_events (id, entity_type, entity_id, publication_id, category_id, viewer_hash, user_id, day, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [newId(), entityType, entityId, publicationId, categoryId, vh, u?.id ?? null, day, nowIso()]
    )
  } catch (e) {
    console.error('trackView failed', e)
  }
}

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../context'
import { requirePubAccess, requireUser, userPubRoles } from '../auth'
import { generatePurchaseCode, newId, normalizePurchaseCode, sha256 } from '../lib/crypto'
import {
  activity, addHours, audit, bad, body, dateRange, getSetting, HttpError, inList, int, keywordsCsv, notFound, notify, nowIso, oneOf, parseJson, str
} from '../lib/util'
import { normalizeFa, toEnDigits } from '../../shared/fa'
import { requireFeature } from '../lib/features'
import { ensureReminders } from '../lib/reminders'
import { aiCommentLabels, draftCaption, ruleCommentLabel, suggestCategories, suggestKeywords } from '../ai'
import { flagComment } from '../lib/moderation'
import { traceCode } from './reader'

export const teamRoutes = new Hono<AppEnv>()

// Every /api/team/:pubId/* request is checked: the user must hold one of the three main roles of THIS publication.
// Follower data is NEVER returned from this router (docs/ROLES.md rule 2).

export const DEFAULT_STAGES = [
  { key: 'writing', title: 'نویسندگی' },
  { key: 'editing', title: 'ویراستاری' },
  { key: 'graphics', title: 'گرافیک و تصویرسازی' },
  { key: 'layout', title: 'صفحه‌آرایی' },
  { key: 'review', title: 'بازبینی نهایی' },
  { key: 'publish', title: 'انتشار' }
]
const STAGE_STATUS = ['pending', 'in_progress', 'done', 'skipped'] as const
const TOC_STATUS = ['todo', 'writing', 'written', 'editing', 'edited', 'done'] as const
const EDITABLE_ISSUE = ['planning', 'in_production', 'changes_requested']

teamRoutes.get('/my', async (c) => {
  const u = requireUser(c)
  return c.json({ publications: await userPubRoles(c, u.id) })
})

async function pub(c: Context<AppEnv>, write = false) {
  const id = c.req.param('pubId')!
  const access = await requirePubAccess(c, id, { write })
  const p = await c.get('db').first<any>('SELECT * FROM publications WHERE id = ? AND deleted_at IS NULL', [id])
  if (!p) throw notFound('نشریه یافت نشد')
  return { ...access, pub: p }
}

async function issueOf(c: Context<AppEnv>, pubId: string, issueId: string) {
  const i = await c.get('db').first<any>('SELECT * FROM issues WHERE id = ? AND publication_id = ? AND deleted_at IS NULL', [issueId, pubId])
  if (!i) throw notFound('شماره یافت نشد')
  return i
}

function assertEditable(i: any) {
  if (!EDITABLE_ISSUE.includes(i.status)) throw bad('این شماره در انتظار تأیید یا منتشرشده است و قابل ویرایش ساختاری نیست')
}

async function refreshIssueSearch(c: Context<AppEnv>, issueId: string) {
  const db = c.get('db')
  const i = await db.first<any>('SELECT i.title, i.summary, i.keywords, i.number, p.title AS pt FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.id = ?', [issueId])
  if (!i) return
  await db.run('UPDATE issues SET search_text = ?, updated_at = ? WHERE id = ?', [normalizeFa([i.title, i.summary, i.keywords, i.pt, 'شماره ' + i.number].join(' ')), nowIso(), issueId])
}

// ───────── Dashboard ─────────
teamRoutes.get('/:pubId/dashboard', async (c) => {
  const { pub: p, role } = await pub(c)
  const db = c.get('db')
  await ensureReminders(db).catch(() => false) // lazy, at most once per day
  const issues = await db.all<any>(
    `SELECT i.id, i.number, i.title, i.status, i.planned_publish_at, i.published_at, i.cover_key, i.progress_view,
       (SELECT COUNT(*) FROM issue_toc_items t WHERE t.issue_id = i.id) AS toc_total,
       (SELECT COUNT(*) FROM issue_toc_items t WHERE t.issue_id = i.id AND t.status = 'done') AS toc_done,
       (SELECT COUNT(*) FROM issue_stages s WHERE s.issue_id = i.id) AS stage_total,
       (SELECT COUNT(*) FROM issue_stages s WHERE s.issue_id = i.id AND s.status IN ('done','skipped')) AS stage_done
     FROM issues i WHERE i.publication_id = ? AND i.deleted_at IS NULL ORDER BY i.number DESC`,
    [p.id]
  )
  const now = nowIso()
  const overdue = await db.all(
    `SELECT t.id, t.title, t.due_at, t.status, i.id AS issue_id, i.title AS issue_title FROM issue_toc_items t JOIN issues i ON i.id = t.issue_id
     WHERE i.publication_id = ? AND i.deleted_at IS NULL AND i.status NOT IN ('published','archived') AND t.status <> 'done' AND t.due_at IS NOT NULL AND t.due_at < ? ORDER BY t.due_at LIMIT 20`,
    [p.id, now]
  )
  const overdueStages = await db.all(
    `SELECT s.id, s.title, s.due_at, s.status, i.id AS issue_id, i.title AS issue_title FROM issue_stages s JOIN issues i ON i.id = s.issue_id
     WHERE i.publication_id = ? AND i.deleted_at IS NULL AND i.status NOT IN ('published','archived') AND s.status NOT IN ('done','skipped') AND s.due_at IS NOT NULL AND s.due_at < ? ORDER BY s.due_at LIMIT 20`,
    [p.id, now]
  )
  const pendingComments = (await db.first<{ n: number }>(
    "SELECT COUNT(*) AS n FROM comments cm JOIN posts po ON po.id = cm.post_id WHERE po.publication_id = ? AND cm.status = 'pending'",
    [p.id]
  ))?.n ?? 0
  const members = (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM team_members WHERE publication_id = ? AND is_active = 1', [p.id]))?.n ?? 0
  const deadlines = await db.all('SELECT id, title, due_at, description FROM deadlines WHERE due_at >= ? ORDER BY due_at LIMIT 5', [now.slice(0, 10)])
  const announcements = await db.all(
    `SELECT a.id, a.title, a.body, a.pinned, a.created_at FROM announcements a
     WHERE a.audience = 'all' OR (a.audience = 'publication' AND a.target_id = ?) OR (a.audience = 'faculty' AND a.target_id = ?)
     ORDER BY a.pinned DESC, a.created_at DESC LIMIT 5`,
    [p.id, p.faculty_id]
  )
  // ROADMAP phase 9: read receipts — announcements shown on the dashboard count as read by this user
  const viewer = c.get('user')
  if (viewer) for (const a of announcements as any[]) await db.run('INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id, read_at) VALUES (?,?,?)', [a.id, viewer.id, now])
  return c.json({ publication: p, role, issues, overdue, overdueStages, pendingComments, members, deadlines, announcements })
})

// ───────── Publication profile (limited fields editable by team) ─────────
teamRoutes.put('/:pubId/profile', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const b = await body<any>(c)
  const db = c.get('db')
  const contacts = Array.isArray(b.contacts)
    ? b.contacts.slice(0, 10).map((x: any) => ({ kind: String(x.kind || 'other').slice(0, 20), value: String(x.value || '').slice(0, 120), label: String(x.label || '').slice(0, 60) })).filter((x: any) => x.value)
    : parseJson(p.contacts_json, [])
  const next = {
    tagline: str(b.tagline, 'شعار', { max: 140, optional: true }),
    description: str(b.description, 'معرفی', { max: 3000, optional: true }),
    keywords: keywordsCsv(b.keywords ?? p.keywords),
    theme_color: /^#[0-9a-fA-F]{6}$/.test(String(b.theme_color)) ? b.theme_color : p.theme_color,
    contacts_json: JSON.stringify(contacts)
  }
  await db.run('UPDATE publications SET tagline = ?, description = ?, keywords = ?, theme_color = ?, contacts_json = ?, search_text = ? WHERE id = ?', [
    next.tagline, next.description, next.keywords, next.theme_color, next.contacts_json,
    normalizeFa([p.title, next.tagline, next.description, next.keywords].join(' ')), p.id
  ])
  await audit(db, user.id, 'publication.profile_update', 'publication', p.id, { tagline: p.tagline, description: p.description }, next)
  return c.json({ ok: true })
})

// ───────── Members ─────────
teamRoutes.get('/:pubId/members', async (c) => {
  const { pub: p } = await pub(c)
  const db = c.get('db')
  const members = await db.all(
    `SELECT tm.*, f.name AS faculty_name, m.name AS major_name,
       (SELECT COUNT(DISTINCT im.issue_id) FROM issue_members im WHERE im.team_member_id = tm.id) AS issue_count,
       (SELECT COUNT(*) FROM toc_assignments ta WHERE ta.team_member_id = tm.id) AS section_count
     FROM team_members tm LEFT JOIN faculties f ON f.id = tm.faculty_id LEFT JOIN majors m ON m.id = tm.major_id
     WHERE tm.publication_id = ? ORDER BY tm.is_active DESC, tm.full_name`,
    [p.id]
  )
  const roles = await db.all('SELECT id, name FROM production_roles ORDER BY sort_order, name')
  return c.json({ members, roles })
})

function memberFields(b: any) {
  return {
    full_name: str(b.full_name, 'نام و نام خانوادگی', { min: 2, max: 80 }),
    student_number: toEnDigits(str(b.student_number, 'شماره دانشجویی', { max: 20, optional: true })),
    faculty_id: b.faculty_id || null,
    major_id: b.major_id || null,
    default_role: str(b.default_role, 'نقش پیش‌فرض', { max: 120, optional: true }),
    phone: toEnDigits(str(b.phone, 'تلفن', { max: 20, optional: true })),
    joined_at: str(b.joined_at, 'تاریخ پیوستن', { max: 10, optional: true }) || null
  }
}

teamRoutes.post('/:pubId/members', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const f = memberFields(await body(c))
  const id = newId()
  const db = c.get('db')
  await db.run(
    'INSERT INTO team_members (id, publication_id, full_name, student_number, faculty_id, major_id, default_role, phone, joined_at, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?)',
    [id, p.id, f.full_name, f.student_number || null, f.faculty_id, f.major_id, f.default_role, f.phone, f.joined_at || nowIso().slice(0, 10), nowIso()]
  )
  await activity(db, user.id, 'member.added', p.id, null, { id, name: f.full_name })
  return c.json({ ok: true, id })
})

teamRoutes.put('/:pubId/members/:id', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const b = await body<any>(c)
  const f = memberFields(b)
  const db = c.get('db')
  const active = b.is_active === false || b.is_active === 0 ? 0 : 1
  const r = await db.run(
    `UPDATE team_members SET full_name = ?, student_number = ?, faculty_id = ?, major_id = ?, default_role = ?, phone = ?, joined_at = COALESCE(?, joined_at),
       is_active = ?, left_at = CASE WHEN ? = 0 THEN COALESCE(left_at, ?) ELSE NULL END WHERE id = ? AND publication_id = ?`,
    [f.full_name, f.student_number || null, f.faculty_id, f.major_id, f.default_role, f.phone, f.joined_at, active, active, nowIso().slice(0, 10), c.req.param('id'), p.id]
  )
  if (!r.changes) throw notFound('عضو یافت نشد')
  await activity(db, user.id, active ? 'member.updated' : 'member.deactivated', p.id, null, { id: c.req.param('id') })
  return c.json({ ok: true })
})

teamRoutes.get('/:pubId/members/:id', async (c) => {
  const { pub: p } = await pub(c)
  const db = c.get('db')
  const m = await db.first('SELECT * FROM team_members WHERE id = ? AND publication_id = ?', [c.req.param('id'), p.id])
  if (!m) throw notFound('عضو یافت نشد')
  const issues = await db.all(
    `SELECT i.id, i.number, i.title, i.status, im.production_role FROM issue_members im JOIN issues i ON i.id = im.issue_id WHERE im.team_member_id = ? AND i.deleted_at IS NULL ORDER BY i.number DESC`,
    [c.req.param('id')]
  )
  const sections = await db.all(
    `SELECT t.id, t.title, t.status, ta.role, i.number AS issue_number, i.title AS issue_title FROM toc_assignments ta JOIN issue_toc_items t ON t.id = ta.toc_item_id
     JOIN issues i ON i.id = t.issue_id WHERE ta.team_member_id = ? ORDER BY i.number DESC, t.sort_order`,
    [c.req.param('id')]
  )
  return c.json({ member: m, issues, sections })
})

// ───────── Issues ─────────
teamRoutes.get('/:pubId/issues', async (c) => {
  const { pub: p } = await pub(c)
  const rows = await c.get('db').all(
    `SELECT i.id, i.number, i.title, i.status, i.pricing, i.planned_publish_at, i.published_at, i.page_count, i.cover_key, i.updated_at,
       (SELECT COUNT(*) FROM issue_toc_items t WHERE t.issue_id = i.id) AS toc_total,
       (SELECT COUNT(*) FROM issue_toc_items t WHERE t.issue_id = i.id AND t.status = 'done') AS toc_done
     FROM issues i WHERE i.publication_id = ? AND i.deleted_at IS NULL ORDER BY i.number DESC`,
    [p.id]
  )
  const next = await c.get('db').first<{ n: number }>('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM issues WHERE publication_id = ?', [p.id])
  return c.json({ issues: rows, next_number: next?.n ?? 1 })
})

teamRoutes.get('/:pubId/keywords', async (c) => {
  const { pub: p } = await pub(c)
  const rows = await c.get('db').all<{ keywords: string }>("SELECT keywords FROM issues WHERE keywords IS NOT NULL AND keywords <> '' AND deleted_at IS NULL")
  const counts = new Map<string, number>()
  for (const r of rows) for (const k of r.keywords.split('،')) if (k.trim()) counts.set(k.trim(), (counts.get(k.trim()) || 0) + 1)
  for (const k of String(p.keywords || '').split('،')) if (k.trim()) counts.set(k.trim(), (counts.get(k.trim()) || 0) + 5)
  return c.json({ keywords: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200).map(([k]) => k) })
})

/**
 * Keyword suggestions from the issue's own text (title, summary, TOC titles) — ROADMAP phase 10.
 * Uses the optional AI provider when enabled; otherwise a frequency-based extraction (never fails).
 * Only the issue text is sent; no personal data.
 */
teamRoutes.post('/:pubId/keywords/suggest', async (c) => {
  await pub(c)
  const b = await body<{ text?: string }>(c)
  const text = normalizeFa(String(b.text || '')).slice(0, 4000)
  if (text.length < 3) return c.json({ keywords: [] })
  return c.json({ keywords: await suggestKeywords(c, text) })
})

/** Category suggestions (ROADMAP phase 10): AI may only pick from existing non-major categories; word-overlap fallback. */
teamRoutes.post('/:pubId/categories/suggest', async (c) => {
  await pub(c)
  const b = await body<{ text?: string }>(c)
  const text = String(b.text || '').slice(0, 4000)
  if (text.trim().length < 3) return c.json({ category_ids: [] })
  const cats = await c.get('db').all<{ id: string; name: string }>("SELECT id, name FROM categories WHERE type <> 'major' ORDER BY sort_order, name")
  return c.json({ category_ids: await suggestCategories(c, text, cats) })
})

/** Caption draft for an explore post from its source TOC section (AI when enabled; editable template otherwise). */
teamRoutes.post('/:pubId/captions/draft', async (c) => {
  const { pub: p } = await pub(c)
  const b = await body<{ issue_id?: string; toc_item_id?: string }>(c)
  const issue = await issueOf(c, p.id, String(b.issue_id || ''))
  const toc = await c.get('db').first<{ title: string }>('SELECT title FROM issue_toc_items WHERE id = ? AND issue_id = ?', [String(b.toc_item_id || ''), issue.id])
  if (!toc) throw notFound('بخش یافت نشد')
  return c.json(await draftCaption(c, { section: toc.title, issue_title: issue.title, issue_number: issue.number, summary: issue.summary, publication: p.title }))
})

/**
 * Wizard submit: creates an issue with TOC tree, active members, section assignments and stage plan in one go.
 * body: { title, summary, keywords[], category_ids[], progress_view, planned_publish_at,
 *         toc: [{ key, title, kind, parent_key?, due_at?, assignments: [{ member_id, role }] }],
 *         members: [{ member_id, production_role }], stages?: [{ key, title, due_at? }] }
 */
teamRoutes.post('/:pubId/issues', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const db = c.get('db')
  const b = await body<any>(c)
  const title = str(b.title, 'عنوان شماره', { min: 2, max: 160 })
  const next = await db.first<{ n: number }>('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM issues WHERE publication_id = ?', [p.id])
  const number = b.number ? int(b.number, 'شمارهٔ ترتیبی', { min: 1, max: 100000 })! : next?.n ?? 1
  if (await db.first('SELECT 1 FROM issues WHERE publication_id = ? AND number = ? AND deleted_at IS NULL', [p.id, number])) throw bad(`شمارهٔ ${number} قبلاً ثبت شده است`)
  const id = newId()
  const now = nowIso()
  const director = await db.first<{ user_id: string }>("SELECT user_id FROM publication_roles WHERE publication_id = ? AND role = 'managing_director' AND ended_at IS NULL", [p.id])
  // officer-configurable default purchase-code validity (ROADMAP phase 5; client decision #5: max 24h)
  const defTtl = Math.max(1, Math.min(24, Math.floor(Number(await getSetting(db, 'default_code_ttl_hours', 24)) || 24)))
  const stmts: { sql: string; params: unknown[] }[] = []
  stmts.push({
    sql: `INSERT INTO issues (id, publication_id, number, title, summary, keywords, status, progress_view, planned_publish_at, director_user_id, created_by, created_at, updated_at, code_ttl_hours)
          VALUES (?,?,?,?,?,?, 'planning', ?,?,?,?,?,?,?)`,
    params: [id, p.id, number, title, str(b.summary, 'خلاصه', { max: 3000, optional: true }), keywordsCsv(b.keywords),
      oneOf(b.progress_view, ['timeline', 'checklist', 'kanban'] as const, 'نمای پیشرفت', 'timeline'), b.planned_publish_at || null, director?.user_id ?? null, user.id, now, now, defTtl]
  })
  for (const cid of (Array.isArray(b.category_ids) ? b.category_ids : []).slice(0, 10)) stmts.push({ sql: 'INSERT OR IGNORE INTO issue_categories (issue_id, category_id) VALUES (?,?)', params: [id, cid] })

  const memberIds = new Set((await db.all<{ id: string }>('SELECT id FROM team_members WHERE publication_id = ?', [p.id])).map((r) => r.id))
  for (const m of (Array.isArray(b.members) ? b.members : []).slice(0, 200)) {
    if (!memberIds.has(m.member_id)) continue
    stmts.push({ sql: 'INSERT INTO issue_members (id, issue_id, team_member_id, production_role, note) VALUES (?,?,?,?,?)', params: [newId(), id, m.member_id, String(m.production_role || 'همکار').slice(0, 60), m.note || null] })
  }
  const keyToId = new Map<string, string>()
  const toc = (Array.isArray(b.toc) ? b.toc : []).slice(0, 300)
  toc.forEach((t: any, idx: number) => keyToId.set(String(t.key ?? idx), newId()))
  toc.forEach((t: any, idx: number) => {
    const tid = keyToId.get(String(t.key ?? idx))!
    const tTitle = String(t.title || '').trim().slice(0, 200)
    if (!tTitle) return
    stmts.push({
      sql: 'INSERT INTO issue_toc_items (id, issue_id, parent_id, sort_order, title, kind, status, due_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      params: [tid, id, t.parent_key != null ? keyToId.get(String(t.parent_key)) ?? null : null, idx, tTitle, String(t.kind || 'article').slice(0, 30), 'todo', t.due_at || null, now]
    })
    for (const a of (Array.isArray(t.assignments) ? t.assignments : []).slice(0, 10)) {
      if (!memberIds.has(a.member_id)) continue
      stmts.push({ sql: 'INSERT INTO toc_assignments (id, toc_item_id, team_member_id, role) VALUES (?,?,?,?)', params: [newId(), tid, a.member_id, String(a.role || 'author').slice(0, 30)] })
    }
  })
  const stages = Array.isArray(b.stages) && b.stages.length ? b.stages : DEFAULT_STAGES
  stages.slice(0, 20).forEach((s: any, idx: number) => {
    stmts.push({
      sql: 'INSERT INTO issue_stages (id, issue_id, key, title, sort_order, status, due_at) VALUES (?,?,?,?,?,?,?)',
      params: [newId(), id, String(s.key || 'stage' + idx).slice(0, 30), String(s.title || 'مرحله').slice(0, 60), idx, 'pending', s.due_at || null]
    })
  })
  await db.batch(stmts)
  await refreshIssueSearch(c, id)
  await activity(db, user.id, 'issue.created', p.id, id, { number, title })
  await audit(db, user.id, 'issue.create', 'issue', id, null, { number, title })
  return c.json({ ok: true, id })
})

teamRoutes.get('/:pubId/issues/:issueId', async (c) => {
  const { pub: p } = await pub(c)
  const db = c.get('db')
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  const toc = await db.all('SELECT * FROM issue_toc_items WHERE issue_id = ? ORDER BY sort_order', [i.id])
  const assignments = await db.all(
    'SELECT ta.id, ta.toc_item_id, ta.team_member_id, ta.role, tm.full_name FROM toc_assignments ta JOIN team_members tm ON tm.id = ta.team_member_id JOIN issue_toc_items t ON t.id = ta.toc_item_id WHERE t.issue_id = ?',
    [i.id]
  )
  const members = await db.all('SELECT im.id, im.team_member_id, im.production_role, im.note, tm.full_name FROM issue_members im JOIN team_members tm ON tm.id = im.team_member_id WHERE im.issue_id = ?', [i.id])
  const stages = await db.all('SELECT * FROM issue_stages WHERE issue_id = ? ORDER BY sort_order', [i.id])
  const events = await db.all(
    `SELECT se.*, u.display_name AS actor_name, s.title AS stage_title, t.title AS toc_title FROM stage_events se LEFT JOIN users u ON u.id = se.actor_user_id
     LEFT JOIN issue_stages s ON s.id = se.stage_id LEFT JOIN issue_toc_items t ON t.id = se.toc_item_id WHERE se.issue_id = ? ORDER BY se.created_at DESC LIMIT 200`,
    [i.id]
  )
  const categories = await db.all('SELECT category_id FROM issue_categories WHERE issue_id = ?', [i.id])
  const media = await db.all('SELECT id, kind, role, title, mime, size_bytes, access, toc_item_id, storage_key, created_at FROM media_assets WHERE issue_id = ? ORDER BY role, sort_order', [i.id])
  const approvals = await db.all(
    'SELECT a.*, u.display_name AS decided_by_name FROM issue_approvals a LEFT JOIN users u ON u.id = a.decided_by WHERE a.issue_id = ? ORDER BY a.requested_at DESC',
    [i.id]
  )
  const pageCount = (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM issue_pages WHERE issue_id = ?', [i.id]))?.n ?? 0
  return c.json({ issue: i, toc, assignments, members, stages, events, categories: categories.map((x: any) => x.category_id), media, approvals, pages_uploaded: pageCount })
})

teamRoutes.put('/:pubId/issues/:issueId', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const db = c.get('db')
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  const b = await body<any>(c)
  const published = i.status === 'published'
  // after publishing only descriptive fields may change
  const title = str(b.title ?? i.title, 'عنوان', { min: 2, max: 160 })
  const summary = str(b.summary ?? i.summary, 'خلاصه', { max: 3000, optional: true })
  const keywords = keywordsCsv(b.keywords ?? i.keywords)
  const view = oneOf(b.progress_view ?? i.progress_view, ['timeline', 'checklist', 'kanban'] as const, 'نمای پیشرفت', 'timeline')
  const planned = published ? i.planned_publish_at : b.planned_publish_at !== undefined ? b.planned_publish_at || null : i.planned_publish_at
  await db.run('UPDATE issues SET title = ?, summary = ?, keywords = ?, progress_view = ?, planned_publish_at = ?, updated_at = ? WHERE id = ?', [title, summary, keywords, view, planned, nowIso(), i.id])
  if (Array.isArray(b.category_ids)) {
    await db.run('DELETE FROM issue_categories WHERE issue_id = ?', [i.id])
    for (const cid of b.category_ids.slice(0, 10)) await db.run('INSERT OR IGNORE INTO issue_categories (issue_id, category_id) VALUES (?,?)', [i.id, cid])
  }
  await refreshIssueSearch(c, i.id)
  await audit(db, user.id, 'issue.update', 'issue', i.id, { title: i.title, keywords: i.keywords }, { title, keywords })
  return c.json({ ok: true })
})

teamRoutes.delete('/:pubId/issues/:issueId', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  if (i.status === 'published') throw bad('شمارهٔ منتشرشده حذف نمی‌شود؛ مسئول نشریات می‌تواند آن را بایگانی کند')
  const db = c.get('db')
  await db.run('UPDATE issues SET deleted_at = ? WHERE id = ?', [nowIso(), i.id])
  await audit(db, user.id, 'issue.delete', 'issue', i.id, { number: i.number, title: i.title })
  return c.json({ ok: true })
})

// ── TOC ──
teamRoutes.post('/:pubId/issues/:issueId/toc', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  assertEditable(i)
  const b = await body<any>(c)
  const db = c.get('db')
  const max = await db.first<{ n: number }>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM issue_toc_items WHERE issue_id = ?', [i.id])
  // accept either a single item or a pasted multiline list
  const titles: string[] = b.lines ? String(b.lines).split('\n').map((l) => l.replace(/^[\s\d۰-۹\-–—.)•*]+/, '').trim()).filter(Boolean).slice(0, 100) : [str(b.title, 'عنوان بخش', { max: 200 })]
  const ids: string[] = []
  let order = max?.n ?? 0
  for (const t of titles) {
    const id = newId()
    ids.push(id)
    await db.run('INSERT INTO issue_toc_items (id, issue_id, parent_id, sort_order, title, kind, status, due_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [
      id, i.id, b.parent_id || null, order++, t, String(b.kind || 'article').slice(0, 30), 'todo', b.due_at || null, nowIso()
    ])
  }
  await activity(db, user.id, 'toc.added', p.id, i.id, { count: ids.length })
  return c.json({ ok: true, ids })
})

teamRoutes.put('/:pubId/issues/:issueId/toc/:tocId', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  const db = c.get('db')
  const t = await db.first<any>('SELECT * FROM issue_toc_items WHERE id = ? AND issue_id = ?', [c.req.param('tocId'), i.id])
  if (!t) throw notFound('بخش یافت نشد')
  const b = await body<any>(c)
  const pageStart = b.page_start !== undefined ? int(b.page_start, 'صفحهٔ شروع', { min: 1, max: 5000, optional: true }) : t.page_start
  const pageEnd = b.page_end !== undefined ? int(b.page_end, 'صفحهٔ پایان', { min: 1, max: 5000, optional: true }) : t.page_end
  if (pageStart && pageEnd && pageEnd < pageStart) throw bad('صفحهٔ پایان نباید قبل از صفحهٔ شروع باشد')
  if (i.status === 'published' && (b.title !== undefined || b.parent_id !== undefined)) throw bad('ساختار فهرست شمارهٔ منتشرشده قابل تغییر نیست')
  await db.run('UPDATE issue_toc_items SET title = ?, kind = ?, parent_id = ?, due_at = ?, page_start = ?, page_end = ? WHERE id = ?', [
    b.title !== undefined ? str(b.title, 'عنوان بخش', { max: 200 }) : t.title,
    b.kind !== undefined ? String(b.kind).slice(0, 30) : t.kind,
    b.parent_id !== undefined ? b.parent_id || null : t.parent_id,
    b.due_at !== undefined ? b.due_at || null : t.due_at,
    pageStart, pageEnd, t.id
  ])
  await activity(db, user.id, 'toc.updated', p.id, i.id, { id: t.id })
  return c.json({ ok: true })
})

/**
 * GET /:pubId/issues/:issueId/toc/page-suggestions — ROADMAP phase 3: suggest page_start/page_end for each TOC item
 * by finding the first page (after the previous item's page) whose extracted text contains the item's normalised title.
 */
teamRoutes.get('/:pubId/issues/:issueId/toc/page-suggestions', async (c) => {
  const { pub: p } = await pub(c)
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  const db = c.get('db')
  const toc = await db.all<{ id: string; title: string; page_start: number | null; page_end: number | null }>('SELECT id, title, page_start, page_end FROM issue_toc_items WHERE issue_id = ? ORDER BY sort_order', [i.id])
  const pages = await db.all<{ page_number: number; text_content: string | null }>('SELECT page_number, text_content FROM issue_pages WHERE issue_id = ? ORDER BY page_number', [i.id])
  const norm = (x: string) => normalizeFa(x).replace(/\s+/g, ' ').trim()
  const texts = pages.map((pg) => ({ n: pg.page_number, t: norm(pg.text_content || '') }))
  const found: { id: string; page_start: number | null }[] = []
  let from = 0
  for (const t of toc) {
    const key = norm(t.title)
    // titles are often split across lines in PDFs: match the first ~4 words, at least 4 letters long
    const probe = key.split(' ').slice(0, 4).join(' ')
    let hit: number | null = null
    if (probe.length >= 4) for (let k = from; k < texts.length; k++) if (texts[k].t.includes(probe)) { hit = texts[k].n; from = k; break }
    found.push({ id: t.id, page_start: hit })
  }
  const last = pages.length ? pages[pages.length - 1].page_number : null
  const suggestions = found.map((f, k) => {
    const next = found.slice(k + 1).find((x) => x.page_start != null)?.page_start ?? null
    const end = f.page_start == null ? null : next != null ? Math.max(f.page_start, next - 1) : last
    const cur = toc[k]
    return { id: f.id, title: cur.title, page_start: f.page_start, page_end: end, current_start: cur.page_start, current_end: cur.page_end }
  })
  return c.json({ pages: pages.length, with_text: texts.filter((x) => x.t).length, suggestions })
})

teamRoutes.post('/:pubId/issues/:issueId/toc-order', async (c) => {
  const { pub: p } = await pub(c, true)
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  assertEditable(i)
  const b = await body<{ order?: { id: string; parent_id?: string | null }[] }>(c)
  const stmts = (b.order || []).slice(0, 300).map((o, idx) => ({ sql: 'UPDATE issue_toc_items SET sort_order = ?, parent_id = ? WHERE id = ? AND issue_id = ?', params: [idx, o.parent_id || null, o.id, i.id] }))
  await c.get('db').batch(stmts)
  return c.json({ ok: true })
})

teamRoutes.delete('/:pubId/issues/:issueId/toc/:tocId', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  assertEditable(i)
  const db = c.get('db')
  const tid = c.req.param('tocId')
  await db.batch([
    { sql: 'DELETE FROM toc_assignments WHERE toc_item_id = ?', params: [tid] },
    { sql: 'UPDATE issue_toc_items SET parent_id = NULL WHERE parent_id = ? AND issue_id = ?', params: [tid, i.id] },
    { sql: 'DELETE FROM issue_toc_items WHERE id = ? AND issue_id = ?', params: [tid, i.id] }
  ])
  await activity(db, user.id, 'toc.removed', p.id, i.id, { id: tid })
  return c.json({ ok: true })
})

/** Replace the assignment matrix of one TOC item. */
teamRoutes.put('/:pubId/issues/:issueId/toc/:tocId/assignments', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  const db = c.get('db')
  const t = await db.first('SELECT id FROM issue_toc_items WHERE id = ? AND issue_id = ?', [c.req.param('tocId'), i.id])
  if (!t) throw notFound('بخش یافت نشد')
  const b = await body<{ assignments?: { member_id: string; role: string }[] }>(c)
  const valid = new Set((await db.all<{ id: string }>('SELECT id FROM team_members WHERE publication_id = ?', [p.id])).map((r) => r.id))
  const stmts: { sql: string; params: unknown[] }[] = [{ sql: 'DELETE FROM toc_assignments WHERE toc_item_id = ?', params: [c.req.param('tocId')] }]
  for (const a of (b.assignments || []).slice(0, 20)) {
    if (!valid.has(a.member_id)) continue
    stmts.push({ sql: 'INSERT INTO toc_assignments (id, toc_item_id, team_member_id, role) VALUES (?,?,?,?)', params: [newId(), c.req.param('tocId'), a.member_id, String(a.role || 'author').slice(0, 30)] })
  }
  await db.batch(stmts)
  await activity(db, user.id, 'toc.assigned', p.id, i.id, { toc: c.req.param('tocId') })
  return c.json({ ok: true })
})

/** Progress tick on a TOC item (writing/editing done etc.). Every change → stage_events (append-only). */
teamRoutes.post('/:pubId/issues/:issueId/toc/:tocId/status', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  const db = c.get('db')
  const t = await db.first<any>('SELECT * FROM issue_toc_items WHERE id = ? AND issue_id = ?', [c.req.param('tocId'), i.id])
  if (!t) throw notFound('بخش یافت نشد')
  const b = await body<{ status?: string; note?: string }>(c)
  const status = oneOf(b.status, TOC_STATUS, 'وضعیت')
  if (status === t.status) return c.json({ ok: true })
  const now = nowIso()
  await db.batch([
    { sql: 'UPDATE issue_toc_items SET status = ?, done_at = ? WHERE id = ?', params: [status, status === 'done' ? now : null, t.id] },
    { sql: 'INSERT INTO stage_events (id, issue_id, toc_item_id, from_status, to_status, actor_user_id, note, created_at) VALUES (?,?,?,?,?,?,?,?)', params: [newId(), i.id, t.id, t.status, status, user.id, str(b.note, 'یادداشت', { max: 300, optional: true }), now] }
  ])
  await autoStartProduction(c, i)
  await activity(db, user.id, 'toc.status', p.id, i.id, { id: t.id, from: t.status, to: status })
  return c.json({ ok: true })
})

async function autoStartProduction(c: Context<AppEnv>, i: any) {
  if (i.status === 'planning') await c.get('db').run("UPDATE issues SET status = 'in_production', updated_at = ? WHERE id = ? AND status = 'planning'", [nowIso(), i.id])
}

// ── Issue members ──
teamRoutes.put('/:pubId/issues/:issueId/members', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  const db = c.get('db')
  const b = await body<{ members?: { member_id: string; production_role: string; note?: string }[] }>(c)
  const valid = new Set((await db.all<{ id: string }>('SELECT id FROM team_members WHERE publication_id = ?', [p.id])).map((r) => r.id))
  const stmts: { sql: string; params: unknown[] }[] = [{ sql: 'DELETE FROM issue_members WHERE issue_id = ?', params: [i.id] }]
  for (const m of (b.members || []).slice(0, 200)) {
    if (!valid.has(m.member_id)) continue
    stmts.push({ sql: 'INSERT INTO issue_members (id, issue_id, team_member_id, production_role, note) VALUES (?,?,?,?,?)', params: [newId(), i.id, m.member_id, String(m.production_role || 'همکار').slice(0, 60), m.note || null] })
  }
  await db.batch(stmts)
  await activity(db, user.id, 'issue.members', p.id, i.id, { count: stmts.length - 1 })
  return c.json({ ok: true })
})

// ── Stages ──
teamRoutes.post('/:pubId/issues/:issueId/stages/:stageId', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  const db = c.get('db')
  const s = await db.first<any>('SELECT * FROM issue_stages WHERE id = ? AND issue_id = ?', [c.req.param('stageId'), i.id])
  if (!s) throw notFound('مرحله یافت نشد')
  const b = await body<{ status?: string; note?: string; due_at?: string | null }>(c)
  if (b.due_at !== undefined && b.status === undefined) {
    await db.run('UPDATE issue_stages SET due_at = ? WHERE id = ?', [b.due_at || null, s.id])
    return c.json({ ok: true })
  }
  const status = oneOf(b.status, STAGE_STATUS, 'وضعیت')
  if (s.key === 'publish' && status === 'done') throw bad('مرحلهٔ «انتشار» فقط پس از تأیید مسئول نشریات و به‌طور خودکار کامل می‌شود')
  if (status === s.status) return c.json({ ok: true })
  const now = nowIso()
  await db.batch([
    {
      sql: 'UPDATE issue_stages SET status = ?, started_at = CASE WHEN ? = \'in_progress\' THEN COALESCE(started_at, ?) WHEN ? = \'done\' THEN COALESCE(started_at, ?) ELSE started_at END, completed_at = CASE WHEN ? IN (\'done\',\'skipped\') THEN ? ELSE NULL END WHERE id = ?',
      params: [status, status, now, status, now, status, now, s.id]
    },
    { sql: 'INSERT INTO stage_events (id, issue_id, stage_id, from_status, to_status, actor_user_id, note, created_at) VALUES (?,?,?,?,?,?,?,?)', params: [newId(), i.id, s.id, s.status, status, user.id, str(b.note, 'یادداشت', { max: 300, optional: true }), now] }
  ])
  await autoStartProduction(c, i)
  await activity(db, user.id, 'stage.status', p.id, i.id, { stage: s.key, from: s.status, to: status })
  return c.json({ ok: true })
})

// ── Publishing settings & approval request (officer approval is ALWAYS required — client decision #3) ──
teamRoutes.put('/:pubId/issues/:issueId/publishing', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  if (i.status === 'awaiting_approval') throw bad('شماره در انتظار تأیید است؛ برای تغییر، ابتدا درخواست را پس بگیرید')
  const b = await body<any>(c)
  const pricing = oneOf(b.pricing ?? i.pricing, ['free', 'paid'] as const, 'نوع قیمت‌گذاری')
  const priceDigital = pricing === 'paid' ? int(b.price_digital, 'قیمت نسخهٔ دیجیتال', { min: 1000, max: 100_000_000 }) : null
  const ttl = int(b.code_ttl_hours ?? i.code_ttl_hours ?? 24, 'مدت اعتبار کد', { min: 1, max: 24 }) // client decision #5: team sets, max 24h
  await c.get('db').run(
    'UPDATE issues SET pricing = ?, price_digital = ?, price_print = ?, print_run = ?, free_preview_pages = ?, code_ttl_hours = ?, planned_publish_at = ?, updated_at = ? WHERE id = ?',
    [pricing, priceDigital, int(b.price_print, 'قیمت نسخهٔ چاپی', { min: 0, max: 100_000_000, optional: true }), int(b.print_run, 'تیراژ', { min: 0, max: 1_000_000, optional: true }),
      int(b.free_preview_pages ?? 3, 'صفحات پیش‌نمایش', { min: 0, max: 50 }), ttl, b.planned_publish_at || i.planned_publish_at || null, nowIso(), i.id]
  )
  await audit(c.get('db'), user.id, 'issue.publishing_update', 'issue', i.id, { pricing: i.pricing, price: i.price_digital }, { pricing, price: priceDigital, ttl })
  return c.json({ ok: true })
})

teamRoutes.post('/:pubId/issues/:issueId/request-approval', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const db = c.get('db')
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  if (!['planning', 'in_production', 'changes_requested'].includes(i.status)) throw bad('این شماره قبلاً برای تأیید ارسال یا منتشر شده است')
  const pages = (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM issue_pages WHERE issue_id = ?', [i.id]))?.n ?? 0
  const problems: string[] = []
  if (!pages) problems.push('نسخهٔ دیجیتال (PDF) بارگذاری و پردازش نشده است')
  if (!i.cover_key) problems.push('جلد شماره تعیین نشده است')
  const tocCount = (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM issue_toc_items WHERE issue_id = ?', [i.id]))?.n ?? 0
  if (!tocCount) problems.push('فهرست مطالب خالی است')
  if (i.pricing === 'paid' && !i.price_digital) problems.push('قیمت نسخهٔ دیجیتال تعیین نشده است')
  if (problems.length) throw new HttpError(400, 'پیش از ارسال برای تأیید: ' + problems.join('؛ '), 'not_ready')
  const now = nowIso()
  await db.batch([
    { sql: "UPDATE issues SET status = 'awaiting_approval', updated_at = ? WHERE id = ?", params: [now, i.id] },
    { sql: 'INSERT INTO issue_approvals (id, issue_id, requested_by, requested_at, note) VALUES (?,?,?,?,?)', params: [newId(), i.id, user.id, now, str((await body<any>(c)).note, 'یادداشت', { max: 500, optional: true })] }
  ])
  const officers = await db.all<{ id: string }>("SELECT id FROM users WHERE system_role IN ('pub_officer','super_admin') AND status = 'active' AND deleted_at IS NULL")
  for (const o of officers) await notify(db, o.id, 'approval.requested', `درخواست تأیید انتشار: ${p.title} — شمارهٔ ${i.number}`, `/admin/approvals`)
  await activity(db, user.id, 'issue.approval_requested', p.id, i.id)
  return c.json({ ok: true })
})

teamRoutes.post('/:pubId/issues/:issueId/withdraw-approval', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const db = c.get('db')
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  if (i.status !== 'awaiting_approval') throw bad('این شماره در انتظار تأیید نیست')
  const now = nowIso()
  await db.batch([
    { sql: "UPDATE issues SET status = 'in_production', updated_at = ? WHERE id = ?", params: [now, i.id] },
    { sql: "UPDATE issue_approvals SET decision = 'withdrawn', decided_at = ?, decided_by = ? WHERE issue_id = ? AND decided_at IS NULL", params: [now, user.id, i.id] }
  ])
  await activity(db, user.id, 'issue.approval_withdrawn', p.id, i.id)
  return c.json({ ok: true })
})

// ───────── Purchase codes (no payment gateway; raw code shown once, only hash stored) ─────────
teamRoutes.get('/:pubId/codes', async (c) => {
  const { pub: p } = await pub(c)
  const issueId = c.req.query('issue')
  const params: unknown[] = [p.id]
  let w = ''
  if (issueId) (w = ' AND ac.issue_id = ?'), params.push(issueId)
  const now = nowIso()
  const rows = await c.get('db').all<any>(
    `SELECT ac.id, ac.issue_id, ac.code_last4, ac.bound_student_number, ac.price_paid, ac.channel, ac.note, ac.created_at, ac.expires_at, ac.redeemed_at, ac.revoked_at,
       i.number AS issue_number, i.title AS issue_title, u.display_name AS redeemed_by_name, u.student_number AS redeemed_by_sn
     FROM access_codes ac JOIN issues i ON i.id = ac.issue_id LEFT JOIN users u ON u.id = ac.redeemed_by WHERE ac.publication_id = ?${w} ORDER BY ac.created_at DESC LIMIT 500`,
    params
  )
  return c.json({
    codes: rows.map((r) => ({ ...r, state: r.revoked_at ? 'revoked' : r.redeemed_at ? 'redeemed' : r.expires_at <= now ? 'expired' : 'active' }))
  })
})

teamRoutes.post('/:pubId/codes', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const db = c.get('db')
  const b = await body<any>(c)
  const i = await issueOf(c, p.id, str(b.issue_id, 'شماره', { max: 40 }))
  if (i.status !== 'published') throw bad('کد خرید فقط برای شمارهٔ منتشرشده ساخته می‌شود')
  if (i.pricing !== 'paid') throw bad('این شماره رایگان است و نیازی به کد ندارد')
  const count = int(b.count ?? 1, 'تعداد', { min: 1, max: 100 })!
  const ttlHours = Math.min(24, int(b.ttl_hours ?? i.code_ttl_hours ?? 24, 'مدت اعتبار (ساعت)', { min: 1, max: 24 })!)
  const bound = b.student_number ? toEnDigits(String(b.student_number)).replace(/\D/g, '') : null
  if (bound && count > 1) throw bad('کد متصل به شماره دانشجویی فقط به‌صورت تکی ساخته می‌شود')
  const channel = oneOf(b.channel, ['card_to_card', 'cash', 'gift', 'other'] as const, 'روش پرداخت', 'card_to_card')
  const price = b.price_paid === '' || b.price_paid == null ? i.price_digital : int(b.price_paid, 'مبلغ', { min: 0, max: 100_000_000 })
  const now = nowIso()
  const expires = addHours(ttlHours)
  const codes: string[] = []
  const stmts: { sql: string; params: unknown[] }[] = []
  for (let k = 0; k < count; k++) {
    const code = generatePurchaseCode()
    codes.push(code)
    const norm = normalizePurchaseCode(code)
    stmts.push({
      sql: 'INSERT INTO access_codes (id, issue_id, publication_id, code_hash, code_last4, bound_student_number, price_paid, channel, note, created_by, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      params: [newId(), i.id, p.id, await sha256(norm), norm.slice(-4), bound, price, channel, str(b.note, 'یادداشت', { max: 200, optional: true }), user.id, now, expires]
    })
  }
  await db.batch(stmts)
  await activity(db, user.id, 'codes.created', p.id, i.id, { count, ttlHours })
  await audit(db, user.id, 'codes.create', 'issue', i.id, null, { count, ttlHours, bound: !!bound })
  return c.json({ ok: true, codes, expires_at: expires, issue: { id: i.id, number: i.number, title: i.title } })
})

teamRoutes.post('/:pubId/codes/:codeId/revoke', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const db = c.get('db')
  const r = await db.run('UPDATE access_codes SET revoked_at = ? WHERE id = ? AND publication_id = ? AND redeemed_at IS NULL AND revoked_at IS NULL', [nowIso(), c.req.param('codeId'), p.id])
  if (!r.changes) throw bad('این کد قابل ابطال نیست (استفاده‌شده یا قبلاً باطل‌شده)')
  await audit(db, user.id, 'codes.revoke', 'access_code', c.req.param('codeId'))
  return c.json({ ok: true })
})

/**
 * Resolve an invisible-watermark code found in a leaked page image (ROADMAP phase 5).
 * Stateless: recompute HMAC(user|issue) for everyone who could read this issue and compare.
 */
teamRoutes.post('/:pubId/issues/:issueId/trace', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  const b = await body<{ code?: string }>(c)
  const code = str(b.code, 'کد ردیابی', { max: 16 }).toLowerCase().replace(/[^0-9a-f]/g, '')
  if (code.length !== 8) throw bad('کد ردیابی باید ۸ نویسهٔ هگز باشد')
  const db = c.get('db')
  const readers = await db.all<{ id: string; student_number: string | null; username: string; display_name: string | null }>(
    `SELECT u.id, u.student_number, u.username, u.display_name FROM users u WHERE u.id IN (
       SELECT user_id FROM entitlements WHERE issue_id = ? UNION SELECT user_id FROM reading_progress WHERE issue_id = ?)`,
    [i.id, i.id]
  )
  const secret = c.get('deps').secret
  let match: (typeof readers)[number] | null = null
  for (const r of readers) if ((await traceCode(secret, r.id, i.id)) === code) { match = r; break }
  await audit(db, user.id, 'watermark.trace', 'issue', i.id, null, { code, found: !!match })
  return c.json({ ok: true, checked: readers.length, match: match && { student_number: match.student_number, username: match.username, display_name: match.display_name } })
})

/** Revoke a reader's access to an issue (abuse handling). */
teamRoutes.post('/:pubId/issues/:issueId/revoke-reader', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  const b = await body<{ student_number?: string; reason?: string }>(c)
  const sn = toEnDigits(str(b.student_number, 'شماره دانشجویی', { max: 20 }))
  const db = c.get('db')
  const u = await db.first<{ id: string }>('SELECT id FROM users WHERE student_number = ?', [sn])
  if (!u) throw notFound('کاربری با این شماره دانشجویی یافت نشد')
  const r = await db.run('UPDATE entitlements SET revoked_at = ? WHERE user_id = ? AND issue_id = ? AND revoked_at IS NULL', [nowIso(), u.id, i.id])
  if (!r.changes) throw bad('این کاربر دسترسی فعالی به این شماره ندارد')
  await audit(db, user.id, 'entitlement.revoke', 'issue', i.id, null, { student_number: sn, reason: b.reason || null })
  return c.json({ ok: true })
})

teamRoutes.get('/:pubId/physical-sales', async (c) => {
  const { pub: p } = await pub(c)
  const rows = await c.get('db').all(
    'SELECT ps.*, i.number AS issue_number, i.title AS issue_title FROM physical_sales ps JOIN issues i ON i.id = ps.issue_id WHERE ps.publication_id = ? ORDER BY ps.sold_at DESC LIMIT 300',
    [p.id]
  )
  return c.json({ sales: rows })
})

teamRoutes.post('/:pubId/physical-sales', async (c) => {
  await requireFeature(c.get('db'), 'physical_sales')
  const { pub: p, user } = await pub(c, true)
  const b = await body<any>(c)
  const i = await issueOf(c, p.id, str(b.issue_id, 'شماره', { max: 40 }))
  const id = newId()
  await c.get('db').run('INSERT INTO physical_sales (id, issue_id, publication_id, quantity, unit_price, sold_at, channel, recorded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [
    id, i.id, p.id, int(b.quantity, 'تعداد', { min: 1, max: 100000 }), int(b.unit_price ?? i.price_print, 'قیمت واحد', { min: 0, max: 100_000_000, optional: true }),
    str(b.sold_at, 'تاریخ فروش', { max: 10, optional: true }) || nowIso().slice(0, 10), str(b.channel, 'محل فروش', { max: 60, optional: true }), user.id, nowIso()
  ])
  await activity(c.get('db'), user.id, 'physical_sale.recorded', p.id, i.id, { qty: b.quantity })
  return c.json({ ok: true, id })
})

teamRoutes.delete('/:pubId/physical-sales/:id', async (c) => {
  const { pub: p, user } = await pub(c, true)
  await c.get('db').run('DELETE FROM physical_sales WHERE id = ? AND publication_id = ?', [c.req.param('id'), p.id])
  await audit(c.get('db'), user.id, 'physical_sale.delete', 'physical_sale', c.req.param('id'))
  return c.json({ ok: true })
})

// ───────── Explore: posts, stories, highlights (every post MUST cite its source issue + section) ─────────
teamRoutes.get('/:pubId/posts', async (c) => {
  const { pub: p } = await pub(c)
  const rows = await c.get('db').all<any>(
    `SELECT po.*, i.number AS source_issue_number, i.title AS source_issue_title, t.title AS source_toc_title,
       (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = po.id AND cm.status = 'pending') AS pending_comments
     FROM posts po JOIN issues i ON i.id = po.source_issue_id LEFT JOIN issue_toc_items t ON t.id = po.source_toc_item_id
     WHERE po.publication_id = ? ORDER BY po.created_at DESC LIMIT 300`,
    [p.id]
  )
  const highlights = await c.get('db').all<any>('SELECT h.*, (SELECT COUNT(*) FROM highlight_items hi WHERE hi.highlight_id = h.id) AS item_count FROM highlights h WHERE h.publication_id = ? ORDER BY sort_order', [p.id])
  const items = await c.get('db').all('SELECT hi.* FROM highlight_items hi JOIN highlights h ON h.id = hi.highlight_id WHERE h.publication_id = ?', [p.id])
  return c.json({ posts: rows.map((r) => ({ ...r, images: parseJson(r.images_json, []) })), highlights, highlight_items: items })
})

teamRoutes.post('/:pubId/posts', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const db = c.get('db')
  const b = await body<any>(c)
  const images: string[] = (Array.isArray(b.images) ? b.images : []).filter((k: any) => typeof k === 'string' && k.startsWith(`pub/${p.id}/`)).slice(0, 10)
  if (!images.length) throw bad('اکسپلور فقط تصویری است؛ حداقل یک تصویر بارگذاری کنید')
  const src = await db.first<any>("SELECT id FROM issues WHERE id = ? AND publication_id = ? AND status = 'published' AND deleted_at IS NULL", [b.source_issue_id, p.id])
  if (!src) throw bad('منبع پست الزامی است: یک شمارهٔ منتشرشده از همین نشریه انتخاب کنید')
  const toc = await db.first('SELECT id FROM issue_toc_items WHERE id = ? AND issue_id = ?', [b.source_toc_item_id, src.id])
  if (!toc) throw bad('منبع پست الزامی است: بخش مربوط از فهرست مطالب آن شماره را انتخاب کنید')
  const isStory = b.is_story ? 1 : 0
  const id = newId()
  const now = nowIso()
  const status = b.draft ? 'draft' : 'published'
  // scheduled publishing (ROADMAP phase 6): a future publish_at keeps the post invisible until then (public queries filter published_at <= now)
  let publishAt = now
  if (b.publish_at && !isStory) {
    const t = Date.parse(String(b.publish_at))
    if (!Number.isFinite(t)) throw bad('زمان انتشار نامعتبر است')
    if (t > Date.now() + 90 * 86400_000) throw bad('زمان‌بندی حداکثر تا ۹۰ روز آینده ممکن است')
    if (t > Date.now()) publishAt = new Date(t).toISOString()
  }
  await db.run(
    'INSERT INTO posts (id, publication_id, kind, caption, images_json, source_issue_id, source_toc_item_id, is_story, expires_at, status, published_at, created_by, created_at, alt_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, p.id, images.length > 1 ? 'carousel' : 'image', str(b.caption, 'متن پست', { max: 2200, optional: true }), JSON.stringify(images), src.id, b.source_toc_item_id, isStory,
      isStory ? addHours(24) : null, status, status === 'published' ? publishAt : null, user.id, now, altJson(b.alt, images.length)]
  )
  await activity(db, user.id, isStory ? 'story.published' : 'post.published', p.id, src.id, { id, scheduled: publishAt !== now ? publishAt : undefined })
  // in-app notification to followers for immediately-published posts (ROADMAP phase 6); identities never exposed to the team
  if (status === 'published' && publishAt === now && !isStory) {
    const followers = await db.all<{ user_id: string }>('SELECT user_id FROM follows WHERE publication_id = ? AND unfollowed_at IS NULL LIMIT 2000', [p.id])
    for (const f of followers) await notify(db, f.user_id, 'post.published', `پست تازه از ${p.title}`, `/post/${id}`)
  }
  return c.json({ ok: true, id, published_at: status === 'published' ? publishAt : null })
})

teamRoutes.put('/:pubId/posts/:postId', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const db = c.get('db')
  const po = await db.first<any>('SELECT * FROM posts WHERE id = ? AND publication_id = ?', [c.req.param('postId'), p.id])
  if (!po) throw notFound('پست یافت نشد')
  if (po.status === 'hidden_by_admin') throw forbiddenAdmin()
  const b = await body<any>(c)
  const status = b.status ? oneOf(b.status, ['draft', 'published', 'hidden_by_team'] as const, 'وضعیت') : po.status
  await db.run('UPDATE posts SET caption = ?, status = ?, published_at = COALESCE(published_at, CASE WHEN ? = \'published\' THEN ? END) WHERE id = ?', [
    b.caption !== undefined ? str(b.caption, 'متن پست', { max: 2200, optional: true }) : po.caption, status, status, nowIso(), po.id
  ])
  await activity(db, user.id, 'post.updated', p.id, po.source_issue_id, { id: po.id, status })
  return c.json({ ok: true })
})

/** Image alt texts (ROADMAP phase 6 accessibility): aligned with images_json; null when none provided. */
function altJson(v: unknown, n: number): string | null {
  if (!Array.isArray(v)) return null
  const out = v.slice(0, n).map((x) => (typeof x === 'string' ? x.trim().slice(0, 300) : ''))
  return out.some(Boolean) ? JSON.stringify(out) : null
}

function forbiddenAdmin() {
  return new HttpError(403, 'این پست توسط مسئول نشریات پنهان شده و قابل تغییر نیست')
}

teamRoutes.post('/:pubId/highlights', async (c) => {
  const { pub: p } = await pub(c, true)
  const b = await body<any>(c)
  const id = newId()
  const db = c.get('db')
  const max = await db.first<{ n: number }>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM highlights WHERE publication_id = ?', [p.id])
  await db.run('INSERT INTO highlights (id, publication_id, title, sort_order, created_at) VALUES (?,?,?,?,?)', [id, p.id, str(b.title, 'عنوان هایلایت', { max: 40 }), max?.n ?? 0, nowIso()])
  return c.json({ ok: true, id })
})

teamRoutes.put('/:pubId/highlights/:hid', async (c) => {
  const { pub: p } = await pub(c, true)
  const db = c.get('db')
  const h = await db.first('SELECT id FROM highlights WHERE id = ? AND publication_id = ?', [c.req.param('hid'), p.id])
  if (!h) throw notFound('هایلایت یافت نشد')
  const b = await body<{ title?: string; post_ids?: string[] }>(c)
  if (b.title) await db.run('UPDATE highlights SET title = ? WHERE id = ?', [str(b.title, 'عنوان', { max: 40 }), c.req.param('hid')])
  if (Array.isArray(b.post_ids)) {
    const valid = new Set((await db.all<{ id: string }>('SELECT id FROM posts WHERE publication_id = ?', [p.id])).map((r) => r.id))
    const stmts: { sql: string; params: unknown[] }[] = [{ sql: 'DELETE FROM highlight_items WHERE highlight_id = ?', params: [c.req.param('hid')] }]
    for (const pid of b.post_ids.slice(0, 100)) if (valid.has(pid)) stmts.push({ sql: 'INSERT OR IGNORE INTO highlight_items (highlight_id, post_id) VALUES (?,?)', params: [c.req.param('hid'), pid] })
    await db.batch(stmts)
  }
  return c.json({ ok: true })
})

teamRoutes.delete('/:pubId/highlights/:hid', async (c) => {
  const { pub: p } = await pub(c, true)
  const db = c.get('db')
  await db.batch([
    { sql: 'DELETE FROM highlight_items WHERE highlight_id IN (SELECT id FROM highlights WHERE id = ? AND publication_id = ?)', params: [c.req.param('hid'), p.id] },
    { sql: 'DELETE FROM highlights WHERE id = ? AND publication_id = ?', params: [c.req.param('hid'), p.id] }
  ])
  return c.json({ ok: true })
})

// ── Comment moderation (comments appear only after approval) ──
teamRoutes.get('/:pubId/comments', async (c) => {
  const { pub: p } = await pub(c)
  const status = oneOf(c.req.query('status'), ['pending', 'approved', 'rejected', 'spam'] as const, 'وضعیت', 'pending')
  const rows = await c.get('db').all<any>(
    `SELECT cm.id, cm.body, cm.status, cm.flagged, cm.created_at, cm.parent_id, cm.is_team_reply, cm.post_id, po.images_json, po.caption, u.display_name AS author
     FROM comments cm JOIN posts po ON po.id = cm.post_id LEFT JOIN users u ON u.id = cm.user_id WHERE po.publication_id = ? AND cm.status = ? ORDER BY cm.created_at DESC LIMIT 200`,
    [p.id, status]
  )
  return c.json({
    comments: rows.map((r) => {
      // Rule hint for the moderator (ROADMAP phase 10): a label only — the decision always stays with the team.
      const reasons = r.status === 'pending' && !r.is_team_reply ? flagComment(String(r.body || '')).reasons : []
      return { ...r, image: parseJson<string[]>(r.images_json, [])[0] || null, images_json: undefined, hint: reasons.length ? { label: ruleCommentLabel(reasons), reasons, source: 'rule' } : null }
    })
  })
})

/** Optional AI labels for the pending queue (on demand, never automatic). Only comment text is sent, redacted. */
teamRoutes.post('/:pubId/comments/ai-hints', async (c) => {
  const { pub: p } = await pub(c)
  const rows = await c.get('db').all<{ id: string; body: string }>(
    "SELECT cm.id, cm.body FROM comments cm JOIN posts po ON po.id = cm.post_id WHERE po.publication_id = ? AND cm.status = 'pending' AND cm.is_team_reply = 0 ORDER BY cm.created_at DESC LIMIT 30",
    [p.id]
  )
  const labels = await aiCommentLabels(c, rows)
  return c.json({ enabled: Object.keys(labels).length > 0 || rows.length === 0 ? true : (await import('../ai')).getProvider(c).then((x) => x.enabled), labels })
})

teamRoutes.post('/:pubId/comments/:cid', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const db = c.get('db')
  const cm = await db.first<any>('SELECT cm.* FROM comments cm JOIN posts po ON po.id = cm.post_id WHERE cm.id = ? AND po.publication_id = ?', [c.req.param('cid'), p.id])
  if (!cm) throw notFound('نظر یافت نشد')
  const b = await body<{ action?: string; reason?: string; reply?: string }>(c)
  const action = oneOf(b.action, ['approve', 'reject', 'spam', 'reply'] as const, 'اقدام')
  const now = nowIso()
  if (action === 'reply') {
    await db.run("INSERT INTO comments (id, post_id, user_id, parent_id, is_team_reply, body, status, moderated_by, moderated_at, created_at) VALUES (?,?,?,?,1,?, 'approved', ?, ?, ?)", [
      newId(), cm.post_id, user.id, cm.id, str(b.reply, 'متن پاسخ', { min: 2, max: 1000 }), user.id, now, now
    ])
    if (cm.status === 'pending') await db.run("UPDATE comments SET status = 'approved', moderated_by = ?, moderated_at = ? WHERE id = ?", [user.id, now, cm.id])
  } else {
    const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'spam'
    await db.run('UPDATE comments SET status = ?, moderated_by = ?, moderated_at = ?, reject_reason = ? WHERE id = ?', [status, user.id, now, status === 'rejected' ? str(b.reason, 'دلیل', { max: 200, optional: true }) : null, cm.id])
    if (cm.user_id && status !== 'spam') await notify(db, cm.user_id, 'comment.' + status, status === 'approved' ? 'نظر شما تأیید و منتشر شد' : 'نظر شما تأیید نشد', `/post/${cm.post_id}`)
  }
  await activity(db, user.id, 'comment.' + action, p.id, null, { id: cm.id })
  return c.json({ ok: true })
})

// ── Recruitment calls ──
teamRoutes.get('/:pubId/recruitment', async (c) => {
  const { pub: p } = await pub(c)
  return c.json({ calls: await c.get('db').all('SELECT * FROM recruitment_calls WHERE publication_id = ? ORDER BY created_at DESC', [p.id]) })
})

teamRoutes.post('/:pubId/recruitment', async (c) => {
  const { pub: p } = await pub(c, true)
  const b = await body<any>(c)
  const id = newId()
  await c.get('db').run('INSERT INTO recruitment_calls (id, publication_id, title, roles_needed, body, contact, open_until, created_at) VALUES (?,?,?,?,?,?,?,?)', [
    id, p.id, str(b.title, 'عنوان', { max: 120 }), str(b.roles_needed, 'نقش‌های مورد نیاز', { max: 300, optional: true }), str(b.body, 'توضیحات', { max: 3000, optional: true }),
    str(b.contact, 'راه ارتباط', { max: 120, optional: true }), b.open_until || null, nowIso()
  ])
  return c.json({ ok: true, id })
})

teamRoutes.delete('/:pubId/recruitment/:id', async (c) => {
  const { pub: p } = await pub(c, true)
  await c.get('db').run('DELETE FROM recruitment_calls WHERE id = ? AND publication_id = ?', [c.req.param('id'), p.id])
  return c.json({ ok: true })
})

// ── Certificates of collaboration ──
teamRoutes.post('/:pubId/issues/:issueId/certificates', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const db = c.get('db')
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  if (i.status !== 'published') throw bad('گواهی همکاری فقط برای شمارهٔ منتشرشده صادر می‌شود')
  const members = await db.all<{ team_member_id: string; roles: string }>(
    `SELECT team_member_id, GROUP_CONCAT(production_role, '، ') AS roles FROM issue_members WHERE issue_id = ? GROUP BY team_member_id`,
    [i.id]
  )
  let created = 0
  for (const m of members) {
    if (await db.first('SELECT 1 FROM certificates WHERE team_member_id = ? AND issue_id = ?', [m.team_member_id, i.id])) continue
    const code = 'C' + newId().slice(-9).toUpperCase()
    await db.run('INSERT INTO certificates (id, verify_code, team_member_id, issue_id, roles, issued_at) VALUES (?,?,?,?,?,?)', [newId(), code, m.team_member_id, i.id, m.roles, nowIso()])
    created++
  }
  await activity(db, user.id, 'certificates.issued', p.id, i.id, { created })
  const list = await db.all(
    'SELECT ce.verify_code, ce.roles, ce.issued_at, tm.full_name FROM certificates ce JOIN team_members tm ON tm.id = ce.team_member_id WHERE ce.issue_id = ? ORDER BY tm.full_name',
    [i.id]
  )
  return c.json({ ok: true, created, certificates: list })
})

// ── Aggregate, non-competitive stats for the team's own publication (client decision #4) ──
// No ranks, no comparison with other publications, no follower numbers.
teamRoutes.get('/:pubId/stats', async (c) => {
  const { pub: p } = await pub(c)
  const db = c.get('db')
  const { from, to } = dateRange(c, 90)
  const daily = await db.all(
    `SELECT day, SUM(CASE WHEN entity_type = 'publication' THEN 1 ELSE 0 END) AS page_views, SUM(CASE WHEN entity_type = 'issue' THEN 1 ELSE 0 END) AS issue_views,
       SUM(CASE WHEN entity_type = 'issue_read' THEN 1 ELSE 0 END) AS reads, SUM(CASE WHEN entity_type = 'post' THEN 1 ELSE 0 END) AS post_views
     FROM view_events WHERE publication_id = ? AND day BETWEEN ? AND ? GROUP BY day ORDER BY day`,
    [p.id, from, to]
  )
  const byIssue = await db.all(
    `SELECT i.id, i.number, i.title, i.pricing,
       (SELECT COUNT(*) FROM view_events v WHERE v.entity_type = 'issue' AND v.entity_id = i.id AND v.day BETWEEN ? AND ?) AS views,
       (SELECT COUNT(*) FROM view_events v WHERE v.entity_type = 'issue_read' AND v.entity_id = i.id AND v.day BETWEEN ? AND ?) AS reads,
       (SELECT COUNT(*) FROM access_codes ac WHERE ac.issue_id = i.id AND ac.redeemed_at IS NOT NULL) AS digital_sold,
       (SELECT COALESCE(SUM(quantity), 0) FROM physical_sales ps WHERE ps.issue_id = i.id) AS print_sold
     FROM issues i WHERE i.publication_id = ? AND i.status = 'published' AND i.deleted_at IS NULL ORDER BY i.number DESC`,
    [from, to, from, to, p.id]
  )
  const topPosts = await db.all<any>(
    `SELECT po.id, po.images_json, po.caption, COUNT(v.id) AS views FROM posts po LEFT JOIN view_events v ON v.entity_type = 'post' AND v.entity_id = po.id AND v.day BETWEEN ? AND ?
     WHERE po.publication_id = ? AND po.status = 'published' GROUP BY po.id ORDER BY views DESC LIMIT 6`,
    [from, to, p.id]
  )
  const totals = daily.reduce((a: any, d: any) => ({ page_views: a.page_views + d.page_views, issue_views: a.issue_views + d.issue_views, reads: a.reads + d.reads, post_views: a.post_views + d.post_views }), { page_views: 0, issue_views: 0, reads: 0, post_views: 0 })
  const avgPercent = await db.first<{ v: number }>(
    'SELECT AVG(rp.percent) AS v FROM reading_progress rp JOIN issues i ON i.id = rp.issue_id WHERE i.publication_id = ?',
    [p.id]
  )
  return c.json({
    from, to, totals, daily, byIssue,
    topPosts: topPosts.map((r) => ({ ...r, image: parseJson<string[]>(r.images_json, [])[0] || null, images_json: undefined })),
    avg_read_percent: Math.round(avgPercent?.v ?? 0)
  })
})

teamRoutes.get('/:pubId/activity', async (c) => {
  const { pub: p } = await pub(c)
  const rows = await c.get('db').all(
    `SELECT a.id, a.type, a.payload_json, a.created_at, a.issue_id, u.display_name AS actor_name, i.number AS issue_number
     FROM activity_events a LEFT JOIN users u ON u.id = a.actor_user_id LEFT JOIN issues i ON i.id = a.issue_id
     WHERE a.publication_id = ? AND a.type NOT IN ('follow','unfollow') ORDER BY a.created_at DESC LIMIT 100`,
    [p.id]
  )
  return c.json({ items: rows })
})

teamRoutes.get('/:pubId/search-issues', async (c) => {
  const { pub: p } = await pub(c)
  const ids = (c.req.query('ids') || '').split(',').filter(Boolean).slice(0, 50)
  const rows = await c.get('db').all(`SELECT id, number, title FROM issues WHERE publication_id = ? AND id IN (${inList(ids)})`, [p.id, ...ids])
  return c.json({ issues: rows })
})

export const _settingsUsed = getSetting

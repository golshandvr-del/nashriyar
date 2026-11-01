// Team domain module: issues, TOC, assignments, stages, publishing settings and approval requests.
// Mounted by routes/team.ts (ROADMAP phase 17 split; parent middleware applies).
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../../context'
import { newId } from '../../lib/crypto'
import { activity, audit, bad, body, cursorPage, getSetting, HttpError, int, keywordsCsv, notFound, notify, nowIso, oneOf, str } from '../../lib/util'
import { normalizeFa } from '../../../shared/fa'
import { draftCaption, suggestCategories, suggestKeywords } from '../../ai'
import { DEFAULT_STAGES, STAGE_STATUS, TOC_STATUS, assertEditable, issueOf, pub, refreshIssueSearch } from './service'
import { streamExport } from '../../lib/export'
import { ISSUE_COLUMNS } from '../../../shared/columns'
import type { PageOverride } from '../../lib/util'

export const issuesRoutes = new Hono<AppEnv>()

// ───────── Issues ─────────
/** The issues list query (screen and export share it; `page` lets the export walk every keyset page). */
async function listIssues(c: Context<AppEnv>, pubId: string, page?: PageOverride) {
  // ROADMAP phase 17: keyset pagination by issue number (?cursor, ?limit ≤ 500)
  const pg = cursorPage(c, { col: 'i.number', idCol: 'i.id', def: 300, max: 500, page })
  const rows = await c.get('db').all<any>(
    `SELECT i.id, i.number, i.title, i.status, i.pricing, i.planned_publish_at, i.published_at, i.page_count, i.cover_key, i.updated_at,
       (SELECT COUNT(*) FROM issue_toc_items t WHERE t.issue_id = i.id) AS toc_total,
       (SELECT COUNT(*) FROM issue_toc_items t WHERE t.issue_id = i.id AND t.status = 'done') AS toc_done
     FROM issues i WHERE i.publication_id = ? AND i.deleted_at IS NULL${pg.and} ORDER BY ${pg.order} LIMIT ${pg.fetch}`,
    [pubId, ...pg.params]
  )
  return pg.finish(rows, (r) => [r.number, r.id])
}

issuesRoutes.get('/:pubId/issues', async (c) => {
  const { pub: p } = await pub(c)
  const { rows: issues, next_cursor } = await listIssues(c, p.id)
  const next = await c.get('db').first<{ n: number }>('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM issues WHERE publication_id = ?', [p.id])
  return c.json({ issues, next_number: next?.n ?? 1, next_cursor })
})

/** Streaming XLSX/CSV of the issues list with the on-screen table state (ROADMAP phase 18). */
issuesRoutes.get('/:pubId/issues/export', async (c) => {
  const { pub: p } = await pub(c)
  return streamExport(c, { name: `issues-${p.slug || 'pub'}`, title: `شماره‌های ${p.title || ''}`.trim(), columns: ISSUE_COLUMNS, fetchPage: (cursor) => listIssues(c, p.id, { cursor, limit: 500 }) })
})

issuesRoutes.get('/:pubId/keywords', async (c) => {
  const { pub: p } = await pub(c)
  // bounded vocabulary (ROADMAP phase 17): the latest 2000 issues via idx_issues_published, not a full scan that grows forever
  const rows = await c.get('db').all<{ keywords: string }>(
    "SELECT keywords FROM issues WHERE keywords IS NOT NULL AND keywords <> '' AND deleted_at IS NULL ORDER BY published_at DESC LIMIT 2000"
  )
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
issuesRoutes.post('/:pubId/keywords/suggest', async (c) => {
  await pub(c)
  const b = await body<{ text?: string }>(c)
  const text = normalizeFa(String(b.text || '')).slice(0, 4000)
  if (text.length < 3) return c.json({ keywords: [] })
  return c.json({ keywords: await suggestKeywords(c, text) })
})

/** Category suggestions (ROADMAP phase 10): AI may only pick from existing non-major categories; word-overlap fallback. */
issuesRoutes.post('/:pubId/categories/suggest', async (c) => {
  await pub(c)
  const b = await body<{ text?: string }>(c)
  const text = String(b.text || '').slice(0, 4000)
  if (text.trim().length < 3) return c.json({ category_ids: [] })
  const cats = await c.get('db').all<{ id: string; name: string }>("SELECT id, name FROM categories WHERE type <> 'major' ORDER BY sort_order, name")
  return c.json({ category_ids: await suggestCategories(c, text, cats) })
})

/** Caption draft for an explore post from its source TOC section (AI when enabled; editable template otherwise). */
issuesRoutes.post('/:pubId/captions/draft', async (c) => {
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
issuesRoutes.post('/:pubId/issues', async (c) => {
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

issuesRoutes.get('/:pubId/issues/:issueId', async (c) => {
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

issuesRoutes.put('/:pubId/issues/:issueId', async (c) => {
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

issuesRoutes.delete('/:pubId/issues/:issueId', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  if (i.status === 'published') throw bad('شمارهٔ منتشرشده حذف نمی‌شود؛ مسئول نشریات می‌تواند آن را بایگانی کند')
  const db = c.get('db')
  await db.run('UPDATE issues SET deleted_at = ? WHERE id = ?', [nowIso(), i.id])
  await audit(db, user.id, 'issue.delete', 'issue', i.id, { number: i.number, title: i.title })
  return c.json({ ok: true })
})

// ── TOC ──
issuesRoutes.post('/:pubId/issues/:issueId/toc', async (c) => {
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

issuesRoutes.put('/:pubId/issues/:issueId/toc/:tocId', async (c) => {
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
issuesRoutes.get('/:pubId/issues/:issueId/toc/page-suggestions', async (c) => {
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

issuesRoutes.post('/:pubId/issues/:issueId/toc-order', async (c) => {
  const { pub: p } = await pub(c, true)
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  assertEditable(i)
  const b = await body<{ order?: { id: string; parent_id?: string | null }[] }>(c)
  const stmts = (b.order || []).slice(0, 300).map((o, idx) => ({ sql: 'UPDATE issue_toc_items SET sort_order = ?, parent_id = ? WHERE id = ? AND issue_id = ?', params: [idx, o.parent_id || null, o.id, i.id] }))
  await c.get('db').batch(stmts)
  return c.json({ ok: true })
})

issuesRoutes.delete('/:pubId/issues/:issueId/toc/:tocId', async (c) => {
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
issuesRoutes.put('/:pubId/issues/:issueId/toc/:tocId/assignments', async (c) => {
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
issuesRoutes.post('/:pubId/issues/:issueId/toc/:tocId/status', async (c) => {
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
issuesRoutes.put('/:pubId/issues/:issueId/members', async (c) => {
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
issuesRoutes.post('/:pubId/issues/:issueId/stages/:stageId', async (c) => {
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
issuesRoutes.put('/:pubId/issues/:issueId/publishing', async (c) => {
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

issuesRoutes.post('/:pubId/issues/:issueId/request-approval', async (c) => {
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

issuesRoutes.post('/:pubId/issues/:issueId/withdraw-approval', async (c) => {
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

// ── Article index metadata (ROADMAP phase 19) ──
// The team (write access) completes abstract / keywords / DOI / language for the sections of a published issue.
// The PID itself is assigned by the server and can never be edited.
issuesRoutes.get('/:pubId/issues/:issueId/articles', async (c) => {
  const { pub: p } = await pub(c)
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  const rows = await c.get('db').all(
    `SELECT a.pid, a.doi, a.abstract, a.keywords, a.lang, a.toc_item_id, t.title, t.kind, t.page_start, t.page_end
     FROM article_index a JOIN issue_toc_items t ON t.id = a.toc_item_id WHERE a.issue_id = ? ORDER BY t.sort_order`,
    [i.id]
  )
  return c.json({ articles: rows })
})

issuesRoutes.put('/:pubId/issues/:issueId/articles/:pid', async (c) => {
  const { pub: p, user } = await pub(c, true)
  const i = await issueOf(c, p.id, c.req.param('issueId'))
  const db = c.get('db')
  const a = await db.first<any>('SELECT * FROM article_index WHERE pid = ? AND issue_id = ?', [c.req.param('pid'), i.id])
  if (!a) throw notFound('مقاله یافت نشد')
  const b = await body<any>(c)
  const abstract = b.abstract !== undefined ? str(b.abstract, 'چکیده', { max: 5000, optional: true }) || null : a.abstract
  const keywords = b.keywords !== undefined ? keywordsCsv(b.keywords) || null : a.keywords
  const lang = b.lang !== undefined ? oneOf(b.lang, ['fa', 'en', 'ar'] as const, 'زبان', 'fa') : a.lang
  let doi = a.doi
  if (b.doi !== undefined) {
    doi = String(b.doi || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') || null
    if (doi && !/^10\.\d{4,9}\/[^\s"<>]+$/.test(doi)) throw bad('قالب DOI نامعتبر است (نمونه: 10.1234/abc.2026.1)')
    if (doi && (await db.first('SELECT 1 FROM article_index WHERE doi = ? AND pid <> ?', [doi, a.pid]))) throw bad('این DOI برای مقالهٔ دیگری ثبت شده است')
  }
  await db.run('UPDATE article_index SET abstract = ?, keywords = ?, lang = ?, doi = ?, updated_at = ? WHERE pid = ?', [abstract, keywords, lang, doi, nowIso(), a.pid])
  await audit(db, user.id, 'article.update', 'article', a.pid, { doi: a.doi, keywords: a.keywords }, { doi, keywords })
  return c.json({ ok: true })
})

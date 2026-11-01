// Team domain module: dashboard + limited publication profile edits.
// Mounted by routes/team.ts (ROADMAP phase 17 split; parent middleware applies).
import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { audit, body, keywordsCsv, nowIso, parseJson, str } from '../../lib/util'
import { normalizeFa } from '../../../shared/fa'
import { ensureReminders } from '../../lib/reminders'
import { pub } from './service'

export const dashboardRoutes = new Hono<AppEnv>()

// ───────── Dashboard ─────────
dashboardRoutes.get('/:pubId/dashboard', async (c) => {
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
  const deadlines = await db.all('SELECT id, title, due_at, description, kind, start_time, location FROM deadlines WHERE due_at >= ? ORDER BY due_at LIMIT 8', [now.slice(0, 10)])
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
dashboardRoutes.put('/:pubId/profile', async (c) => {
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

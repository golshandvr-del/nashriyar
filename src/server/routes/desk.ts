// «میز کار عضو» (ROADMAP phase 15 access matrix): regular team members (not the three main accounts) see their own
// sections, deadlines and collaboration certificates. What is visible is configured by the officer (`member_desk`).
import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { ADMIN_ROLES } from '../context'
import { requireRole, requireUser, userPubRoles } from '../auth'
import { audit, body, HttpError, nowIso } from '../lib/util'
import { activeMemberships, getMemberDesk, MEMBER_DESK_DEFAULTS, MEMBER_DESK_LABELS, sanitizeMemberDesk } from '../lib/memberDesk'
import { setSetting } from '../lib/util'

export const deskRoutes = new Hono<AppEnv>()

/** Where a signed-in account belongs inside publications: panel (main accounts), desk (linked members) or none. */
export async function deskAccess(c: any) {
  const u = requireUser(c)
  const db = c.get('db')
  const cfg = await getMemberDesk(db)
  const sn = (await db.first('SELECT student_number FROM users WHERE id = ?', [u.id]))?.student_number ?? null
  const memberships = await activeMemberships(db, u.id, sn)
  const panel = await userPubRoles(c, u.id)
  return { user: u, cfg, memberships, panel, sn }
}

deskRoutes.get('/', async (c) => {
  const { cfg, memberships, panel, sn, user } = await deskAccess(c)
  const db = c.get('db')
  const out: Record<string, unknown> = { config: cfg, memberships, panel_publications: panel, enabled: cfg.enabled && memberships.length > 0 }
  if (!cfg.enabled || !memberships.length) return c.json(out)
  const ids = memberships.map((m) => m.id)
  const ph = ids.map(() => '?').join(',')
  if (cfg.sections || cfg.deadlines) {
    const sections = await db.all<any>(
      `SELECT t.id, t.title, t.status, t.due_at, t.page_start, t.page_end, a.role AS my_role, i.id AS issue_id, i.title AS issue_title, i.number AS issue_number,
              i.status AS issue_status, p.id AS publication_id, p.title AS publication_title
         FROM toc_assignments a JOIN issue_toc_items t ON t.id = a.toc_item_id
         JOIN issues i ON i.id = t.issue_id AND i.deleted_at IS NULL AND i.status NOT IN ('published','archived')
         JOIN publications p ON p.id = i.publication_id
        WHERE a.team_member_id IN (${ph})
        ORDER BY (t.due_at IS NULL), t.due_at, i.created_at DESC, t.sort_order`,
      ids
    )
    if (cfg.sections) out.sections = sections
    if (cfg.deadlines) {
      const today = nowIso().slice(0, 10)
      const general = await db.all<any>('SELECT id, title, due_at, description FROM deadlines WHERE due_at >= ? ORDER BY due_at LIMIT 20', [today])
      out.deadlines = [
        ...sections.filter((s) => s.due_at && !['written', 'edited', 'done'].includes(s.status)).map((s) => ({ kind: 'section', id: s.id, title: s.title, due_at: s.due_at, context: `${s.publication_title} · شمارهٔ ${s.issue_number}` })),
        ...general.map((d) => ({ kind: 'general', id: d.id, title: d.title, due_at: d.due_at, context: d.description || 'مهلت عمومی' }))
      ].sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)))
    }
  }
  if (cfg.certificates)
    out.certificates = await db.all(
      `SELECT ce.verify_code, ce.roles, ce.issued_at, i.title AS issue_title, i.number AS issue_number, p.title AS publication_title
         FROM certificates ce JOIN issues i ON i.id = ce.issue_id JOIN publications p ON p.id = i.publication_id
        WHERE ce.team_member_id IN (${ph}) ORDER BY ce.issued_at DESC`,
      ids
    )
  out.student_number = sn
  out.display_name = user.display_name
  return c.json(out)
})

// Officer-configurable access matrix
deskRoutes.get('/config', async (c) => {
  requireRole(c, ADMIN_ROLES)
  return c.json({ config: await getMemberDesk(c.get('db')), defaults: MEMBER_DESK_DEFAULTS, labels: MEMBER_DESK_LABELS })
})

deskRoutes.post('/config', async (c) => {
  const u = requireRole(c, ADMIN_ROLES)
  const db = c.get('db')
  const before = await getMemberDesk(db)
  const next = sanitizeMemberDesk({ ...before, ...(await body<Record<string, unknown>>(c)) })
  await setSetting(db, 'member_desk', next)
  await audit(db, u.id, 'member_desk.update', 'settings', 'member_desk', before, next)
  return c.json({ ok: true, config: next })
})

/** Guard used by the member section endpoints: desk must be on and the account must be a linked member. */
export async function requireDesk(c: any, need: 'sections' | 'update_sections') {
  const a = await deskAccess(c)
  if (!a.cfg.enabled || !a.cfg[need]) throw new HttpError(403, 'این بخش از میز کار عضو توسط مسئول نشریات غیرفعال شده است')
  if (!a.memberships.length) throw new HttpError(403, 'حساب شما به عضویت فعال هیچ تیمی متصل نیست')
  return a
}

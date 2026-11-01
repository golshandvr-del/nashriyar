// Admin domain module: «Today» action queue (ROADMAP phase 14).
// Mounted by routes/admin.ts (ROADMAP phase 17 split; parent middleware applies).
import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { getSetting } from '../../lib/util'
import { admin, monitor, scope } from './service'

export const todayRoutes = new Hono<AppEnv>()

// ───────── «Today» action queue (ROADMAP phase 14) ─────────
// One prioritised list of everything the officer must act on, each item carrying the one-click actions the UI offers.
// Kinds: approval (issue awaiting approval), license (expired / expiring within 60 days), comment (pending moderation),
// report (open abuse report), deadline (within 14 days), stalled (issue in production with no update for 30 days).
todayRoutes.get('/today', async (c) => {
  const u = monitor(c)
  const db = c.get('db')
  const s = scope(c)
  const role = u.system_role
  const isAdm = role === 'super_admin' || role === 'pub_officer'
  const now = new Date()
  const iso = (d: number) => new Date(now.getTime() + d * 86400_000).toISOString()
  const items: { kind: string; id: string; priority: number; title: string; detail: string; at: string | null; link: string; actions: string[] }[] = []
  if (role !== 'analyst') {
    const canDecide = role !== 'faculty_supervisor' || (await getSetting(db, 'supervisor_can_approve', false))
    const rows = await db.all<any>(
      `SELECT i.id, i.number, i.title, p.title AS pub, a.requested_at FROM issues i JOIN publications p ON p.id = i.publication_id
       LEFT JOIN issue_approvals a ON a.issue_id = i.id AND a.decided_at IS NULL
       WHERE i.status = 'awaiting_approval' AND i.deleted_at IS NULL AND p.deleted_at IS NULL${s.sql} ORDER BY a.requested_at LIMIT 50`,
      s.params
    )
    for (const r of rows)
      items.push({ kind: 'approval', id: r.id, priority: 1, title: `تأیید انتشار: ${r.pub} — شمارهٔ ${r.number}`, detail: r.title || '', at: r.requested_at, link: `/admin/issues/${r.id}`, actions: canDecide ? ['approve', 'open'] : ['open'] })
  }
  const lic = await db.all<any>(
    `SELECT p.id, p.title, p.license_expires_at FROM publications p
     WHERE p.deleted_at IS NULL AND p.status = 'active' AND p.license_expires_at IS NOT NULL AND p.license_expires_at <> '' AND p.license_expires_at <= ?${s.sql}
     ORDER BY p.license_expires_at LIMIT 50`,
    [iso(60), ...s.params]
  )
  for (const r of lic) {
    const expired = r.license_expires_at < now.toISOString()
    items.push({ kind: 'license', id: r.id, priority: expired ? 1 : 2, title: `${expired ? 'مجوز منقضی شده' : 'مجوز رو به انقضا'}: ${r.title}`, detail: expired ? 'انتشار بدون مجوز معتبر؛ تمدید را پیگیری کنید' : 'کمتر از ۶۰ روز تا پایان اعتبار', at: r.license_expires_at, link: `/admin/publications/${r.id}?tab=license`, actions: ['open'] })
  }
  if (isAdm) {
    const rep = await db.all<any>(`SELECT r.id, r.entity_type, r.reason, r.created_at FROM reports r WHERE r.status = 'open' ORDER BY r.created_at LIMIT 50`)
    for (const r of rep)
      items.push({ kind: 'report', id: r.id, priority: 1, title: 'گزارش تخلف باز', detail: r.reason || r.entity_type, at: r.created_at, link: '/admin/moderation?tab=reports', actions: ['resolve', 'dismiss'] })
    const cm = await db.all<any>(
      `SELECT cm.id, cm.body, cm.flagged, cm.created_at, p.title AS pub FROM comments cm JOIN posts po ON po.id = cm.post_id JOIN publications p ON p.id = po.publication_id
       WHERE cm.status = 'pending' ORDER BY cm.flagged DESC, cm.created_at LIMIT 50`
    )
    for (const r of cm)
      items.push({ kind: 'comment', id: r.id, priority: r.flagged ? 2 : 3, title: `نظر در انتظار بررسی — ${r.pub}`, detail: String(r.body).slice(0, 140), at: r.created_at, link: '/admin/moderation', actions: ['approve', 'reject'] })
  }
  const dl = await db.all<any>('SELECT id, title, due_at FROM deadlines WHERE due_at >= ? AND due_at <= ? ORDER BY due_at LIMIT 20', [iso(-1), iso(14)])
  for (const r of dl) items.push({ kind: 'deadline', id: r.id, priority: r.due_at <= iso(3) ? 2 : 3, title: `مهلت نزدیک: ${r.title}`, detail: '', at: r.due_at, link: '/admin/announcements', actions: ['open'] })
  const st = await db.all<any>(
    `SELECT i.id, i.number, i.title, i.updated_at, p.title AS pub FROM issues i JOIN publications p ON p.id = i.publication_id
     WHERE i.status IN ('planning','in_production','changes_requested') AND i.deleted_at IS NULL AND p.deleted_at IS NULL AND i.updated_at < ?${s.sql}
     ORDER BY i.updated_at LIMIT 20`,
    [iso(-30), ...s.params]
  )
  for (const r of st) items.push({ kind: 'stalled', id: r.id, priority: 3, title: `شمارهٔ متوقف: ${r.pub} — شمارهٔ ${r.number}`, detail: 'بیش از ۳۰ روز بدون به‌روزرسانی', at: r.updated_at, link: `/admin/issues/${r.id}`, actions: ['open'] })
  items.sort((a, b) => a.priority - b.priority || String(a.at || '').localeCompare(String(b.at || '')))
  const counts: Record<string, number> = {}
  for (const it of items) counts[it.kind] = (counts[it.kind] || 0) + 1
  return c.json({ items, counts, generated_at: now.toISOString() })
})

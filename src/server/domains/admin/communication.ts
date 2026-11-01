// Admin domain module: announcements + deadlines.
// Mounted by routes/admin.ts (ROADMAP phase 17 split; parent middleware applies).
import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { newId } from '../../lib/crypto'
import { audit, bad, body, notify, nowIso, oneOf, str } from '../../lib/util'
import { admin } from './service'

export const communicationRoutes = new Hono<AppEnv>()

// ───────── Communication ─────────
communicationRoutes.get('/announcements', async (c) => {
  admin(c)
  const rows = await c.get('db').all(
    `SELECT a.*, u.display_name AS author_name, (SELECT COUNT(*) FROM announcement_reads r WHERE r.announcement_id = a.id) AS read_count FROM announcements a LEFT JOIN users u ON u.id = a.author_id ORDER BY a.created_at DESC LIMIT 100`
  )
  return c.json({ announcements: rows })
})

communicationRoutes.post('/announcements', async (c) => {
  const u = admin(c)
  const b = await body<any>(c)
  const db = c.get('db')
  const audience = oneOf(b.audience, ['all', 'faculty', 'publication'] as const, 'مخاطب', 'all')
  if (audience !== 'all' && !b.target_id) throw bad('مقصد اطلاعیه را انتخاب کنید')
  const id = newId()
  const title = str(b.title, 'عنوان', { max: 120 })
  await db.run('INSERT INTO announcements (id, author_id, audience, target_id, title, body, pinned, created_at) VALUES (?,?,?,?,?,?,?,?)', [id, u.id, audience, b.target_id || null, title, str(b.body, 'متن', { max: 5000 }), b.pinned ? 1 : 0, nowIso()])
  // notify team accounts in the audience
  const targets = await db.all<{ user_id: string }>(
    `SELECT DISTINCT r.user_id FROM publication_roles r JOIN publications p ON p.id = r.publication_id WHERE r.ended_at IS NULL AND p.deleted_at IS NULL
     ${audience === 'faculty' ? 'AND p.faculty_id = ?' : audience === 'publication' ? 'AND p.id = ?' : ''}`,
    audience === 'all' ? [] : [b.target_id]
  )
  for (const t of targets) await notify(db, t.user_id, 'announcement', 'اطلاعیهٔ جدید: ' + title, '/team')
  await audit(db, u.id, 'announcement.create', 'announcement', id, null, { title, audience })
  return c.json({ ok: true, id })
})

communicationRoutes.delete('/announcements/:id', async (c) => {
  const u = admin(c)
  await c.get('db').run('DELETE FROM announcements WHERE id = ?', [c.req.param('id')])
  await audit(c.get('db'), u.id, 'announcement.delete', 'announcement', c.req.param('id'))
  return c.json({ ok: true })
})

communicationRoutes.get('/deadlines', async (c) => {
  admin(c)
  return c.json({ deadlines: await c.get('db').all('SELECT * FROM deadlines ORDER BY due_at DESC LIMIT 100') })
})

communicationRoutes.post('/deadlines', async (c) => {
  const u = admin(c)
  const b = await body<any>(c)
  const id = newId()
  // ROADMAP phase 14 events calendar: deadline | meeting | workshop | event (+ optional HH:MM and location)
  const kind = ['deadline', 'meeting', 'workshop', 'event'].includes(b.kind) ? b.kind : 'deadline'
  const due = str(b.due_at, 'تاریخ', { max: 10 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw bad('تاریخ نامعتبر است')
  const time = str(b.start_time, 'ساعت', { max: 5, optional: true })
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw bad('ساعت نامعتبر است')
  await c.get('db').run('INSERT INTO deadlines (id, title, due_at, description, kind, start_time, location, created_at) VALUES (?,?,?,?,?,?,?,?)', [
    id, str(b.title, 'عنوان', { max: 120 }), due, str(b.description, 'توضیح', { max: 1000, optional: true }), kind, time || null, str(b.location, 'مکان', { max: 120, optional: true }) || null, nowIso()
  ])
  await audit(c.get('db'), u.id, 'deadline.create', 'deadline', id)
  return c.json({ ok: true, id })
})

communicationRoutes.delete('/deadlines/:id', async (c) => {
  const u = admin(c)
  await c.get('db').run('DELETE FROM deadlines WHERE id = ?', [c.req.param('id')])
  await audit(c.get('db'), u.id, 'deadline.delete', 'deadline', c.req.param('id'))
  return c.json({ ok: true })
})

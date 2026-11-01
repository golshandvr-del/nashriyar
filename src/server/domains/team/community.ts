// Team domain module: recruitment calls + certificates of collaboration.
// Mounted by routes/team.ts (ROADMAP phase 17 split; parent middleware applies).
import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { newId } from '../../lib/crypto'
import { activity, bad, body, nowIso, str } from '../../lib/util'
import { issueOf, pub } from './service'

export const communityRoutes = new Hono<AppEnv>()

// ── Recruitment calls ──
communityRoutes.get('/:pubId/recruitment', async (c) => {
  const { pub: p } = await pub(c)
  return c.json({ calls: await c.get('db').all('SELECT * FROM recruitment_calls WHERE publication_id = ? ORDER BY created_at DESC', [p.id]) })
})

communityRoutes.post('/:pubId/recruitment', async (c) => {
  const { pub: p } = await pub(c, true)
  const b = await body<any>(c)
  const id = newId()
  await c.get('db').run('INSERT INTO recruitment_calls (id, publication_id, title, roles_needed, body, contact, open_until, created_at) VALUES (?,?,?,?,?,?,?,?)', [
    id, p.id, str(b.title, 'عنوان', { max: 120 }), str(b.roles_needed, 'نقش‌های مورد نیاز', { max: 300, optional: true }), str(b.body, 'توضیحات', { max: 3000, optional: true }),
    str(b.contact, 'راه ارتباط', { max: 120, optional: true }), b.open_until || null, nowIso()
  ])
  return c.json({ ok: true, id })
})

communityRoutes.delete('/:pubId/recruitment/:id', async (c) => {
  const { pub: p } = await pub(c, true)
  await c.get('db').run('DELETE FROM recruitment_calls WHERE id = ? AND publication_id = ?', [c.req.param('id'), p.id])
  return c.json({ ok: true })
})

// ── Certificates of collaboration ──
communityRoutes.post('/:pubId/issues/:issueId/certificates', async (c) => {
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

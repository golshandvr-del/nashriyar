// Admin domain module: faculties, majors, associations, production roles.
// Mounted by routes/admin.ts (ROADMAP phase 17 split; parent middleware applies).
import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { newId } from '../../lib/crypto'
import { audit, bad, body, int, nowIso, oneOf, str } from '../../lib/util'
import { admin, monitor } from './service'

export const structureRoutes = new Hono<AppEnv>()

// ───────── Structure: faculties, majors, associations ─────────
structureRoutes.get('/structure', async (c) => {
  monitor(c)
  const db = c.get('db')
  return c.json({
    faculties: await db.all('SELECT f.*, (SELECT COUNT(*) FROM publications p WHERE p.faculty_id = f.id AND p.deleted_at IS NULL) AS publication_count FROM faculties f ORDER BY sort_order, name'),
    majors: await db.all('SELECT * FROM majors ORDER BY name'),
    associations: await db.all(
      'SELECT a.*, f.name AS faculty_name, (SELECT COUNT(*) FROM publications p WHERE p.association_id = a.id AND p.deleted_at IS NULL) AS publication_count FROM associations a LEFT JOIN faculties f ON f.id = a.faculty_id ORDER BY a.name'
    ),
    production_roles: await db.all('SELECT * FROM production_roles ORDER BY sort_order, name')
  })
})

structureRoutes.post('/faculties', async (c) => {
  const u = admin(c)
  const b = await body<any>(c)
  const id = b.id || newId()
  const db = c.get('db')
  const name = str(b.name, 'نام دانشکده', { min: 2, max: 100 })
  if (b.id) await db.run('UPDATE faculties SET name = ?, code = ?, sort_order = ?, is_active = ? WHERE id = ?', [name, b.code || null, int(b.sort_order ?? 0, 'ترتیب', {}), b.is_active === false ? 0 : 1, id])
  else await db.run('INSERT INTO faculties (id, name, code, sort_order, is_active, created_at) VALUES (?,?,?,?,1,?)', [id, name, b.code || null, int(b.sort_order ?? 0, 'ترتیب', {}), nowIso()])
  await audit(db, u.id, b.id ? 'faculty.update' : 'faculty.create', 'faculty', id, null, { name })
  return c.json({ ok: true, id })
})

structureRoutes.post('/majors', async (c) => {
  const u = admin(c)
  const b = await body<any>(c)
  const db = c.get('db')
  const id = b.id || newId()
  const name = str(b.name, 'نام رشته', { min: 2, max: 100 })
  if (!(await db.first('SELECT 1 FROM faculties WHERE id = ?', [b.faculty_id]))) throw bad('دانشکده را انتخاب کنید')
  if (b.id) await db.run('UPDATE majors SET name = ?, faculty_id = ? WHERE id = ?', [name, b.faculty_id, id])
  else await db.run('INSERT INTO majors (id, faculty_id, name, created_at) VALUES (?,?,?,?)', [id, b.faculty_id, name, nowIso()])
  await audit(db, u.id, b.id ? 'major.update' : 'major.create', 'major', id, null, { name })
  return c.json({ ok: true, id })
})

structureRoutes.delete('/majors/:id', async (c) => {
  const u = admin(c)
  const db = c.get('db')
  if (await db.first('SELECT 1 FROM users WHERE major_id = ? UNION SELECT 1 FROM team_members WHERE major_id = ?', [c.req.param('id'), c.req.param('id')])) throw bad('این رشته در حال استفاده است و حذف نمی‌شود')
  await db.run('DELETE FROM majors WHERE id = ?', [c.req.param('id')])
  await audit(db, u.id, 'major.delete', 'major', c.req.param('id'))
  return c.json({ ok: true })
})

structureRoutes.post('/associations', async (c) => {
  const u = admin(c)
  const b = await body<any>(c)
  const db = c.get('db')
  const id = b.id || newId()
  const name = str(b.name, 'نام انجمن/کانون', { min: 2, max: 120 })
  const kind = oneOf(b.kind, ['scientific_association', 'cultural_club', 'islamic_association', 'other'] as const, 'نوع', 'scientific_association')
  if (b.id) await db.run('UPDATE associations SET name = ?, kind = ?, faculty_id = ?, is_active = ? WHERE id = ?', [name, kind, b.faculty_id || null, b.is_active === false ? 0 : 1, id])
  else await db.run('INSERT INTO associations (id, faculty_id, name, kind, is_active, created_at) VALUES (?,?,?,?,1,?)', [id, b.faculty_id || null, name, kind, nowIso()])
  await audit(db, u.id, b.id ? 'association.update' : 'association.create', 'association', id, null, { name, kind })
  return c.json({ ok: true, id })
})

structureRoutes.post('/production-roles', async (c) => {
  const u = admin(c)
  const b = await body<{ roles?: string[] }>(c)
  const roles = (b.roles || []).map((r) => String(r).trim()).filter(Boolean).slice(0, 50)
  if (!roles.length) throw bad('حداقل یک نقش وارد کنید')
  const stmts = [{ sql: 'DELETE FROM production_roles', params: [] as unknown[] }]
  roles.forEach((r, i) => stmts.push({ sql: 'INSERT INTO production_roles (id, name, sort_order) VALUES (?,?,?)', params: [newId(), r.slice(0, 60), i] }))
  await c.get('db').batch(stmts)
  await audit(c.get('db'), u.id, 'production_roles.update', 'settings', null, null, roles)
  return c.json({ ok: true })
})

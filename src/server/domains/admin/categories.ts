// Admin domain module: categories (CRUD, order, merge).
// Mounted by routes/admin.ts (ROADMAP phase 17 split; parent middleware applies).
import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { newId } from '../../lib/crypto'
import { audit, bad, body, nowIso, oneOf, slugify, str } from '../../lib/util'
import { admin, monitor } from './service'

export const categoriesRoutes = new Hono<AppEnv>()

// ───────── Categories ─────────
categoriesRoutes.get('/categories', async (c) => {
  monitor(c)
  const rows = await c.get('db').all(
    `SELECT c.*, (SELECT COUNT(*) FROM publication_categories pc WHERE pc.category_id = c.id) AS publication_count,
       (SELECT COUNT(*) FROM issue_categories ic WHERE ic.category_id = c.id) AS issue_count FROM categories c ORDER BY c.type, c.sort_order, c.name`
  )
  return c.json({ categories: rows })
})

categoriesRoutes.post('/categories', async (c) => {
  const u = admin(c)
  const b = await body<any>(c)
  const db = c.get('db')
  const name = str(b.name, 'نام دسته', { min: 2, max: 60 })
  const type = oneOf(b.type, ['subject', 'major', 'format', 'custom'] as const, 'نوع', 'subject')
  const color = /^#[0-9a-fA-F]{6}$/.test(String(b.color)) ? b.color : null
  if (b.parent_id && b.parent_id === b.id) throw bad('دسته نمی‌تواند والد خودش باشد')
  if (b.id) {
    await db.run('UPDATE categories SET name = ?, type = ?, parent_id = ?, icon = ?, color = ?, is_active = ? WHERE id = ?', [name, type, b.parent_id || null, b.icon || null, color, b.is_active === false ? 0 : 1, b.id])
    await audit(db, u.id, 'category.update', 'category', b.id, null, { name })
    return c.json({ ok: true, id: b.id })
  }
  let slug = slugify(b.slug || name)
  if (await db.first('SELECT 1 FROM categories WHERE slug = ?', [slug])) slug += '-' + newId().slice(-4)
  const id = newId()
  const max = await db.first<{ n: number }>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories WHERE type = ?', [type])
  await db.run('INSERT INTO categories (id, parent_id, type, name, slug, icon, color, sort_order, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,1,?)', [id, b.parent_id || null, type, name, slug, b.icon || null, color, max?.n ?? 0, nowIso()])
  await audit(db, u.id, 'category.create', 'category', id, null, { name, type })
  return c.json({ ok: true, id })
})

categoriesRoutes.post('/categories/order', async (c) => {
  admin(c)
  const b = await body<{ order?: { id: string; parent_id?: string | null }[] }>(c)
  await c.get('db').batch((b.order || []).slice(0, 500).map((o, i) => ({ sql: 'UPDATE categories SET sort_order = ?, parent_id = ? WHERE id = ?', params: [i, o.parent_id || null, o.id] })))
  return c.json({ ok: true })
})

/** Merge category `from` into `into`: re-points publications/issues and deactivates `from`. */
categoriesRoutes.post('/categories/merge', async (c) => {
  const u = admin(c)
  const b = await body<{ from?: string; into?: string }>(c)
  if (!b.from || !b.into || b.from === b.into) throw bad('دو دستهٔ متفاوت انتخاب کنید')
  const db = c.get('db')
  await db.batch([
    { sql: 'INSERT OR IGNORE INTO publication_categories (publication_id, category_id) SELECT publication_id, ? FROM publication_categories WHERE category_id = ?', params: [b.into, b.from] },
    { sql: 'DELETE FROM publication_categories WHERE category_id = ?', params: [b.from] },
    { sql: 'INSERT OR IGNORE INTO issue_categories (issue_id, category_id) SELECT issue_id, ? FROM issue_categories WHERE category_id = ?', params: [b.into, b.from] },
    { sql: 'DELETE FROM issue_categories WHERE category_id = ?', params: [b.from] },
    { sql: 'UPDATE categories SET parent_id = ? WHERE parent_id = ?', params: [b.into, b.from] },
    { sql: 'UPDATE categories SET is_active = 0 WHERE id = ?', params: [b.from] }
  ])
  await audit(db, u.id, 'category.merge', 'category', b.into, { from: b.from }, { into: b.into })
  return c.json({ ok: true })
})

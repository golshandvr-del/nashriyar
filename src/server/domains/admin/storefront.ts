// Admin domain module: storefront curation (shelves, banners).
// Mounted by routes/admin.ts (ROADMAP phase 17 split; parent middleware applies).
import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { newId } from '../../lib/crypto'
import { audit, bad, body, getSetting, int, nowIso, parseJson, setSetting, str } from '../../lib/util'
import { admin } from './service'

export const storefrontRoutes = new Hono<AppEnv>()

// ───────── Storefront curation ─────────
storefrontRoutes.get('/shelves', async (c) => {
  admin(c)
  const db = c.get('db')
  const shelves = await db.all<any>('SELECT * FROM featured_shelves ORDER BY sort_order')
  const banners = await getSetting<any[]>(db, 'home_banners', [])
  const issues = await db.all(
    `SELECT i.id, i.number, i.title, p.title AS publication_title FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.status = 'published' AND i.deleted_at IS NULL ORDER BY i.published_at DESC LIMIT 300`
  )
  return c.json({ shelves: shelves.map((s) => ({ ...s, issue_ids: parseJson(s.issue_ids_json, []) })), banners, issues })
})

storefrontRoutes.post('/shelves', async (c) => {
  const u = admin(c)
  const b = await body<any>(c)
  const db = c.get('db')
  const ids = (Array.isArray(b.issue_ids) ? b.issue_ids : []).slice(0, 40)
  // rule-based shelves (migration 0003): manual | latest | free | popular | category:<id> | faculty:<id>
  const rule = typeof b.rule === 'string' && b.rule !== 'manual' ? b.rule : null
  if (rule && !/^(latest|free|popular|category:[\w-]{1,40}|faculty:[\w-]{1,40})$/.test(rule)) throw bad('قاعدهٔ قفسه نامعتبر است')
  if (b.id) await db.run('UPDATE featured_shelves SET title = ?, issue_ids_json = ?, is_active = ?, sort_order = ?, rule = ? WHERE id = ?', [str(b.title, 'عنوان قفسه', { max: 80 }), JSON.stringify(ids), b.is_active === false ? 0 : 1, int(b.sort_order ?? 0, 'ترتیب', {}), rule, b.id])
  else await db.run('INSERT INTO featured_shelves (id, title, issue_ids_json, sort_order, is_active, rule, created_at) VALUES (?,?,?,?,1,?,?)', [newId(), str(b.title, 'عنوان قفسه', { max: 80 }), JSON.stringify(ids), int(b.sort_order ?? 0, 'ترتیب', {}), rule, nowIso()])
  await audit(db, u.id, 'shelf.save', 'featured_shelf', b.id || null, null, { title: b.title, count: ids.length })
  return c.json({ ok: true })
})

storefrontRoutes.delete('/shelves/:id', async (c) => {
  const u = admin(c)
  await c.get('db').run('DELETE FROM featured_shelves WHERE id = ?', [c.req.param('id')])
  await audit(c.get('db'), u.id, 'shelf.delete', 'featured_shelf', c.req.param('id'))
  return c.json({ ok: true })
})

storefrontRoutes.post('/banners', async (c) => {
  const u = admin(c)
  const b = await body<{ banners?: any[] }>(c)
  const banners = (b.banners || []).slice(0, 8).map((x) => ({ title: String(x.title || '').slice(0, 80), subtitle: String(x.subtitle || '').slice(0, 160), link: String(x.link || '').slice(0, 200), color: /^#[0-9a-fA-F]{6}$/.test(String(x.color)) ? x.color : '#4f46e5' }))
  await setSetting(c.get('db'), 'home_banners', banners)
  await audit(c.get('db'), u.id, 'banners.update', 'settings', 'home_banners', null, banners)
  return c.json({ ok: true })
})

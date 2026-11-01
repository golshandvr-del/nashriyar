// Admin domain module: audit log.
// Mounted by routes/admin.ts (ROADMAP phase 17 split; parent middleware applies).
import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { cursorPage } from '../../lib/util'
import { admin } from './service'

export const auditRoutes = new Hono<AppEnv>()

// ───────── Audit log ─────────
auditRoutes.get('/audit', async (c) => {
  admin(c)
  const action = c.req.query('action')
  // ROADMAP phase 17: keyset pagination (?cursor, ?limit ≤ 300)
  const pg = cursorPage(c, { col: 'a.created_at', idCol: 'a.id', def: 300, max: 300 })
  const params: unknown[] = []
  let w = 'WHERE 1 = 1'
  if (action) (w = 'WHERE a.action LIKE ?'), params.push(action + '%')
  const rows = await c.get('db').all<any>(
    `SELECT a.*, u.display_name AS actor_name, u.username AS actor_username FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id ${w}${pg.and} ORDER BY ${pg.order} LIMIT ${pg.fetch}`,
    [...params, ...pg.params]
  )
  const { rows: items, next_cursor } = pg.finish(rows, (r) => [r.created_at, r.id])
  return c.json({ items, next_cursor })
})

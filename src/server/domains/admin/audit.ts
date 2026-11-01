// Admin domain module: audit log.
// Mounted by routes/admin.ts (ROADMAP phase 17 split; parent middleware applies).
import { Hono, type Context } from 'hono'
import type { AppEnv } from '../../context'
import { cursorPage, type PageOverride } from '../../lib/util'
import { streamExport } from '../../lib/export'
import { AUDIT_COLUMNS } from '../../../shared/columns'
import { admin } from './service'

export const auditRoutes = new Hono<AppEnv>()

/** The audit query (screen and export share it; `page` lets the export walk every keyset page). */
async function listAudit(c: Context<AppEnv>, page?: PageOverride) {
  const action = c.req.query('action')
  // ROADMAP phase 17: keyset pagination (?cursor, ?limit ≤ 300)
  const pg = cursorPage(c, { col: 'a.created_at', idCol: 'a.id', def: 300, max: 300, page })
  const params: unknown[] = []
  let w = 'WHERE 1 = 1'
  if (action) (w = 'WHERE a.action LIKE ?'), params.push(action + '%')
  const rows = await c.get('db').all<any>(
    `SELECT a.*, COALESCE(u.display_name, u.username) AS actor_name, u.username AS actor_username FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id ${w}${pg.and} ORDER BY ${pg.order} LIMIT ${pg.fetch}`,
    [...params, ...pg.params]
  )
  const { rows: items, next_cursor } = pg.finish(rows, (r) => [r.created_at, r.id])
  // ROADMAP phase 18: the dotted action's prefix lets the DataTable filter/group events by kind
  return { rows: items.map((r) => ({ ...r, action_group: String(r.action || '').split('.')[0] })), next_cursor }
}

// ───────── Audit log ─────────
auditRoutes.get('/audit', async (c) => {
  admin(c)
  const { rows: items, next_cursor } = await listAudit(c)
  return c.json({ items, next_cursor })
})

/** Streaming XLSX/CSV of the audit log with the on-screen table state (ROADMAP phase 18). */
auditRoutes.get('/audit/export', async (c) => {
  admin(c)
  return streamExport(c, { name: 'audit-log', title: 'گزارش رویدادها', columns: AUDIT_COLUMNS, fetchPage: (cursor) => listAudit(c, { cursor, limit: 300 }) })
})

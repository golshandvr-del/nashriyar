// Admin service layer (ROADMAP phase 17 — route files split into domain modules + service layer).
// Shared guards and scope helpers for every /api/admin domain module.
import type { Context } from 'hono'
import type { AppEnv } from '../../context'
import { ADMIN_ROLES, MONITOR_ROLES } from '../../context'
import { requireRole } from '../../auth'
import { notFound } from '../../lib/util'

export const PUB_ROLES = ['managing_director', 'editor_in_chief', 'license_holder'] as const
export const PUB_ROLE_FA: Record<string, string> = { managing_director: 'مدیرمسئول', editor_in_chief: 'سردبیر', license_holder: 'صاحب امتیاز' }

export const admin = (c: Context<AppEnv>) => requireRole(c, ADMIN_ROLES)
export const monitor = (c: Context<AppEnv>) => requireRole(c, MONITOR_ROLES)

/** Faculty supervisors only see their own faculty. Returns SQL fragment + params for publications alias `p`. */
export function scope(c: Context<AppEnv>): { sql: string; params: unknown[] } {
  const u = c.get('user')!
  if (u.system_role === 'faculty_supervisor') return { sql: ' AND p.faculty_id = ?', params: [u.scope_faculty_id] }
  return { sql: '', params: [] }
}

export async function scopedPub(c: Context<AppEnv>, id: string) {
  monitor(c)
  const s = scope(c)
  const p = await c.get('db').first<any>(`SELECT p.* FROM publications p WHERE p.id = ? AND p.deleted_at IS NULL${s.sql}`, [id, ...s.params])
  if (!p) throw notFound('نشریه یافت نشد')
  return p
}

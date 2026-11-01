import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { audit, body, getSetting, setSetting } from '../lib/util'
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, getThresholds, getWeights, sanitizeThresholds, sanitizeWeights } from '../insights'
import { admin } from '../domains/admin/service'
import { todayRoutes } from '../domains/admin/today'
import { publicationsRoutes } from '../domains/admin/publications'
import { usersRoutes } from '../domains/admin/users'
import { structureRoutes } from '../domains/admin/structure'
import { categoriesRoutes } from '../domains/admin/categories'
import { approvalsRoutes } from '../domains/admin/approvals'
import { moderationRoutes } from '../domains/admin/moderation'
import { storefrontRoutes } from '../domains/admin/storefront'
import { communicationRoutes } from '../domains/admin/communication'
import { auditRoutes } from '../domains/admin/audit'
import { allowlistRoutes } from '../domains/admin/allowlist'

export const adminRoutes = new Hono<AppEnv>()

// domain module (ROADMAP phase 17): ../domains/admin/today
adminRoutes.route('/', todayRoutes)

// domain module (ROADMAP phase 17): ../domains/admin/publications
adminRoutes.route('/', publicationsRoutes)

// domain module (ROADMAP phase 17): ../domains/admin/users
adminRoutes.route('/', usersRoutes)

// domain module (ROADMAP phase 17): ../domains/admin/structure
adminRoutes.route('/', structureRoutes)

// domain module (ROADMAP phase 17): ../domains/admin/categories
adminRoutes.route('/', categoriesRoutes)

// domain module (ROADMAP phase 17): ../domains/admin/approvals
adminRoutes.route('/', approvalsRoutes)

// domain module (ROADMAP phase 17): ../domains/admin/moderation
adminRoutes.route('/', moderationRoutes)

// domain module (ROADMAP phase 17): ../domains/admin/storefront
adminRoutes.route('/', storefrontRoutes)

// domain module (ROADMAP phase 17): ../domains/admin/communication
adminRoutes.route('/', communicationRoutes)

// domain module (ROADMAP phase 17): ../domains/admin/audit
adminRoutes.route('/', auditRoutes)

// domain module (ROADMAP phase 17): ../domains/admin/allowlist
adminRoutes.route('/', allowlistRoutes)

// ───────── Settings (publication affairs only) ─────────
// Technical settings (AI layer, feature flags, members-only reading, session cap, maintenance) moved to the
// developer console /api/system/settings (ROADMAP phase 13) — neither the officer nor the super admin sees them here.
const OFFICER_SETTINGS = ['site_name', 'university_name', 'registration_open', 'registration_mode', 'supervisor_can_approve', 'default_code_ttl_hours'] as const

adminRoutes.get('/settings', async (c) => {
  const u = admin(c)
  const db = c.get('db')
  const out: Record<string, unknown> = {}
  for (const k of OFFICER_SETTINGS) out[k] = k === 'default_code_ttl_hours' ? await getSetting(db, k, 24) : k === 'registration_mode' ? await getSetting(db, k, 'open') : await getSetting(db, k, k === 'registration_open' ? true : k === 'supervisor_can_approve' ? false : k === 'site_name' ? 'نشریار' : 'دانشگاه')
  out.insight_thresholds = await getThresholds(db)
  out.health_weights = await getWeights(db)
  return c.json({ settings: out, is_super: u.system_role === 'super_admin', defaults: { insight_thresholds: DEFAULT_THRESHOLDS, health_weights: DEFAULT_WEIGHTS } })
})

adminRoutes.post('/settings', async (c) => {
  const u = admin(c)
  const b = await body<Record<string, unknown>>(c)
  const db = c.get('db')
  const keys: string[] = [...OFFICER_SETTINGS]
  const changed: Record<string, unknown> = {}
  for (const k of keys) {
    if (!(k in b)) continue
    let v = b[k]
    if (k === 'registration_mode') v = v === 'allowlist' ? 'allowlist' : 'open'
    if (k === 'default_code_ttl_hours') v = Math.max(1, Math.min(24, Math.floor(Number(v) || 24))) // client decision #5: max 24h
    if (typeof v === 'string') v = v.slice(0, 500)
    await setSetting(db, k, v)
    changed[k] = v
  }
  // Rule thresholds and health weights (officer and super admin; ROADMAP phase 8)
  if ('insight_thresholds' in b) {
    const next = sanitizeThresholds({ ...(await getThresholds(db)), ...((b.insight_thresholds as object) || {}) })
    await setSetting(db, 'insight_thresholds', next)
    changed.insight_thresholds = next
  }
  if ('health_weights' in b) {
    const next = sanitizeWeights({ ...(await getWeights(db)), ...((b.health_weights as object) || {}) })
    await setSetting(db, 'health_weights', next)
    changed.health_weights = next
  }
  await audit(db, u.id, 'settings.update', 'settings', null, null, changed)
  return c.json({ ok: true })
})

// Server monitoring moved to the developer console: GET /api/system/health (ROADMAP phase 13).

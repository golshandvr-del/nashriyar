import { Hono } from 'hono'
import type { AppEnv } from '../context'
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
import { settingsRoutes } from '../domains/admin/settings'
import { printArchiveRoutes } from '../domains/admin/print-archive'

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

// domain module (ROADMAP phase 17): ../domains/admin/settings
adminRoutes.route('/', settingsRoutes)

// domain module (ROADMAP phase 19): ../domains/admin/print-archive — digitised old printed issues
adminRoutes.route('/', printArchiveRoutes)


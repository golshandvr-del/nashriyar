import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { requireUser, userPubRoles } from '../auth'
import { DEFAULT_STAGES } from '../domains/team/service'
import { dashboardRoutes } from '../domains/team/dashboard'
import { membersRoutes } from '../domains/team/members'
import { issuesRoutes } from '../domains/team/issues'
import { salesRoutes } from '../domains/team/sales'
import { exploreRoutes } from '../domains/team/explore'
import { commentsRoutes } from '../domains/team/comments'
import { communityRoutes } from '../domains/team/community'
import { statsRoutes } from '../domains/team/stats'
// re-exported: other modules historically imported the default production stages from this file
export { DEFAULT_STAGES }

export const teamRoutes = new Hono<AppEnv>()

// Every /api/team/:pubId/* request is checked: the user must hold one of the three main roles of THIS publication.
// Follower data is NEVER returned from this router (docs/ROLES.md rule 2).

teamRoutes.get('/my', async (c) => {
  const u = requireUser(c)
  return c.json({ publications: await userPubRoles(c, u.id) })
})

// domain module (ROADMAP phase 17): ../domains/team/dashboard
teamRoutes.route('/', dashboardRoutes)

// domain module (ROADMAP phase 17): ../domains/team/members
teamRoutes.route('/', membersRoutes)

// domain module (ROADMAP phase 17): ../domains/team/issues
teamRoutes.route('/', issuesRoutes)

// domain module (ROADMAP phase 17): ../domains/team/sales
teamRoutes.route('/', salesRoutes)

// domain module (ROADMAP phase 17): ../domains/team/explore
teamRoutes.route('/', exploreRoutes)

// domain module (ROADMAP phase 17): ../domains/team/comments
teamRoutes.route('/', commentsRoutes)

// domain module (ROADMAP phase 17): ../domains/team/community
teamRoutes.route('/', communityRoutes)

// domain module (ROADMAP phase 17): ../domains/team/stats
teamRoutes.route('/', statsRoutes)


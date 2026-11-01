// Analytics domain module: optional AI layer (Phase 10) — disabled unless configured.
// Mounted by routes/analytics.ts (ROADMAP phase 17 split; parent middleware applies).
import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { body, dateRange } from '../../lib/util'
import { computeInsights } from '../../insights'
import { aiNarrative, aiAsk } from '../../ai'
import { mapQuestion, ASK_REPORT_LABELS } from '../../../shared/askmap'
import { kpis, previousRange, pubScope } from './service'

export const aiRoutes = new Hono<AppEnv>()

// ───────── Optional AI layer (Phase 10) — disabled unless configured ─────────
aiRoutes.post('/ai/narrative', async (c) => {
  const { from, to } = dateRange(c, 90)
  const { pFrom, pTo } = previousRange(from, to)
  const data = { from, to, current: await kpis(c, from, to), previous: await kpis(c, pFrom, pTo), insights: (await computeInsights(c.get('db'), pubScope(c))).slice(0, 10) }
  return c.json(await aiNarrative(c, data))
})

/**
 * Persian statistical Q&A (ROADMAP phase 10): the question is first mapped — deterministically, from
 * whitelists only (src/shared/askmap.ts) — to one of the predefined reports + range (+ faculty). The UI
 * opens that report with the normal dashboard components. No free SQL is ever generated. The optional AI
 * only adds a short narrative over the same aggregated KPIs.
 */
aiRoutes.post('/ai/ask', async (c) => {
  const b = await body<{ question?: string }>(c)
  const question = String(b.question || '').slice(0, 500)
  const u = c.get('user')!
  const faculties = await c.get('db').all<{ id: string; name: string }>(
    u.system_role === 'faculty_supervisor' ? 'SELECT id, name FROM faculties WHERE id = ?' : 'SELECT id, name FROM faculties',
    u.system_role === 'faculty_supervisor' ? [u.scope_faculty_id] : []
  )
  const route = mapQuestion(question, faculties)
  const { from, to } = dateRange(c, 365)
  const data = { from, to, report: ASK_REPORT_LABELS[route.report], kpis: await kpis(c, from, to) }
  const ai = await aiAsk(c, question, data)
  return c.json({ ...ai, route: { ...route, label: ASK_REPORT_LABELS[route.report] } })
})

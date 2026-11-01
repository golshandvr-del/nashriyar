// Analytics domain module: rule-based insights + root-cause explanation (ROADMAP phases 8/10) — phase 17 split.
// Mounted by routes/analytics.ts under /api/analytics (role guard, rollup and cache middleware apply from there).
import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { nowIso } from '../../lib/util'
import { computeInsights } from '../../insights'
import { aiExplain } from '../../ai'
import { gatherEvidence, ruleHypotheses } from '../../lib/explain'
import { pubScope } from './service'

export const insightsRoutes = new Hono<AppEnv>()

/** Rule-based insights (Phase 8). */
insightsRoutes.get('/insights', async (c) => {
  const s = pubScope(c)
  const items = await computeInsights(c.get('db'), s)
  return c.json({ items })
})

insightsRoutes.post('/insights/:key/dismiss', async (c) => {
  const u = c.get('user')!
  await c.get('db').run('INSERT OR REPLACE INTO insight_dismissals (insight_key, dismissed_by, dismissed_at) VALUES (?,?,?)', [c.req.param('key'), u.id, nowIso()])
  return c.json({ ok: true })
})

/**
 * Root-cause analysis of one insight (ROADMAP phase 10). The insight is looked up inside the viewer's own
 * scope (a faculty supervisor cannot probe other faculties). Rule-based hypotheses always; AI hypotheses
 * only when the optional provider is enabled, labelled source='ai' («پیشنهاد هوش مصنوعی»).
 */
insightsRoutes.post('/insights/:key/explain', async (c) => {
  const key = c.req.param('key')
  const items = await computeInsights(c.get('db'), pubScope(c))
  const it = items.find((x) => x.key === key)
  if (!it) return c.json({ error: 'این بینش در محدودهٔ دسترسی شما یافت نشد' }, 404)
  if (!it.publication_id) return c.json({ insight: it, evidence: null, hypotheses: [{ text: 'این بینش به نشریهٔ مشخصی مربوط نیست؛ تحلیل علت برای بینش‌های کلی در دسترس نیست.', source: 'rule' }] })
  const evidence = await gatherEvidence(c.get('db'), it.publication_id)
  if (!evidence) return c.json({ error: 'نشریه یافت نشد' }, 404)
  const hypotheses = [...ruleHypotheses(evidence), ...(await aiExplain(c, it, evidence)).map((text) => ({ text, source: 'ai' as const }))]
  return c.json({ insight: it, evidence, hypotheses })
})

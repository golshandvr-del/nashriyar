// Analytics domain module: production speed, publishing gaps, managing-director performance.
// Mounted by routes/analytics.ts (ROADMAP phase 17 split; parent middleware applies).
import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { dateRange, nowIso } from '../../lib/util'
import { DAY, pubScope } from './service'

export const productionRoutes = new Hono<AppEnv>()

/** Production speed: average days per stage and per issue, by publication. */
productionRoutes.get('/production', async (c) => {
  const db = c.get('db')
  const s = pubScope(c)
  const { from, to } = dateRange(c, 365)
  const fromTs = from + 'T00:00:00.000Z'
  const toTs = to + 'T23:59:59.999Z'
  const stages = await db.all(
    `SELECT st.key, st.title, COUNT(*) AS n, AVG(julianday(st.completed_at) - julianday(st.started_at)) AS avg_days,
       MIN(julianday(st.completed_at) - julianday(st.started_at)) AS min_days, MAX(julianday(st.completed_at) - julianday(st.started_at)) AS max_days
     FROM issue_stages st JOIN issues i ON i.id = st.issue_id JOIN publications p ON p.id = i.publication_id
     WHERE st.status = 'done' AND st.started_at IS NOT NULL AND st.completed_at IS NOT NULL AND st.completed_at BETWEEN ? AND ?${s.sql}
     GROUP BY st.key ORDER BY MIN(st.sort_order)`,
    [fromTs, toTs, ...s.params]
  )
  const cycle = await db.all(
    `SELECT p.id, p.title, COUNT(i.id) AS n, AVG(julianday(i.published_at) - julianday(i.created_at)) AS avg_cycle_days,
       SUM(CASE WHEN i.planned_publish_at IS NOT NULL AND substr(i.published_at,1,10) > i.planned_publish_at THEN 1 ELSE 0 END) AS late
     FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?${s.sql}
     GROUP BY p.id ORDER BY avg_cycle_days`,
    [fromTs, toTs, ...s.params]
  )
  const approvals = await db.first(
    `SELECT COUNT(*) AS n, AVG(julianday(a.decided_at) - julianday(a.requested_at)) AS avg_days, SUM(CASE WHEN a.decision = 'changes_requested' THEN 1 ELSE 0 END) AS changes
     FROM issue_approvals a JOIN issues i ON i.id = a.issue_id JOIN publications p ON p.id = i.publication_id WHERE a.decided_at BETWEEN ? AND ? AND a.decision IN ('approved','changes_requested')${s.sql}`,
    [fromTs, toTs, ...s.params]
  )
  // Median duration per stage (SQLite has no MEDIAN) + bottleneck heatmap rows: publication × stage avg days
  const durs = await db.all<{ key: string; pub: string; d: number }>(
    `SELECT st.key, p.title AS pub, julianday(st.completed_at) - julianday(st.started_at) AS d
     FROM issue_stages st JOIN issues i ON i.id = st.issue_id JOIN publications p ON p.id = i.publication_id
     WHERE st.status = 'done' AND st.started_at IS NOT NULL AND st.completed_at IS NOT NULL AND st.completed_at BETWEEN ? AND ?${s.sql}`,
    [fromTs, toTs, ...s.params]
  )
  const byKey: Record<string, number[]> = {}
  const heat: Record<string, Record<string, { sum: number; n: number }>> = {}
  for (const r of durs) {
    ;(byKey[r.key] ||= []).push(r.d)
    const cell = ((heat[r.pub] ||= {})[r.key] ||= { sum: 0, n: 0 })
    cell.sum += r.d
    cell.n++
  }
  const median = (xs: number[]) => {
    const a = [...xs].sort((x, y) => x - y)
    const m = a.length >> 1
    return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : null
  }
  const stagesOut = (stages as any[]).map((st) => ({ ...st, median_days: median(byKey[st.key] || []) }))
  const bottlenecks = Object.entries(heat).map(([pub, cells]) => ({
    publication: pub,
    cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, Math.round((v.sum / v.n) * 10) / 10]))
  }))
  // Production output and active people (ROADMAP phase 7): published vs in progress, who is doing the work
  const output = await db.first<any>(
    `SELECT SUM(CASE WHEN i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS published,
       SUM(CASE WHEN i.status IN ('planning','in_production','changes_requested','awaiting_approval') THEN 1 ELSE 0 END) AS in_progress
     FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.deleted_at IS NULL${s.sql}`,
    [fromTs, toTs, ...s.params]
  )
  const people = await db.all(
    `SELECT u.id, u.display_name, p.title AS publication_title, COUNT(*) AS actions, MAX(a.created_at) AS last_at
     FROM activity_events a JOIN users u ON u.id = a.actor_user_id JOIN publications p ON p.id = a.publication_id
     WHERE a.created_at BETWEEN ? AND ? AND a.type NOT IN ('follow','unfollow','library.add_free','comment.created','code.redeemed')${s.sql}
     GROUP BY u.id, p.id ORDER BY actions DESC LIMIT 30`,
    [fromTs, toTs, ...s.params]
  )
  // ROADMAP phase 7 production Gantt: issues currently in production, start → planned publish date
  const timeline = await db.all(
    `SELECT i.id, i.number, i.status, i.created_at, i.planned_publish_at, p.id AS publication_id, p.title AS publication_title
     FROM issues i JOIN publications p ON p.id = i.publication_id
     WHERE i.deleted_at IS NULL AND p.deleted_at IS NULL AND i.status IN ('planning','in_production','changes_requested','awaiting_approval')${s.sql}
     ORDER BY COALESCE(i.planned_publish_at, '9999') LIMIT 40`,
    s.params
  )
  return c.json({ from, to, stages: stagesOut, cycle, approvals, bottlenecks, output, people, timeline })
})

/** Publishing gaps: days between consecutive issues vs. declared frequency. */
productionRoutes.get('/gaps', async (c) => {
  const db = c.get('db')
  const s = pubScope(c)
  const pubs = await db.all<any>(`SELECT p.id, p.title, p.frequency, p.created_at FROM publications p WHERE p.deleted_at IS NULL AND p.status = 'active'${s.sql}`, s.params)
  const expected: Record<string, number> = { monthly: 30, bimonthly: 60, quarterly: 90, biannual: 180, irregular: 120 }
  const out = []
  for (const p of pubs) {
    const dates = (await db.all<{ d: string }>("SELECT published_at AS d FROM issues WHERE publication_id = ? AND status IN ('published','archived') AND published_at IS NOT NULL ORDER BY published_at", [p.id])).map((r) => r.d)
    const gaps: number[] = []
    for (let k = 1; k < dates.length; k++) gaps.push(Math.round((new Date(dates[k]).getTime() - new Date(dates[k - 1]).getTime()) / DAY))
    const last = dates[dates.length - 1] || null
    const since = last ? Math.round((Date.now() - new Date(last).getTime()) / DAY) : null
    // Concurrent factors (ROADMAP phase 7): what happened inside the longest gap (or the open gap since the last issue)
    const exp = expected[p.frequency] ?? 120
    let win: [string, string] | null = null
    if (gaps.length) {
      const k = gaps.indexOf(Math.max(...gaps))
      if (gaps[k] > exp * 1.5) win = [dates[k], dates[k + 1]]
    }
    if (last && since != null && since > exp * 1.5 && (!win || since > Math.max(...gaps))) win = [last, nowIso()]
    const factors: string[] = []
    if (win) {
      const dir = await db.first<{ n: number }>(
        "SELECT COUNT(*) AS n FROM publication_roles WHERE publication_id = ? AND role = 'managing_director' AND started_at > ? AND started_at <= ?",
        [p.id, win[0], win[1]]
      )
      if (dir?.n) factors.push('تغییر مدیرمسئول')
      const left = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM team_members WHERE publication_id = ? AND left_at > ? AND left_at <= ?', [p.id, win[0], win[1]])
      if (left?.n) factors.push(`ترک ${left.n} عضو`)
      const slow = await db.first<{ title: string; d: number }>(
        `SELECT st.title, MAX(julianday(COALESCE(st.completed_at, ?)) - julianday(st.started_at)) AS d FROM issue_stages st JOIN issues i ON i.id = st.issue_id
         WHERE i.publication_id = ? AND st.started_at IS NOT NULL AND st.started_at < ? AND COALESCE(st.completed_at, ?) > ?`,
        [win[1], p.id, win[1], win[1], win[0]]
      )
      if (slow?.title && slow.d > 30) factors.push(`مرحلهٔ طولانی «${slow.title}» (${Math.round(slow.d)} روز)`)
    }
    out.push({
      gap_window: win, factors,
      id: p.id, title: p.title, frequency: p.frequency, expected_days: expected[p.frequency] ?? 120, issues: dates.length,
      avg_gap: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null, max_gap: gaps.length ? Math.max(...gaps) : null,
      // ROADMAP phase 7: sequential intervals (1→2, 2→3, …), coefficient of variation, abnormal flags (> 1.5× expected)
      intervals: gaps.map((g, k) => ({ from: k + 1, to: k + 2, days: g, abnormal: g > exp * 1.5 })),
      cv: gaps.length > 1 ? (() => { const m = gaps.reduce((a, b) => a + b, 0) / gaps.length; const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - m) ** 2, 0) / gaps.length); return m ? Math.round((sd / m) * 100) / 100 : null })() : null,
      days_since_last: since, last_published_at: last, overdue: since != null && since > (expected[p.frequency] ?? 120)
    })
  }
  out.sort((a, b) => (b.days_since_last ?? 9999) - (a.days_since_last ?? 9999))
  return c.json({ rows: out })
})

/** Managing-director performance: output of each director during their own tenure (uses role history). */
const DIRECTOR_EXPECTED: Record<string, number> = { monthly: 30, bimonthly: 60, quarterly: 90, biannual: 180, irregular: 120 }

productionRoutes.get('/directors', async (c) => {
  const db = c.get('db')
  const s = pubScope(c)
  const tenures = await db.all<any>(
    `SELECT r.user_id, r.started_at, r.ended_at, u.display_name, p.id AS publication_id, p.title AS publication_title, p.frequency
     FROM publication_roles r JOIN users u ON u.id = r.user_id JOIN publications p ON p.id = r.publication_id
     WHERE r.role = 'managing_director' AND p.deleted_at IS NULL${s.sql} ORDER BY p.title, r.started_at`,
    s.params
  )
  const rows = []
  for (const t of tenures) {
    const end = t.ended_at || nowIso()
    const months = Math.max(1, (new Date(end).getTime() - new Date(t.started_at).getTime()) / (30 * DAY))
    const pub = await db.first<any>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(page_count),0) AS pages, AVG(julianday(published_at) - julianday(created_at)) AS cycle,
         SUM(CASE WHEN planned_publish_at IS NOT NULL AND substr(published_at,1,10) > planned_publish_at THEN 1 ELSE 0 END) AS late,
         AVG(CASE WHEN planned_publish_at IS NOT NULL AND substr(published_at,1,10) > planned_publish_at THEN julianday(substr(published_at,1,10)) - julianday(planned_publish_at) END) AS avg_late_days
       FROM issues
       WHERE publication_id = ? AND status IN ('published','archived') AND published_at BETWEEN ? AND ?`,
      [t.publication_id, t.started_at, end]
    )
    const views = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM view_events WHERE publication_id = ? AND day BETWEEN ? AND ?', [t.publication_id, t.started_at.slice(0, 10), end.slice(0, 10)])
    const sold = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM access_codes WHERE publication_id = ? AND redeemed_at BETWEEN ? AND ?', [t.publication_id, t.started_at, end])
    const followers = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM follows WHERE publication_id = ? AND created_at BETWEEN ? AND ?', [t.publication_id, t.started_at, end])
    rows.push({
      ...t, current: !t.ended_at, months: Math.round(months * 10) / 10, published: pub?.n ?? 0, pages: pub?.pages ?? 0,
      per_month: Math.round(((pub?.n ?? 0) / months) * 100) / 100, avg_cycle_days: pub?.cycle != null ? Math.round(pub.cycle) : null,
      views: views?.n ?? 0, digital_sold: sold?.n ?? 0, new_followers: followers?.n ?? 0,
      // ROADMAP phase 7: delay + fulfilment of the declared publication frequency during this tenure
      late: pub?.late ?? 0,
      avg_late_days: pub?.avg_late_days != null ? Math.round(pub.avg_late_days) : null,
      expected: Math.max(1, Math.floor((months * 30) / (DIRECTOR_EXPECTED[t.frequency] ?? 120))),
      fulfilment: Math.min(999, Math.round(((pub?.n ?? 0) / Math.max(1, Math.floor((months * 30) / (DIRECTOR_EXPECTED[t.frequency] ?? 120)))) * 100))
    })
  }
  return c.json({ rows })
})

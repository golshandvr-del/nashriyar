// Analytics domain module: Phase 14 visual analytics (/visuals) — ROADMAP phase 17 split of routes/analytics.ts.
// Mounted by routes/analytics.ts under /api/analytics (role guard, rollup and cache middleware apply from there).
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../../context'
import { dateRange, getSetting } from '../../lib/util'
import { JALALI_MONTHS, jalaliToIso, toJalali } from '../../../shared/fa'
import { DAY, pubScope, tailFrom } from './service'

export const visualsRoutes = new Hono<AppEnv>()

// ───────── Phase 14 visual analytics (one call, scoped by pubScope, cached 5 min by the middleware) ─────────
const EXPECTED_DAYS: Record<string, number> = { monthly: 30, bimonthly: 60, quarterly: 90, biannual: 180, irregular: 120 }

/** Views per publication over [from, to]: rolled-up days from view_daily + the not-yet-rolled tail from view_events. */
async function viewsByPub(c: Context<AppEnv>, from: string, to: string): Promise<Record<string, number>> {
  const db = c.get('db')
  const until = (await getSetting<string | null>(db, 'analytics_rollup_until', null)) || '0000-00-00'
  const out: Record<string, number> = {}
  const add = (rows: { id: string; n: number }[]) => rows.forEach((r) => (out[r.id] = (out[r.id] || 0) + Number(r.n || 0)))
  add(await db.all('SELECT publication_id AS id, SUM(n) AS n FROM view_daily WHERE day BETWEEN ? AND ? AND day <= ? GROUP BY publication_id', [from, to, until]))
  add(await db.all('SELECT publication_id AS id, COUNT(*) AS n FROM view_events WHERE day BETWEEN ? AND ? AND day > ? GROUP BY publication_id', [tailFrom(from, until), to, until]))
  return out
}

const jOf = (iso: string) => {
  const d = new Date(iso)
  return toJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

visualsRoutes.get('/visuals', async (c) => {
  const db = c.get('db')
  const s = pubScope(c)
  const { from, to, fromTs, toTs } = dateRange(c, 365)
  const now = Date.now()
  const isoAgo = (d: number) => new Date(now - d * DAY).toISOString()
  const PUB = "i.status IN ('published','archived') AND i.deleted_at IS NULL"

  // 1) Jalali calendar heatmap: published issues and views per day
  const until = (await getSetting<string | null>(db, 'analytics_rollup_until', null)) || '0000-00-00'
  const heat: Record<string, { published: number; views: number }> = {}
  const cell = (d: string) => (heat[d] ||= { published: 0, views: 0 })
  for (const r of await db.all<{ d: string; n: number }>(`SELECT substr(i.published_at,1,10) AS d, COUNT(*) AS n FROM issues i JOIN publications p ON p.id = i.publication_id WHERE ${PUB} AND i.published_at BETWEEN ? AND ?${s.sql} GROUP BY d`, [fromTs, toTs, ...s.params]))
    cell(r.d).published += Number(r.n)
  for (const r of await db.all<{ d: string; n: number }>(`SELECT v.day AS d, SUM(v.n) AS n FROM view_daily v JOIN publications p ON p.id = v.publication_id WHERE v.day BETWEEN ? AND ? AND v.day <= ?${s.sql} GROUP BY v.day`, [from, to, until, ...s.params]))
    cell(r.d).views += Number(r.n)
  for (const r of await db.all<{ d: string; n: number }>(`SELECT v.day AS d, COUNT(*) AS n FROM view_events v JOIN publications p ON p.id = v.publication_id WHERE v.day BETWEEN ? AND ? AND v.day > ?${s.sql} GROUP BY v.day`, [tailFrom(from, until), to, until, ...s.params]))
    cell(r.d).views += Number(r.n)

  // 2) Production funnel over issues started in the range + average days spent in each step
  const funnel = await db.first<any>(
    `SELECT COUNT(*) AS planning,
       SUM(CASE WHEN i.status <> 'planning' OR EXISTS (SELECT 1 FROM issue_stages st WHERE st.issue_id = i.id AND st.started_at IS NOT NULL) THEN 1 ELSE 0 END) AS production,
       SUM(CASE WHEN i.status IN ('awaiting_approval','published','archived') OR EXISTS (SELECT 1 FROM issue_approvals a WHERE a.issue_id = i.id) THEN 1 ELSE 0 END) AS awaiting,
       SUM(CASE WHEN i.status IN ('published','archived') THEN 1 ELSE 0 END) AS published
     FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.deleted_at IS NULL AND p.deleted_at IS NULL AND i.created_at BETWEEN ? AND ?${s.sql}`,
    [fromTs, toTs, ...s.params]
  )
  const steps = await db.first<any>(
    `SELECT AVG(CASE WHEN x.fs >= x.c THEN julianday(x.fs) - julianday(x.c) END) AS planning,
       AVG(CASE WHEN x.rq >= x.fs THEN julianday(x.rq) - julianday(x.fs) END) AS production,
       AVG(CASE WHEN x.pub >= x.rq THEN julianday(x.pub) - julianday(x.rq) END) AS awaiting
     FROM (SELECT i.created_at AS c, i.published_at AS pub,
             (SELECT MIN(st.started_at) FROM issue_stages st WHERE st.issue_id = i.id) AS fs,
             (SELECT MIN(a.requested_at) FROM issue_approvals a WHERE a.issue_id = i.id) AS rq
           FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.deleted_at IS NULL AND p.deleted_at IS NULL AND i.created_at BETWEEN ? AND ?${s.sql}) x`,
    [fromTs, toTs, ...s.params]
  )
  const r1 = (v: unknown) => (v == null ? null : Math.round(Number(v) * 10) / 10)

  // 3) Sunburst faculty → association → publication (published issues and views in range)
  const pubs = await db.all<any>(
    `SELECT p.id, p.title, p.frequency, p.created_at, a.id AS aid, a.name AS aname, f.id AS fid, f.name AS fname,
       (SELECT COUNT(*) FROM issues i WHERE i.publication_id = p.id AND ${PUB} AND i.published_at BETWEEN ? AND ?) AS published
     FROM publications p JOIN associations a ON a.id = p.association_id LEFT JOIN faculties f ON f.id = COALESCE(p.faculty_id, a.faculty_id)
     WHERE p.deleted_at IS NULL${s.sql} ORDER BY p.title LIMIT 300`,
    [fromTs, toTs, ...s.params]
  )
  const vRange = await viewsByPub(c, from, to)
  const tree: any[] = []
  const node = (list: any[], id: string, name: string) => {
    let n = list.find((x) => x.id === id)
    if (!n) list.push((n = { id, name, children: [] as any[] }))
    return n
  }
  for (const p of pubs) {
    const f = node(tree, p.fid || 'none', p.fname || 'بدون دانشکده')
    const a = node(f.children, p.aid, p.aname)
    a.children.push({ id: p.id, name: p.title, published: Number(p.published || 0), views: vRange[p.id] || 0 })
  }

  // 4) Health radar per publication (0..100 on each axis; relative axes are normalised to the best publication)
  const ids = pubs.map((p) => p.id)
  const byPub = async (sql: string, params: unknown[]) => {
    const m: Record<string, number> = {}
    for (const r of await db.all<{ id: string; n: number }>(sql, params)) m[r.id] = Number(r.n || 0)
    return m
  }
  const last = await db.all<{ id: string; d: string }>(`SELECT i.publication_id AS id, MAX(i.published_at) AS d FROM issues i WHERE ${PUB} GROUP BY i.publication_id`)
  const lastMap = Object.fromEntries(last.map((r) => [r.id, r.d]))
  const v90 = await viewsByPub(c, isoAgo(90).slice(0, 10), new Date(now).toISOString().slice(0, 10))
  const fol = await byPub('SELECT publication_id AS id, COUNT(*) AS n FROM follows WHERE created_at > ? GROUP BY publication_id', [isoAgo(90)])
  const codes = await byPub('SELECT publication_id AS id, COUNT(*) AS n FROM access_codes WHERE redeemed_at > ? GROUP BY publication_id', [isoAgo(365)])
  const prints = await byPub('SELECT publication_id AS id, SUM(quantity) AS n FROM physical_sales WHERE sold_at > ? GROUP BY publication_id', [isoAgo(365).slice(0, 10)])
  const team = await byPub('SELECT publication_id AS id, COUNT(*) AS n FROM team_members WHERE COALESCE(is_active,1) = 1 AND left_at IS NULL GROUP BY publication_id', [])
  const ontime = await db.all<{ id: string; n: number; ok: number }>(
    `SELECT i.publication_id AS id, COUNT(*) AS n, SUM(CASE WHEN substr(i.published_at,1,10) <= i.planned_publish_at THEN 1 ELSE 0 END) AS ok
     FROM issues i WHERE ${PUB} AND i.planned_publish_at IS NOT NULL AND i.planned_publish_at <> '' AND i.published_at > ? GROUP BY i.publication_id`,
    [isoAgo(365)]
  )
  const onMap = Object.fromEntries(ontime.map((r) => [r.id, r.n ? Math.round((Number(r.ok) / Number(r.n)) * 100) : 50]))
  const eng = (id: string) => (v90[id] || 0) + 5 * (fol[id] || 0)
  const sal = (id: string) => (codes[id] || 0) + (prints[id] || 0)
  const maxOf = (f: (id: string) => number) => Math.max(1, ...ids.map(f))
  const mE = maxOf(eng), mS = maxOf(sal), mT = maxOf((id) => team[id] || 0)
  const radar = pubs.map((p) => {
    const since = (now - new Date(lastMap[p.id] || p.created_at).getTime()) / DAY
    const reg = Math.max(0, Math.min(1, 1.5 - since / (EXPECTED_DAYS[p.frequency] ?? 120)))
    return {
      id: p.id,
      title: p.title,
      axes: { regularity: Math.round(reg * 100), engagement: Math.round((eng(p.id) / mE) * 100), sales: Math.round((sal(p.id) / mS) * 100), team: Math.round(((team[p.id] || 0) / mT) * 100), ontime: onMap[p.id] ?? 50 }
    }
  })

  // 5) Year over year by academic month (Mehr first) for the current and two previous academic years + subject share
  const tj = jOf(new Date(now).toISOString())
  const acadY = tj.jm >= 7 ? tj.jy : tj.jy - 1
  const acadStart = jalaliToIso(acadY, 7, 1)
  const yoyRows = await db.all<{ d: string }>(`SELECT i.published_at AS d FROM issues i JOIN publications p ON p.id = i.publication_id WHERE ${PUB} AND i.published_at >= ?${s.sql}`, [jalaliToIso(acadY - 2, 7, 1), ...s.params])
  const years = [acadY - 2, acadY - 1, acadY].map((y) => ({ year: y, label: `${y}-${String((y + 1) % 100).padStart(2, '0')}`, months: new Array(12).fill(0) }))
  for (const r of yoyRows) {
    const j = jOf(r.d)
    const y = j.jm >= 7 ? j.jy : j.jy - 1
    const row = years.find((x) => x.year === y)
    if (row) row.months[(j.jm + 5) % 12]++
  }
  let cats = await db.all<{ name: string; n: number }>(
    `SELECT cat.name, COUNT(*) AS n FROM issue_categories ic JOIN categories cat ON cat.id = ic.category_id JOIN issues i ON i.id = ic.issue_id JOIN publications p ON p.id = i.publication_id
     WHERE ${PUB} AND i.published_at >= ?${s.sql} GROUP BY cat.id ORDER BY n DESC LIMIT 12`,
    [acadStart, ...s.params]
  )
  if (!cats.length)
    cats = await db.all(
      `SELECT cat.name, COUNT(*) AS n FROM issues i JOIN publications p ON p.id = i.publication_id JOIN publication_categories pc ON pc.publication_id = p.id JOIN categories cat ON cat.id = pc.category_id
       WHERE ${PUB} AND i.published_at >= ?${s.sql} GROUP BY cat.id ORDER BY n DESC LIMIT 12`,
      [acadStart, ...s.params]
    )

  // 6) Gantt: issues in production (start → planned publish) + official deadlines of the next 120 days
  const gantt = await db.all(
    `SELECT i.id, i.number, i.status, i.created_at, i.planned_publish_at, p.title AS publication_title
     FROM issues i JOIN publications p ON p.id = i.publication_id
     WHERE i.deleted_at IS NULL AND p.deleted_at IS NULL AND i.status IN ('planning','in_production','changes_requested','awaiting_approval')${s.sql}
     ORDER BY COALESCE(i.planned_publish_at, '9999'), i.created_at LIMIT 40`,
    s.params
  )
  const deadlines = await db.all('SELECT id, title, due_at FROM deadlines WHERE due_at BETWEEN ? AND ? ORDER BY due_at LIMIT 20', [isoAgo(7), new Date(now + 120 * DAY).toISOString()])

  // 7) Team composition (ROADMAP phase 14, after phase 15 profiles): active team members by gender, degree, faculty and
  // entry year. Profile fields come from the linked account; gender only counts people who consented (privacy), every
  // other person is reported as «نامشخص». Aggregates only — no individual is exposed.
  const tm = await db.all<{ gender: string | null; degree: string | null; entry_year: number | null; faculty: string | null }>(
    `SELECT CASE WHEN us.profile_consent_at IS NOT NULL THEN us.gender END AS gender, us.degree, us.entry_year,
            COALESCE(fu.name, ft.name) AS faculty
     FROM team_members tm JOIN publications p ON p.id = tm.publication_id
     LEFT JOIN users us ON us.id = tm.user_id AND us.deleted_at IS NULL
     LEFT JOIN faculties fu ON fu.id = us.faculty_id
     LEFT JOIN faculties ft ON ft.id = tm.faculty_id
     WHERE tm.is_active = 1 AND p.deleted_at IS NULL${s.sql}`,
    s.params
  )
  const tally = (pick: (r: (typeof tm)[number]) => string | number | null | undefined) => {
    const m = new Map<string, number>()
    for (const r of tm) {
      const k = pick(r)
      const key = k == null || k === '' ? 'unknown' : String(k)
      m.set(key, (m.get(key) || 0) + 1)
    }
    return [...m.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n)
  }
  const teamMix = {
    total: tm.length,
    linked: tm.filter((r) => r.degree != null || r.entry_year != null || r.gender != null).length,
    gender: tally((r) => r.gender),
    degree: tally((r) => r.degree),
    faculty: tally((r) => r.faculty),
    entry_year: tally((r) => r.entry_year).sort((a, b) => (a.key === 'unknown' ? 1 : b.key === 'unknown' ? -1 : a.key.localeCompare(b.key)))
  }

  return c.json({
    from,
    to,
    heat: Object.entries(heat).map(([d, v]) => ({ d, ...v })).sort((a, b) => a.d.localeCompare(b.d)),
    funnel: {
      counts: { planning: Number(funnel?.planning || 0), production: Number(funnel?.production || 0), awaiting: Number(funnel?.awaiting || 0), published: Number(funnel?.published || 0) },
      avg_days: { planning: r1(steps?.planning), production: r1(steps?.production), awaiting: r1(steps?.awaiting) }
    },
    sunburst: tree,
    radar,
    yoy: { years: years.map(({ label, months }) => ({ label, months })), month_labels: [...JALALI_MONTHS.slice(6), ...JALALI_MONTHS.slice(0, 6)] },
    categories: cats.map((r) => ({ name: r.name, n: Number(r.n) })),
    gantt: { issues: gantt, deadlines },
    team: teamMix
  })
})

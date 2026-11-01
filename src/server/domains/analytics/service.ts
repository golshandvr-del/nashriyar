// Analytics service layer (ROADMAP phase 17 — route files split into domain modules + service layer).
// Pure data access shared by every analytics report: viewer scope (pubScope), rolled-up + raw-tail view counting
// (viewCount / viewSeries / pubViewsSql), KPI blocks and sparklines. No HTTP concerns beyond reading the Context.
import type { Context } from 'hono'
import type { AppEnv } from '../../context'
import { getSetting } from '../../lib/util'

/** Faculty supervisors are restricted to their own faculty. */
export function pubScope(c: Context<AppEnv>, alias = 'p') {
  const u = c.get('user')!
  const q = (k: string) => (c.req.query(k) || '').slice(0, 64)
  let sql = ''
  const params: unknown[] = []
  const add = (frag: string, v: unknown) => {
    sql += frag
    params.push(v)
  }
  if (u.system_role === 'faculty_supervisor') add(` AND ${alias}.faculty_id = ?`, u.scope_faculty_id)
  else if (q('faculty')) add(` AND ${alias}.faculty_id = ?`, q('faculty'))
  // global filters (ROADMAP phase 7), all kept in the URL by the dashboard
  if (q('owner_kind')) add(` AND ${alias}.association_id IN (SELECT id FROM associations WHERE kind = ?)`, q('owner_kind'))
  if (q('association')) add(` AND ${alias}.association_id = ?`, q('association'))
  if (q('publication')) add(` AND ${alias}.id = ?`, q('publication'))
  if (q('category')) add(` AND ${alias}.id IN (SELECT publication_id FROM publication_categories WHERE category_id = ?)`, q('category'))
  // free/paid: publications that publish issues of that pricing model
  if (q('pricing') === 'free' || q('pricing') === 'paid')
    add(` AND ${alias}.id IN (SELECT publication_id FROM issues WHERE pricing = ? AND deleted_at IS NULL)`, q('pricing'))
  return { sql, params }
}

export const DAY = 86400_000
export function previousRange(from: string, to: string) {
  const len = new Date(to).getTime() - new Date(from).getTime() + DAY
  const pTo = new Date(new Date(from).getTime() - DAY).toISOString().slice(0, 10)
  const pFrom = new Date(new Date(from).getTime() - len).toISOString().slice(0, 10)
  return { pFrom, pTo }
}

/**
 * View count over [from, to] (ROADMAP phase 7 rollup): finished days come from view_daily,
 * days after the rollup watermark (today / backlog) from raw view_events. Same scope rules as pubScope.
 */
export async function viewCount(c: Context<AppEnv>, from: string, to: string, type?: string) {
  const db = c.get('db')
  const s = pubScope(c)
  const until = (await getSetting<string | null>(db, 'analytics_rollup_until', null)) || '0000-00-00'
  const t = type ? ' AND v.entity_type = ?' : ''
  const tp = type ? [type] : []
  const rolled = Number(
    (await db.first<{ n: number }>(
      `SELECT COALESCE(SUM(v.n),0) AS n FROM view_daily v JOIN publications p ON p.id = v.publication_id WHERE v.day BETWEEN ? AND ? AND v.day <= ?${t}${s.sql}`,
      [from, to, until, ...tp, ...s.params]
    ))?.n ?? 0
  )
  const raw = Number(
    (await db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM view_events v JOIN publications p ON p.id = v.publication_id WHERE v.day BETWEEN ? AND ? AND v.day > ?${t}${s.sql}`,
      [tailFrom(from, until), to, until, ...tp, ...s.params]
    ))?.n ?? 0
  )
  return rolled + raw
}

/**
 * Effective lower bound of the not-yet-rolled raw tail: max(from, until + 1 day). SQLite picks ONE lower bound for an
 * index range, so `day BETWEEN from AND to AND day > until` would still walk the whole [from, to] range of raw events.
 */
export const tailFrom = (from: string, until: string) => {
  const next = new Date(new Date(until + 'T00:00:00Z').getTime() + 86400_000).toISOString().slice(0, 10)
  return until === '0000-00-00' || from > until ? from : next
}

/** Last day already rolled up into view_daily ('0000-00-00' when none). */
export async function rolledUntil(c: Context<AppEnv>) {
  return (await getSetting<string | null>(c.get('db'), 'analytics_rollup_until', null)) || '0000-00-00'
}

/**
 * Grouped view counts over [from, to] (ROADMAP phase 17, 10-year data): finished days are read from view_daily and only
 * the not-yet-rolled tail from raw view_events, so a one-year chart reads ~365×pubs rows instead of every raw event.
 * `group` is an SQL expression over `v.day` only (same column in both tables). Rows are merged by key and sorted.
 */
export async function viewSeries(c: Context<AppEnv>, from: string, to: string, group: string, type?: string) {
  const db = c.get('db')
  const s = pubScope(c)
  const until = await rolledUntil(c)
  const t = type ? ' AND v.entity_type = ?' : ''
  const tp = type ? [type] : []
  const cols = (n: string) =>
    `${group} AS k, SUM(${n}) AS n, SUM(CASE WHEN v.entity_type = 'issue_read' THEN ${n} ELSE 0 END) AS reads, SUM(CASE WHEN v.entity_type = 'post' THEN ${n} ELSE 0 END) AS post_views`
  type Row = { k: string | number; n: number; reads: number; post_views: number }
  const rolled = await db.all<Row>(
    `SELECT ${cols('v.n')} FROM view_daily v JOIN publications p ON p.id = v.publication_id WHERE v.day BETWEEN ? AND ? AND v.day <= ?${t}${s.sql} GROUP BY k`,
    [from, to, until, ...tp, ...s.params]
  )
  const raw = await db.all<Row>(
    `SELECT ${cols('1')} FROM view_events v JOIN publications p ON p.id = v.publication_id WHERE v.day BETWEEN ? AND ? AND v.day > ?${t}${s.sql} GROUP BY k`,
    [tailFrom(from, until), to, until, ...tp, ...s.params]
  )
  const out = new Map<string, Row>()
  for (const r of [...rolled, ...raw]) {
    const key = String(r.k)
    const o = out.get(key) || { k: r.k, n: 0, reads: 0, post_views: 0 }
    o.n += Number(r.n) || 0
    o.reads += Number(r.reads) || 0
    o.post_views += Number(r.post_views) || 0
    out.set(key, o)
  }
  return [...out.values()].sort((a, b) => (String(a.k) < String(b.k) ? -1 : String(a.k) > String(b.k) ? 1 : 0))
}

/**
 * Correlated "views of publication p over [?, ?]" for per-publication tables (ranking, scorecard, CSV): rolled days
 * from view_daily + raw tail, both index range scans on (publication_id, day). `type` is a fixed literal, never input.
 * Bind with pubViewsParams(from, to, until).
 */
export const pubViewsSql = (type?: 'issue_read' | 'post') => {
  const t = (a: string) => (type ? ` AND ${a}.entity_type = '${type}'` : '')
  return `((SELECT COALESCE(SUM(vd.n),0) FROM view_daily vd WHERE vd.publication_id = p.id${t('vd')} AND vd.day BETWEEN ? AND ? AND vd.day <= ?)
    + (SELECT COUNT(*) FROM view_events ve WHERE ve.publication_id = p.id${t('ve')} AND ve.day BETWEEN ? AND ? AND ve.day > ?))`
}
export const pubViewsParams = (from: string, to: string, until: string) => [from, to, until, tailFrom(from, until), to, until]

export async function kpis(c: Context<AppEnv>, from: string, to: string) {
  const db = c.get('db')
  const s = pubScope(c)
  const fromTs = from + 'T00:00:00.000Z'
  const toTs = to + 'T23:59:59.999Z'
  const one = async (sql: string, params: unknown[]) => Number((await db.first<{ n: number }>(sql, params))?.n ?? 0)
  return {
    published: await one(`SELECT COUNT(*) AS n FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?${s.sql}`, [fromTs, toTs, ...s.params]),
    pages: await one(`SELECT COALESCE(SUM(i.page_count),0) AS n FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?${s.sql}`, [fromTs, toTs, ...s.params]),
    started: await one(`SELECT COUNT(*) AS n FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.deleted_at IS NULL AND i.created_at BETWEEN ? AND ?${s.sql}`, [fromTs, toTs, ...s.params]),
    views: await viewCount(c, from, to),
    reads: await viewCount(c, from, to, 'issue_read'),
    post_views: await viewCount(c, from, to, 'post'),
    new_followers: await one(`SELECT COUNT(*) AS n FROM follows f JOIN publications p ON p.id = f.publication_id WHERE f.created_at BETWEEN ? AND ?${s.sql}`, [fromTs, toTs, ...s.params]),
    digital_sold: await one(`SELECT COUNT(*) AS n FROM access_codes ac JOIN publications p ON p.id = ac.publication_id WHERE ac.redeemed_at BETWEEN ? AND ?${s.sql}`, [fromTs, toTs, ...s.params]),
    revenue_digital: await one(`SELECT COALESCE(SUM(ac.price_paid),0) AS n FROM access_codes ac JOIN publications p ON p.id = ac.publication_id WHERE ac.redeemed_at BETWEEN ? AND ?${s.sql}`, [fromTs, toTs, ...s.params]),
    print_sold: await one(`SELECT COALESCE(SUM(ps.quantity),0) AS n FROM physical_sales ps JOIN publications p ON p.id = ps.publication_id WHERE ps.sold_at BETWEEN ? AND ?${s.sql}`, [from, to, ...s.params]),
    revenue_print: await one(`SELECT COALESCE(SUM(ps.quantity * COALESCE(ps.unit_price,0)),0) AS n FROM physical_sales ps JOIN publications p ON p.id = ps.publication_id WHERE ps.sold_at BETWEEN ? AND ?${s.sql}`, [from, to, ...s.params]),
    comments: await one(`SELECT COUNT(*) AS n FROM comments cm JOIN posts po ON po.id = cm.post_id JOIN publications p ON p.id = po.publication_id WHERE cm.created_at BETWEEN ? AND ? AND cm.is_team_reply = 0${s.sql}`, [fromTs, toTs, ...s.params]),
    posts: await one(`SELECT COUNT(*) AS n FROM posts po JOIN publications p ON p.id = po.publication_id WHERE po.published_at BETWEEN ? AND ?${s.sql}`, [fromTs, toTs, ...s.params]),
    new_students: await one(`SELECT COUNT(*) AS n FROM users WHERE system_role = 'student' AND created_at BETWEEN ? AND ?`, [fromTs, toTs]),
    active_publications: await one(
      `SELECT COUNT(DISTINCT a.publication_id) AS n FROM activity_events a JOIN publications p ON p.id = a.publication_id
       WHERE a.created_at BETWEEN ? AND ? AND a.type IN ('issue.created','toc.status','stage.status','post.published','issue.approval_requested','codes.created')${s.sql}`,
      [fromTs, toTs, ...s.params]
    )
  }
}

/**
 * KPI sparklines (ROADMAP phase 7 overview): each key split into up to 24 equal buckets over [from, to].
 * Uses per-day GROUP BY queries, so cost is one query per key regardless of range length.
 */
export async function sparklines(c: Context<AppEnv>, from: string, to: string) {
  const db = c.get('db')
  const s = pubScope(c)
  const t0 = new Date(from + 'T00:00:00Z').getTime()
  const days = Math.max(1, Math.round((new Date(to + 'T00:00:00Z').getTime() - t0) / DAY) + 1)
  const n = Math.min(24, days)
  const bucket = (day: string) => Math.min(n - 1, Math.floor(((new Date(day.slice(0, 10) + 'T00:00:00Z').getTime() - t0) / DAY) * (n / days)))
  const fill = (rows: { d: string; n: number }[]) => {
    const out = new Array(n).fill(0)
    for (const r of rows) if (r.d) out[bucket(r.d)] += Number(r.n) || 0
    return out
  }
  const fromTs = from + 'T00:00:00.000Z'
  const toTs = to + 'T23:59:59.999Z'
  // rolled-up days + raw tail (ROADMAP phase 17): no full-year scan of raw view_events
  const views = async (type?: string) => (await viewSeries(c, from, to, 'v.day', type)).map((r) => ({ d: String(r.k), n: r.n }))
  return {
    published: fill(await db.all(`SELECT substr(i.published_at,1,10) AS d, COUNT(*) AS n FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?${s.sql} GROUP BY d`, [fromTs, toTs, ...s.params])),
    pages: fill(await db.all(`SELECT substr(i.published_at,1,10) AS d, COALESCE(SUM(i.page_count),0) AS n FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?${s.sql} GROUP BY d`, [fromTs, toTs, ...s.params])),
    views: fill(await views()),
    reads: fill(await views('issue_read')),
    post_views: fill(await views('post')),
    new_followers: fill(await db.all(`SELECT substr(f.created_at,1,10) AS d, COUNT(*) AS n FROM follows f JOIN publications p ON p.id = f.publication_id WHERE f.created_at BETWEEN ? AND ?${s.sql} GROUP BY d`, [fromTs, toTs, ...s.params])),
    digital_sold: fill(await db.all(`SELECT substr(ac.redeemed_at,1,10) AS d, COUNT(*) AS n FROM access_codes ac JOIN publications p ON p.id = ac.publication_id WHERE ac.redeemed_at BETWEEN ? AND ?${s.sql} GROUP BY d`, [fromTs, toTs, ...s.params])),
    revenue_digital: fill(await db.all(`SELECT substr(ac.redeemed_at,1,10) AS d, COALESCE(SUM(ac.price_paid),0) AS n FROM access_codes ac JOIN publications p ON p.id = ac.publication_id WHERE ac.redeemed_at BETWEEN ? AND ?${s.sql} GROUP BY d`, [fromTs, toTs, ...s.params]))
  }
}

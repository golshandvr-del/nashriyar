// Analytics domain module: academic-year dimension + read-only yearly archive (ROADMAP phase 17).
// Mounted by routes/analytics.ts under /api/analytics (role guard, rollup and cache middleware apply from there).
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../../context'
import { nowIso, parseJson } from '../../lib/util'
import { academicYearOf, academicYearRange, academicYears } from '../../../shared/fa'
import { pubViewsParams, pubViewsSql, rolledUntil, viewSeries } from './service'

export const archiveRoutes = new Hono<AppEnv>()

// ── Academic-year dimension + read-only yearly archive (ROADMAP phase 17) ──────────────────────────────────────────
// Every report accepts ?acad=<year> (lib/util.ts → dateRange). Finished years are frozen once into
// academic_year_archive (migration 0014) and served from there forever after: past years never change.
type ArchiveRow = {
  id: string; title: string; faculty_id: string | null; faculty_name: string | null
  published: number; pages: number; views: number; reads: number; post_views: number; posts: number
  new_followers: number; digital_sold: number; revenue: number; print_sold: number; revenue_print: number
}
const ARCHIVE_SUMS = ['published', 'pages', 'views', 'reads', 'post_views', 'posts', 'new_followers', 'digital_sold', 'revenue', 'print_sold', 'revenue_print'] as const
type ArchiveTotals = Record<(typeof ARCHIVE_SUMS)[number] | 'publications_active', number>
const sumRows = (rows: ArchiveRow[]): ArchiveTotals => {
  const t = { publications_active: 0 } as ArchiveTotals
  for (const k of ARCHIVE_SUMS) t[k] = 0
  for (const r of rows) {
    for (const k of ARCHIVE_SUMS) t[k] += Number(r[k]) || 0
    if (r.published || r.posts) t.publications_active++
  }
  return t
}

/** Org-wide per-publication metrics over one academic year (no viewer scope: scope is applied when serving). */
async function archiveSnapshot(c: Context<AppEnv>, year: number) {
  const db = c.get('db')
  const { from, to } = academicYearRange(year)
  const fromTs = from + 'T00:00:00.000Z'
  const toTs = to + 'T23:59:59.999Z'
  const until = await rolledUntil(c)
  const rows = await db.all<ArchiveRow>(
    `SELECT p.id, p.title, p.faculty_id, f.name AS faculty_name,
       (SELECT COUNT(*) FROM issues i WHERE i.publication_id = p.id AND i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?) AS published,
       (SELECT COALESCE(SUM(page_count),0) FROM issues i WHERE i.publication_id = p.id AND i.status IN ('published','archived') AND i.published_at BETWEEN ? AND ?) AS pages,
       ${pubViewsSql()} AS views,
       ${pubViewsSql('issue_read')} AS reads,
       ${pubViewsSql('post')} AS post_views,
       (SELECT COUNT(*) FROM posts po WHERE po.publication_id = p.id AND po.published_at BETWEEN ? AND ?) AS posts,
       (SELECT COUNT(*) FROM follows fo WHERE fo.publication_id = p.id AND fo.created_at BETWEEN ? AND ?) AS new_followers,
       (SELECT COUNT(*) FROM access_codes ac WHERE ac.publication_id = p.id AND ac.redeemed_at BETWEEN ? AND ?) AS digital_sold,
       (SELECT COALESCE(SUM(price_paid),0) FROM access_codes ac WHERE ac.publication_id = p.id AND ac.redeemed_at BETWEEN ? AND ?) AS revenue,
       (SELECT COALESCE(SUM(quantity),0) FROM physical_sales ps WHERE ps.publication_id = p.id AND ps.sold_at BETWEEN ? AND ?) AS print_sold,
       (SELECT COALESCE(SUM(quantity * COALESCE(unit_price,0)),0) FROM physical_sales ps WHERE ps.publication_id = p.id AND ps.sold_at BETWEEN ? AND ?) AS revenue_print
     FROM publications p LEFT JOIN faculties f ON f.id = p.faculty_id WHERE p.created_at <= ?`,
    [fromTs, toTs, fromTs, toTs, ...pubViewsParams(from, to, until), ...pubViewsParams(from, to, until), ...pubViewsParams(from, to, until),
      fromTs, toTs, fromTs, toTs, fromTs, toTs, fromTs, toTs, from, to, from, to, toTs]
  )
  const monthly = (await viewSeries(c, from, to, 'substr(v.day,1,7)')).map((r) => ({ m: String(r.k), views: r.n }))
  const issuesMonthly = await db.all<{ m: string; n: number }>(
    `SELECT substr(published_at,1,7) AS m, COUNT(*) AS n FROM issues WHERE status IN ('published','archived') AND published_at BETWEEN ? AND ? GROUP BY m ORDER BY m`,
    [fromTs, toTs]
  )
  const newStudents = Number((await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE system_role = 'student' AND created_at BETWEEN ? AND ?`, [fromTs, toTs]))?.n ?? 0)
  return { rows: rows.filter((r) => r.published || r.posts || r.views || r.digital_sold || r.print_sold), monthly, issuesMonthly, new_students: newStudents }
}

/** Academic years with data, newest first; finished years say whether they are already frozen in the archive. */
archiveRoutes.get('/academic-years', async (c) => {
  const db = c.get('db')
  const first = await db.first<{ d: string | null }>(`SELECT MIN(created_at) AS d FROM publications`)
  const archived = new Set((await db.all<{ year: number }>(`SELECT year FROM academic_year_archive`)).map((r) => Number(r.year)))
  const years = academicYears(first?.d || nowIso()).map((y) => ({ ...y, archived: archived.has(y.year) }))
  return c.json({ current: academicYearOf(nowIso()), years })
})

/**
 * Read-only archive of a finished academic year. The first request after the year ends freezes the snapshot
 * (INSERT OR IGNORE — concurrent first requests keep a single row); later requests only read it. Faculty supervisors get
 * their faculty's rows and totals only. The current (unfinished) year is refused: use the live reports with ?acad=.
 */
archiveRoutes.get('/archive/:year', async (c) => {
  const db = c.get('db')
  const u = c.get('user')!
  const year = Number(c.req.param('year'))
  if (!Number.isInteger(year) || year < 1380 || year > 1500) return c.json({ error: 'bad_year', message: 'سال تحصیلی نامعتبر است' }, 400)
  const range = academicYearRange(year)
  if (range.to >= nowIso().slice(0, 10)) return c.json({ error: 'not_finished', message: 'این سال تحصیلی هنوز تمام نشده؛ از گزارش‌های زنده با فیلتر سال تحصیلی استفاده کنید' }, 409)
  let row = await db.first<{ data_json: string; created_at: string }>(`SELECT data_json, created_at FROM academic_year_archive WHERE year = ?`, [year])
  if (!row) {
    const snap = await archiveSnapshot(c, year)
    await db.run(
      `INSERT OR IGNORE INTO academic_year_archive (year, from_day, to_day, data_json, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
      [year, range.from, range.to, JSON.stringify(snap), nowIso(), u.id]
    )
    row = await db.first<{ data_json: string; created_at: string }>(`SELECT data_json, created_at FROM academic_year_archive WHERE year = ?`, [year])
  }
  const snap = parseJson<{ rows: ArchiveRow[]; monthly: unknown[]; issuesMonthly: unknown[]; new_students: number }>(row?.data_json, { rows: [], monthly: [], issuesMonthly: [], new_students: 0 })
  const scoped = u.system_role === 'faculty_supervisor'
  const rows = scoped ? snap.rows.filter((r) => r.faculty_id === u.scope_faculty_id) : snap.rows
  const byFaculty = new Map<string, { id: string | null; name: string; rows: ArchiveRow[] }>()
  for (const r of rows) {
    const k = r.faculty_id || ''
    if (!byFaculty.has(k)) byFaculty.set(k, { id: r.faculty_id, name: r.faculty_name || 'بدون دانشکده', rows: [] })
    byFaculty.get(k)!.rows.push(r)
  }
  return c.json({
    ...range,
    archived_at: row?.created_at ?? null,
    read_only: true,
    totals: { ...sumRows(rows), ...(scoped ? {} : { new_students: snap.new_students }) },
    byFaculty: [...byFaculty.values()].map((f) => ({ id: f.id, name: f.name, ...sumRows(f.rows) })).sort((a, b) => b.pages - a.pages),
    rows: [...rows].sort((a, b) => b.pages - a.pages || b.views - a.views),
    monthly: scoped ? [] : snap.monthly,
    issuesMonthly: scoped ? [] : snap.issuesMonthly
  })
})

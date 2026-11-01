// Analytics domain module: CSV export of the ranking (UTF-8 BOM).
// Mounted by routes/analytics.ts (ROADMAP phase 17 split; parent middleware applies).
import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { dateRange } from '../../lib/util'
import { pubScope, pubViewsParams, pubViewsSql, rolledUntil } from './service'

export const exportRoutes = new Hono<AppEnv>()

/** CSV export of the ranking (opened in Excel; UTF-8 BOM for Persian). */
exportRoutes.get('/export/ranking.csv', async (c) => {
  const db = c.get('db')
  const s = pubScope(c)
  const { from, to } = dateRange(c, 365)
  const rows = await db.all<any>(
    `SELECT p.title, f.name AS faculty, (SELECT COUNT(*) FROM issues i WHERE i.publication_id = p.id AND i.status IN ('published','archived') AND substr(i.published_at,1,10) BETWEEN ? AND ?) AS published,
       ${pubViewsSql()} AS views,
       (SELECT COUNT(*) FROM follows fo WHERE fo.publication_id = p.id AND fo.unfollowed_at IS NULL) AS followers,
       (SELECT COUNT(*) FROM access_codes ac WHERE ac.publication_id = p.id AND substr(ac.redeemed_at,1,10) BETWEEN ? AND ?) AS digital_sold
     FROM publications p LEFT JOIN faculties f ON f.id = p.faculty_id WHERE p.deleted_at IS NULL${s.sql} ORDER BY published DESC`,
    [from, to, ...pubViewsParams(from, to, await rolledUntil(c)), from, to, ...s.params]
  )
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = '\uFEFF' + ['نشریه,دانشکده,شماره‌های منتشرشده,بازدید,دنبال‌کننده,فروش دیجیتال', ...rows.map((r) => [r.title, r.faculty, r.published, r.views, r.followers, r.digital_sold].map(esc).join(','))].join('\r\n')
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ranking-${from}-${to}.csv"` } })
})

// Rule-based insight engine (Phase 8). Deterministic, explainable, no AI required.
import type { Db } from './adapters/db'

export interface Insight {
  key: string
  severity: 'critical' | 'warning' | 'info' | 'positive'
  title: string
  detail: string
  publication_id?: string
  link?: string
}

const DAY = 86400_000
const EXPECTED: Record<string, number> = { monthly: 30, bimonthly: 60, quarterly: 90, biannual: 180, irregular: 120 }

export async function computeInsights(db: Db, scope: { sql: string; params: unknown[] }): Promise<Insight[]> {
  const out: Insight[] = []
  const now = Date.now()
  const today = new Date().toISOString().slice(0, 10)
  const pubs = await db.all<any>(
    `SELECT p.id, p.title, p.frequency, p.license_expires_at, p.created_at,
       (SELECT MAX(published_at) FROM issues i WHERE i.publication_id = p.id AND i.status IN ('published','archived')) AS last_pub,
       (SELECT MAX(created_at) FROM activity_events a WHERE a.publication_id = p.id AND a.type IN ('issue.created','toc.status','stage.status','post.published','codes.created','member.added')) AS last_act
     FROM publications p WHERE p.deleted_at IS NULL AND p.status = 'active'${scope.sql}`,
    scope.params
  )
  for (const p of pubs) {
    // 1. Publishing overdue vs declared frequency
    const exp = EXPECTED[p.frequency] ?? 120
    const ref = p.last_pub || p.created_at
    const since = Math.round((now - new Date(ref).getTime()) / DAY)
    if (since > exp * 1.5) out.push({ key: `overdue:${p.id}`, severity: since > exp * 2.5 ? 'critical' : 'warning', title: `${p.title}: ${since} روز بدون انتشار`, detail: `دورهٔ اعلامی حدود ${exp} روز است. ${p.last_pub ? 'آخرین انتشار' : 'از زمان ثبت نشریه'} ${since} روز گذشته است.`, publication_id: p.id, link: `/admin/publications/${p.id}` })
    // 2. Team inactivity
    const act = p.last_act ? Math.round((now - new Date(p.last_act).getTime()) / DAY) : null
    if (act == null || act > 45) out.push({ key: `inactive:${p.id}`, severity: 'warning', title: `${p.title}: تیم غیرفعال`, detail: act == null ? 'هیچ فعالیتی از تیم ثبت نشده است.' : `آخرین فعالیت تیم ${act} روز پیش بوده است.`, publication_id: p.id, link: `/admin/publications/${p.id}` })
    // 3. License expiry
    if (p.license_expires_at) {
      const left = Math.round((new Date(p.license_expires_at).getTime() - now) / DAY)
      if (left < 0) out.push({ key: `license_expired:${p.id}`, severity: 'critical', title: `${p.title}: مجوز منقضی شده`, detail: `مجوز انتشار ${-left} روز پیش منقضی شده است.`, publication_id: p.id, link: `/admin/publications/${p.id}` })
      else if (left < 60) out.push({ key: `license_soon:${p.id}`, severity: 'warning', title: `${p.title}: مجوز رو به اتمام`, detail: `${left} روز تا پایان اعتبار مجوز باقی است.`, publication_id: p.id, link: `/admin/publications/${p.id}` })
    }
  }
  // 4. Stuck issues: in production, no progress in 21 days
  const stuck = await db.all<any>(
    `SELECT i.id, i.number, i.title, p.title AS pt, p.id AS pid, (SELECT MAX(created_at) FROM stage_events se WHERE se.issue_id = i.id) AS last_ev, i.created_at
     FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.deleted_at IS NULL AND i.status IN ('planning','in_production','changes_requested')${scope.sql}`,
    scope.params
  )
  for (const s of stuck) {
    const d = Math.round((now - new Date(s.last_ev || s.created_at).getTime()) / DAY)
    if (d > 21) out.push({ key: `stuck:${s.id}`, severity: d > 45 ? 'critical' : 'warning', title: `${s.pt} — شمارهٔ ${s.number}: توقف تولید`, detail: `${d} روز است که هیچ پیشرفتی در «${s.title}» ثبت نشده است.`, publication_id: s.pid, link: `/admin/issues/${s.id}` })
  }
  // 5. Overdue deadlines on stages
  const late = await db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM issue_stages st JOIN issues i ON i.id = st.issue_id JOIN publications p ON p.id = i.publication_id
     WHERE st.status NOT IN ('done','skipped') AND st.due_at IS NOT NULL AND st.due_at < ? AND i.status NOT IN ('published','archived') AND i.deleted_at IS NULL${scope.sql}`,
    [today, ...scope.params]
  )
  if ((late?.n ?? 0) > 0) out.push({ key: `late_stages:${today.slice(0, 7)}`, severity: 'info', title: `${late!.n} مرحلهٔ تولید از مهلت گذشته است`, detail: 'جزئیات در برد زنده و پروندهٔ هر نشریه قابل مشاهده است.', link: '/admin/live' })
  // 6. Approvals waiting > 3 days
  const waiting = await db.all<any>(
    `SELECT i.id, i.number, p.title AS pt, a.requested_at FROM issue_approvals a JOIN issues i ON i.id = a.issue_id JOIN publications p ON p.id = i.publication_id
     WHERE a.decided_at IS NULL AND i.status = 'awaiting_approval'${scope.sql}`,
    scope.params
  )
  for (const w of waiting) {
    const d = Math.round((now - new Date(w.requested_at).getTime()) / DAY)
    if (d >= 3) out.push({ key: `approval_wait:${w.id}`, severity: 'warning', title: `تأیید انتشار ${w.pt} — شمارهٔ ${w.number} معطل مانده`, detail: `${d} روز از درخواست تأیید گذشته است.`, link: '/admin/approvals' })
  }
  // 7. Pending comments piling up
  const pend = await db.all<any>(
    `SELECT p.id, p.title, COUNT(*) AS n, MIN(cm.created_at) AS oldest FROM comments cm JOIN posts po ON po.id = cm.post_id JOIN publications p ON p.id = po.publication_id
     WHERE cm.status = 'pending'${scope.sql} GROUP BY p.id HAVING n >= 5`,
    scope.params
  )
  for (const r of pend) out.push({ key: `comments:${r.id}`, severity: 'info', title: `${r.title}: ${r.n} نظر در انتظار بررسی`, detail: `قدیمی‌ترین نظر از ${Math.round((now - new Date(r.oldest).getTime()) / DAY)} روز پیش منتظر است.`, publication_id: r.id })
  // 8. Positive: view growth > 50% month over month
  const m1 = new Date(now - 30 * DAY).toISOString().slice(0, 10)
  const m2 = new Date(now - 60 * DAY).toISOString().slice(0, 10)
  const growth = await db.all<any>(
    `SELECT p.id, p.title, SUM(CASE WHEN v.day >= ? THEN 1 ELSE 0 END) AS cur, SUM(CASE WHEN v.day < ? AND v.day >= ? THEN 1 ELSE 0 END) AS prev
     FROM view_events v JOIN publications p ON p.id = v.publication_id WHERE v.day >= ?${scope.sql} GROUP BY p.id`,
    [m1, m1, m2, m2, ...scope.params]
  )
  for (const g of growth) {
    if (g.prev >= 20 && g.cur > g.prev * 1.5) out.push({ key: `growth:${g.id}:${today.slice(0, 7)}`, severity: 'positive', title: `${g.title}: رشد ${Math.round((g.cur / g.prev - 1) * 100)}٪ بازدید`, detail: `بازدید ۳۰ روز اخیر ${g.cur} در برابر ${g.prev} در ۳۰ روز قبل.`, publication_id: g.id })
    else if (g.prev >= 30 && g.cur < g.prev * 0.5) out.push({ key: `drop:${g.id}:${today.slice(0, 7)}`, severity: 'warning', title: `${g.title}: افت ${Math.round((1 - g.cur / g.prev) * 100)}٪ بازدید`, detail: `بازدید ۳۰ روز اخیر ${g.cur} در برابر ${g.prev} در ۳۰ روز قبل.`, publication_id: g.id })
  }
  // 9. Codes expiring unused (lost sales)
  const expired = await db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM access_codes ac JOIN publications p ON p.id = ac.publication_id WHERE ac.redeemed_at IS NULL AND ac.revoked_at IS NULL AND ac.expires_at < ? AND ac.expires_at > ?${scope.sql}`,
    [new Date().toISOString(), new Date(now - 30 * DAY).toISOString(), ...scope.params]
  )
  if ((expired?.n ?? 0) >= 5) out.push({ key: `codes_expired:${today.slice(0, 7)}`, severity: 'info', title: `${expired!.n} کد خرید بدون استفاده منقضی شد`, detail: 'خریداران ممکن است در ثبت کد مشکل داشته باشند؛ راهنمای ثبت کد را به تیم‌ها یادآوری کنید.' })

  const dismissed = new Set((await db.all<{ insight_key: string }>('SELECT insight_key FROM insight_dismissals')).map((r) => r.insight_key))
  const order = { critical: 0, warning: 1, info: 2, positive: 3 }
  return out.filter((i) => !dismissed.has(i.key)).sort((a, b) => order[a.severity] - order[b.severity])
}

/**
 * Health score 0..100 per publication — transparent weighted formula:
 * regularity 35, production activity 25, audience 20, explore activity 10, moderation hygiene 10.
 */
export async function healthScores(db: Db, ids: string[]): Promise<Record<string, { score: number; parts: Record<string, number> }>> {
  const out: Record<string, { score: number; parts: Record<string, number> }> = {}
  const now = Date.now()
  const d90 = new Date(now - 90 * DAY).toISOString()
  for (const id of ids) {
    const p = await db.first<any>('SELECT frequency, created_at FROM publications WHERE id = ?', [id])
    if (!p) continue
    const last = await db.first<{ d: string }>("SELECT MAX(published_at) AS d FROM issues WHERE publication_id = ? AND status IN ('published','archived')", [id])
    const exp = EXPECTED[p.frequency] ?? 120
    const since = (now - new Date(last?.d || p.created_at).getTime()) / DAY
    const regularity = Math.max(0, Math.min(1, 1.5 - since / exp)) * 35
    const acts = (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM activity_events WHERE publication_id = ? AND created_at > ? AND type IN ('toc.status','stage.status','issue.created','member.added')", [id, d90]))?.n ?? 0
    const activity = Math.min(1, acts / 30) * 25
    const views = (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM view_events WHERE publication_id = ? AND day > ?', [id, d90.slice(0, 10)]))?.n ?? 0
    const audience = Math.min(1, views / 300) * 20
    const posts = (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM posts WHERE publication_id = ? AND published_at > ? AND status = 'published'", [id, d90]))?.n ?? 0
    const explore = Math.min(1, posts / 6) * 10
    const pending = (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM comments cm JOIN posts po ON po.id = cm.post_id WHERE po.publication_id = ? AND cm.status = 'pending' AND cm.created_at < ?", [id, new Date(now - 7 * DAY).toISOString()]))?.n ?? 0
    const hygiene = Math.max(0, 1 - pending / 10) * 10
    const parts = { regularity, activity, audience, explore, hygiene }
    out[id] = { score: Math.round(regularity + activity + audience + explore + hygiene), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v)])) }
  }
  return out
}

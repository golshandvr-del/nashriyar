// Rule-based insight engine (Phase 8). Deterministic, explainable, no AI required.
import type { Db } from './adapters/db'
import { getSetting } from './lib/util'

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

/** Rule thresholds (editable by the officer in admin settings; stored in settings.insight_thresholds). */
export const DEFAULT_THRESHOLDS = {
  overdue_factor: 1.5, // warn when days since last issue > declared period × factor
  inactive_days: 45,
  license_warn_days: 60,
  stuck_days: 21,
  approval_wait_days: 3,
  pending_comments: 5,
  growth_pct: 50,
  drop_pct: 50,
  expired_codes: 5,
  slow_stage_factor: 2, // stage in progress longer than factor × the median of the same stage elsewhere
  irregular_cv: 0.6, // coefficient of variation of publishing gaps above which a publication is "irregular"
  team_shrink: 2, // members who left in the last 60 days
  bot_views: 60, // views from one viewer on one day considered bot-like
  director_effect_days: 90 // look-back window for the managing-director change effect
}
export type Thresholds = typeof DEFAULT_THRESHOLDS
/** Health score weights (settings.health_weights); the score is normalised to 0..100 whatever the total. */
export const DEFAULT_WEIGHTS = { regularity: 35, activity: 25, audience: 20, explore: 10, hygiene: 10 }
export type Weights = typeof DEFAULT_WEIGHTS

function merge<T extends Record<string, number>>(def: T, raw: unknown, min: number, max: number): T {
  const out = { ...def }
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(def) as (keyof T)[]) {
      const v = Number((raw as any)[k])
      if (Number.isFinite(v)) (out as any)[k] = Math.min(max, Math.max(min, v))
    }
  }
  return out
}
export const sanitizeThresholds = (raw: unknown) => merge(DEFAULT_THRESHOLDS, raw, 0, 3650)
export const sanitizeWeights = (raw: unknown) => merge(DEFAULT_WEIGHTS, raw, 0, 100)
export async function getThresholds(db: Db): Promise<Thresholds> {
  return sanitizeThresholds(await getSetting(db, 'insight_thresholds', null))
}
export async function getWeights(db: Db): Promise<Weights> {
  return sanitizeWeights(await getSetting(db, 'health_weights', null))
}

export async function computeInsights(db: Db, scope: { sql: string; params: unknown[] }): Promise<Insight[]> {
  const out: Insight[] = []
  const t = await getThresholds(db)
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
    if (since > exp * t.overdue_factor) out.push({ key: `overdue:${p.id}`, severity: since > exp * 2.5 ? 'critical' : 'warning', title: `${p.title}: ${since} روز بدون انتشار`, detail: `دورهٔ اعلامی حدود ${exp} روز است. ${p.last_pub ? 'آخرین انتشار' : 'از زمان ثبت نشریه'} ${since} روز گذشته است.`, publication_id: p.id, link: `/admin/publications/${p.id}` })
    // 2. Team inactivity
    const act = p.last_act ? Math.round((now - new Date(p.last_act).getTime()) / DAY) : null
    if (act == null || act > t.inactive_days) out.push({ key: `inactive:${p.id}`, severity: 'warning', title: `${p.title}: تیم غیرفعال`, detail: act == null ? 'هیچ فعالیتی از تیم ثبت نشده است.' : `آخرین فعالیت تیم ${act} روز پیش بوده است.`, publication_id: p.id, link: `/admin/publications/${p.id}` })
    // 3. License expiry
    if (p.license_expires_at) {
      const left = Math.round((new Date(p.license_expires_at).getTime() - now) / DAY)
      if (left < 0) out.push({ key: `license_expired:${p.id}`, severity: 'critical', title: `${p.title}: مجوز منقضی شده`, detail: `مجوز انتشار ${-left} روز پیش منقضی شده است.`, publication_id: p.id, link: `/admin/publications/${p.id}` })
      else if (left < t.license_warn_days) out.push({ key: `license_soon:${p.id}`, severity: 'warning', title: `${p.title}: مجوز رو به اتمام`, detail: `${left} روز تا پایان اعتبار مجوز باقی است.`, publication_id: p.id, link: `/admin/publications/${p.id}` })
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
    if (d > t.stuck_days) out.push({ key: `stuck:${s.id}`, severity: d > 45 ? 'critical' : 'warning', title: `${s.pt} — شمارهٔ ${s.number}: توقف تولید`, detail: `${d} روز است که هیچ پیشرفتی در «${s.title}» ثبت نشده است.`, publication_id: s.pid, link: `/admin/issues/${s.id}` })
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
    if (d >= t.approval_wait_days) out.push({ key: `approval_wait:${w.id}`, severity: 'warning', title: `تأیید انتشار ${w.pt} — شمارهٔ ${w.number} معطل مانده`, detail: `${d} روز از درخواست تأیید گذشته است.`, link: '/admin/approvals' })
  }
  // 7. Pending comments piling up
  const pend = await db.all<any>(
    `SELECT p.id, p.title, COUNT(*) AS n, MIN(cm.created_at) AS oldest FROM comments cm JOIN posts po ON po.id = cm.post_id JOIN publications p ON p.id = po.publication_id
     WHERE cm.status = 'pending'${scope.sql} GROUP BY p.id HAVING n >= ?`,
    [...scope.params, t.pending_comments]
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
    if (g.prev >= 20 && g.cur > g.prev * (1 + t.growth_pct / 100)) out.push({ key: `growth:${g.id}:${today.slice(0, 7)}`, severity: 'positive', title: `${g.title}: رشد ${Math.round((g.cur / g.prev - 1) * 100)}٪ بازدید`, detail: `بازدید ۳۰ روز اخیر ${g.cur} در برابر ${g.prev} در ۳۰ روز قبل.`, publication_id: g.id })
    else if (g.prev >= 30 && g.cur < g.prev * (1 - t.drop_pct / 100)) out.push({ key: `drop:${g.id}:${today.slice(0, 7)}`, severity: 'warning', title: `${g.title}: افت ${Math.round((1 - g.cur / g.prev) * 100)}٪ بازدید`, detail: `بازدید ۳۰ روز اخیر ${g.cur} در برابر ${g.prev} در ۳۰ روز قبل.`, publication_id: g.id })
  }
  // 9. Codes expiring unused (lost sales)
  const expired = await db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM access_codes ac JOIN publications p ON p.id = ac.publication_id WHERE ac.redeemed_at IS NULL AND ac.revoked_at IS NULL AND ac.expires_at < ? AND ac.expires_at > ?${scope.sql}`,
    [new Date().toISOString(), new Date(now - 30 * DAY).toISOString(), ...scope.params]
  )
  if ((expired?.n ?? 0) >= t.expired_codes) out.push({ key: `codes_expired:${today.slice(0, 7)}`, severity: 'info', title: `${expired!.n} کد خرید بدون استفاده منقضی شد`, detail: 'خریداران ممکن است در ثبت کد مشکل داشته باشند؛ راهنمای ثبت کد را به تیم‌ها یادآوری کنید.' })

  // 10. Abnormally long stage: in progress > factor × median duration of the same stage key (needs >= 3 samples)
  const doneStages = await db.all<{ key: string; d: number }>(
    `SELECT key, julianday(completed_at) - julianday(started_at) AS d FROM issue_stages WHERE status = 'done' AND started_at IS NOT NULL AND completed_at IS NOT NULL`
  )
  const byKey: Record<string, number[]> = {}
  for (const r of doneStages) (byKey[r.key] ||= []).push(r.d)
  const med = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2 }
  const running = await db.all<any>(
    `SELECT st.id, st.key, st.title, st.started_at, i.number, p.id AS pid, p.title AS pt FROM issue_stages st JOIN issues i ON i.id = st.issue_id JOIN publications p ON p.id = i.publication_id
     WHERE st.status = 'in_progress' AND st.started_at IS NOT NULL AND i.deleted_at IS NULL AND p.deleted_at IS NULL${scope.sql}`,
    scope.params
  )
  for (const r of running) {
    const xs = byKey[r.key]
    if (!xs || xs.length < 3) continue
    const m = Math.max(1, med(xs))
    const d = (now - new Date(r.started_at).getTime()) / DAY
    if (d > m * t.slow_stage_factor && d > 7) out.push({ key: `slow_stage:${r.id}`, severity: 'warning', title: `${r.pt} — شمارهٔ ${r.number}: مرحلهٔ «${r.title}» غیرعادی طولانی شده`, detail: `${Math.round(d)} روز در این مرحله؛ میانهٔ همین مرحله در سایر شماره‌ها ${Math.round(m)} روز است.`, publication_id: r.pid, link: `/admin/publications/${r.pid}` })
  }
  // 11. Irregular publishing gaps (coefficient of variation) — needs >= 3 gaps
  const pubDates = await db.all<{ pid: string; title: string; d: string }>(
    `SELECT p.id AS pid, p.title, i.published_at AS d FROM issues i JOIN publications p ON p.id = i.publication_id
     WHERE i.status IN ('published','archived') AND i.published_at IS NOT NULL AND p.deleted_at IS NULL AND p.status = 'active'${scope.sql} ORDER BY p.id, i.published_at`,
    scope.params
  )
  const datesBy = new Map<string, { title: string; ds: number[] }>()
  for (const r of pubDates) { const e = datesBy.get(r.pid) || { title: r.title, ds: [] }; e.ds.push(new Date(r.d).getTime()); datesBy.set(r.pid, e) }
  for (const [pid, e] of datesBy) {
    const gaps = e.ds.slice(1).map((x, k) => (x - e.ds[k]) / DAY)
    if (gaps.length < 3) continue
    const m = gaps.reduce((a, b) => a + b, 0) / gaps.length
    const cv = m ? Math.sqrt(gaps.reduce((a, b) => a + (b - m) ** 2, 0) / gaps.length) / m : 0
    if (cv > t.irregular_cv) out.push({ key: `irregular:${pid}`, severity: 'info', title: `${e.title}: فاصلهٔ انتشار نامنظم`, detail: `ضریب تغییرات فاصلهٔ شماره‌ها ${cv.toFixed(2)} است (فاصله‌ها بین ${Math.round(Math.min(...gaps))} تا ${Math.round(Math.max(...gaps))} روز).`, publication_id: pid, link: '/admin/analytics?tab=gaps' })
  }
  // 12. Managing-director change effect: director changed recently and nothing has been published since
  const dirChanges = await db.all<any>(
    `SELECT r.publication_id AS pid, p.title, r.started_at,
       (SELECT COUNT(*) FROM issues i WHERE i.publication_id = r.publication_id AND i.status IN ('published','archived') AND i.published_at > r.started_at) AS after
     FROM publication_roles r JOIN publications p ON p.id = r.publication_id
     WHERE r.role = 'managing_director' AND r.ended_at IS NULL AND r.started_at > ? AND p.deleted_at IS NULL${scope.sql}
       AND EXISTS (SELECT 1 FROM publication_roles r2 WHERE r2.publication_id = r.publication_id AND r2.role = 'managing_director' AND r2.ended_at IS NOT NULL)`,
    [new Date(now - t.director_effect_days * DAY).toISOString(), ...scope.params]
  )
  for (const r of dirChanges) {
    const d = Math.round((now - new Date(r.started_at).getTime()) / DAY)
    out.push({ key: `director_change:${r.pid}:${String(r.started_at).slice(0, 10)}`, severity: r.after ? 'info' : 'warning', title: `${r.title}: تغییر مدیرمسئول ${d} روز پیش`, detail: r.after ? `از زمان تغییر ${r.after} شماره منتشر شده است.` : 'از زمان تغییر مدیرمسئول هنوز شماره‌ای منتشر نشده؛ دورهٔ گذار را پیگیری کنید.', publication_id: r.pid, link: `/admin/publications/${r.pid}` })
  }
  // 13. Team shrinking: >= N members left in the last 60 days
  const shrink = await db.all<any>(
    `SELECT p.id, p.title, SUM(CASE WHEN tm.left_at > ? THEN 1 ELSE 0 END) AS left_n, SUM(CASE WHEN tm.is_active = 1 AND tm.left_at IS NULL THEN 1 ELSE 0 END) AS active_n
     FROM team_members tm JOIN publications p ON p.id = tm.publication_id WHERE p.deleted_at IS NULL${scope.sql} GROUP BY p.id HAVING left_n >= ?`,
    [new Date(now - 60 * DAY).toISOString(), ...scope.params, t.team_shrink]
  )
  for (const r of shrink) out.push({ key: `team_shrink:${r.id}:${today.slice(0, 7)}`, severity: 'warning', title: `${r.title}: کوچک شدن تیم`, detail: `${r.left_n} عضو در ۶۰ روز اخیر تیم را ترک کرده‌اند؛ ${r.active_n} عضو فعال باقی است.`, publication_id: r.id, link: `/admin/publications/${r.id}` })
  // 14. Bot-like views: a single viewer with many views on one day (last 7 days)
  const bots = await db.all<any>(
    `SELECT p.id, p.title, v.day, v.viewer_hash, COUNT(*) AS n FROM view_events v JOIN publications p ON p.id = v.publication_id
     WHERE v.day >= ? AND v.viewer_hash IS NOT NULL${scope.sql} GROUP BY p.id, v.day, v.viewer_hash HAVING n >= ? ORDER BY n DESC LIMIT 10`,
    [new Date(now - 7 * DAY).toISOString().slice(0, 10), ...scope.params, t.bot_views]
  )
  for (const b of bots) out.push({ key: `bot_views:${b.id}:${b.day}`, severity: 'info', title: `${b.title}: بازدید مشکوک به ربات`, detail: `${b.n} بازدید از یک بازدیدکننده در یک روز (${b.day}). این بازدیدها ممکن است آمار را متورم کنند.`, publication_id: b.id, link: '/admin/analytics?tab=explore' })
  // 15. Faculties without any active publication (only meaningful for unscoped / officer views)
  if (!scope.sql) {
    const empty = await db.all<{ id: string; name: string }>(
      `SELECT f.id, f.name FROM faculties f WHERE f.is_active = 1 AND NOT EXISTS (SELECT 1 FROM publications p WHERE p.faculty_id = f.id AND p.status = 'active' AND p.deleted_at IS NULL)`
    )
    for (const f of empty) out.push({ key: `faculty_empty:${f.id}`, severity: 'info', title: `دانشکدهٔ ${f.name} نشریهٔ فعالی ندارد`, detail: 'فرصتی برای حمایت از راه‌اندازی نشریهٔ جدید در این دانشکده.', link: '/admin/structure' })
  }

  const dismissed = new Set((await db.all<{ insight_key: string }>('SELECT insight_key FROM insight_dismissals')).map((r) => r.insight_key))
  const order = { critical: 0, warning: 1, info: 2, positive: 3 }
  return out.filter((i) => !dismissed.has(i.key)).sort((a, b) => order[a.severity] - order[b.severity])
}

/**
 * Health score 0..100 per publication — transparent weighted formula:
 * regularity 35, production activity 25, audience 20, explore activity 10, moderation hygiene 10.
 */
export type Health = { score: number; level: 'green' | 'yellow' | 'red'; parts: Record<string, number>; reasons: string[] }

/** Pure: traffic-light level + human reasons from the raw 0..1 ratios of each part (ROADMAP phase 8). */
export function healthVerdict(score: number, ratios: Record<string, number>, facts: { since: number; exp: number; acts: number; views: number; posts: number; pending: number }): Pick<Health, 'level' | 'reasons'> {
  const level = score >= 70 ? 'green' : score >= 40 ? 'yellow' : 'red'
  const reasons: string[] = []
  if (ratios.regularity < 0.5) reasons.push(`${Math.round(facts.since)} روز از آخرین انتشار گذشته (دورهٔ اعلامی حدود ${facts.exp} روز)`)
  if (ratios.activity < 0.5) reasons.push(`فعالیت تولید کم در ۹۰ روز اخیر (${facts.acts} رویداد)`)
  if (ratios.audience < 0.5) reasons.push(`بازدید کم در ۹۰ روز اخیر (${facts.views} بازدید)`)
  if (ratios.explore < 0.5) reasons.push(`پست اکسپلور کم در ۹۰ روز اخیر (${facts.posts} پست)`)
  if (ratios.hygiene < 0.5) reasons.push(`${facts.pending} نظر بررسی‌نشدهٔ قدیمی‌تر از یک هفته`)
  if (!reasons.length) reasons.push(level === 'green' ? 'همهٔ اجزا در وضعیت مطلوب‌اند' : 'هیچ جزئی بحرانی نیست ولی مجموع امتیاز متوسط است')
  return { level, reasons }
}

export async function healthScores(db: Db, ids: string[]): Promise<Record<string, Health>> {
  const out: Record<string, Health> = {}
  const w = await getWeights(db)
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1
  const now = Date.now()
  const d90 = new Date(now - 90 * DAY).toISOString()
  for (const id of ids) {
    const p = await db.first<any>('SELECT frequency, created_at FROM publications WHERE id = ?', [id])
    if (!p) continue
    const last = await db.first<{ d: string }>("SELECT MAX(published_at) AS d FROM issues WHERE publication_id = ? AND status IN ('published','archived')", [id])
    const exp = EXPECTED[p.frequency] ?? 120
    const since = (now - new Date(last?.d || p.created_at).getTime()) / DAY
    const rReg = Math.max(0, Math.min(1, 1.5 - since / exp))
    const regularity = rReg * w.regularity
    const acts = (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM activity_events WHERE publication_id = ? AND created_at > ? AND type IN ('toc.status','stage.status','issue.created','member.added')", [id, d90]))?.n ?? 0
    const activity = Math.min(1, acts / 30) * w.activity
    const views = (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM view_events WHERE publication_id = ? AND day > ?', [id, d90.slice(0, 10)]))?.n ?? 0
    const audience = Math.min(1, views / 300) * w.audience
    const posts = (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM posts WHERE publication_id = ? AND published_at > ? AND status = 'published'", [id, d90]))?.n ?? 0
    const explore = Math.min(1, posts / 6) * w.explore
    const pending = (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM comments cm JOIN posts po ON po.id = cm.post_id WHERE po.publication_id = ? AND cm.status = 'pending' AND cm.created_at < ?", [id, new Date(now - 7 * DAY).toISOString()]))?.n ?? 0
    const hygiene = Math.max(0, 1 - pending / 10) * w.hygiene
    const parts = { regularity, activity, audience, explore, hygiene }
    const score = Math.round(((regularity + activity + audience + explore + hygiene) * 100) / total)
    const ratios = { regularity: rReg, activity: Math.min(1, acts / 30), audience: Math.min(1, views / 300), explore: Math.min(1, posts / 6), hygiene: Math.max(0, 1 - pending / 10) }
    out[id] = { score, parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v)])), ...healthVerdict(score, ratios, { since, exp, acts, views, posts, pending }) }
  }
  return out
}

// Root-cause analysis for an insight (ROADMAP phase 10).
// Step 1 (always, deterministic): gather aggregated evidence about the insight's publication.
// Step 2 (always): rule-based hypotheses derived from that evidence — explainable, no AI needed.
// Step 3 (optional): the AI provider may add hypotheses, always labelled «پیشنهاد هوش مصنوعی».
// Evidence is aggregated counts/dates only — never names or student numbers.
import type { Db } from '../adapters/db'

const DAY = 86400_000

export interface Evidence {
  publication_id: string
  title: string
  frequency: string
  days_since_last_issue: number | null
  issues_last_180: number
  members_active: number
  members_joined_90: number
  members_left_90: number
  director_changed_90: boolean
  days_since_director_change: number | null
  open_issues: number
  stuck_items: number
  last_activity_days: number | null
  posts_30: number
  posts_prev_30: number
  views_30: number
  views_prev_30: number
  pending_comments: number
  license_days_left: number | null
}

export interface Hypothesis {
  text: string
  source: 'rule' | 'ai'
}

const daysSince = (iso: string | null | undefined, now: number) => (iso ? Math.max(0, Math.round((now - new Date(iso).getTime()) / DAY)) : null)

export async function gatherEvidence(db: Db, pubId: string, nowMs = Date.now()): Promise<Evidence | null> {
  const p = await db.first<any>('SELECT id, title, frequency, license_expires_at FROM publications WHERE id = ? AND deleted_at IS NULL', [pubId])
  if (!p) return null
  const iso = (d: number) => new Date(nowMs - d * DAY).toISOString()
  const day = (d: number) => iso(d).slice(0, 10)
  const n = async (sql: string, params: unknown[]) => Number((await db.first<{ n: number }>(sql, params))?.n ?? 0)
  const lastIssue = await db.first<{ t: string | null }>("SELECT MAX(published_at) AS t FROM issues WHERE publication_id = ? AND status IN ('published','archived') AND deleted_at IS NULL", [pubId])
  const director = await db.first<{ t: string | null }>("SELECT MAX(started_at) AS t FROM publication_roles WHERE publication_id = ? AND role = 'director'", [pubId])
  const lastAct = await db.first<{ t: string | null }>('SELECT MAX(created_at) AS t FROM activity_events WHERE publication_id = ?', [pubId])
  const dirDays = daysSince(director?.t, nowMs)
  return {
    publication_id: p.id,
    title: p.title,
    frequency: p.frequency,
    days_since_last_issue: daysSince(lastIssue?.t, nowMs),
    issues_last_180: await n("SELECT COUNT(*) AS n FROM issues WHERE publication_id = ? AND status IN ('published','archived') AND deleted_at IS NULL AND published_at >= ?", [pubId, iso(180)]),
    members_active: await n('SELECT COUNT(*) AS n FROM team_members WHERE publication_id = ? AND is_active = 1', [pubId]),
    members_joined_90: await n('SELECT COUNT(*) AS n FROM team_members WHERE publication_id = ? AND joined_at >= ?', [pubId, day(90)]),
    members_left_90: await n('SELECT COUNT(*) AS n FROM team_members WHERE publication_id = ? AND left_at IS NOT NULL AND left_at >= ?', [pubId, day(90)]),
    director_changed_90: dirDays != null && dirDays <= 90,
    days_since_director_change: dirDays,
    open_issues: await n("SELECT COUNT(*) AS n FROM issues WHERE publication_id = ? AND deleted_at IS NULL AND status NOT IN ('published','archived')", [pubId]),
    stuck_items: await n(
      `SELECT COUNT(*) AS n FROM issue_toc_items t JOIN issues i ON i.id = t.issue_id
       WHERE i.publication_id = ? AND i.deleted_at IS NULL AND i.status NOT IN ('published','archived') AND t.status <> 'done'
         AND COALESCE((SELECT MAX(created_at) FROM stage_events e WHERE e.toc_item_id = t.id), i.created_at) < ?`,
      [pubId, iso(21)]
    ),
    last_activity_days: daysSince(lastAct?.t, nowMs),
    posts_30: await n("SELECT COUNT(*) AS n FROM posts WHERE publication_id = ? AND status = 'published' AND published_at >= ?", [pubId, iso(30)]),
    posts_prev_30: await n("SELECT COUNT(*) AS n FROM posts WHERE publication_id = ? AND status = 'published' AND published_at >= ? AND published_at < ?", [pubId, iso(60), iso(30)]),
    views_30: await n('SELECT COUNT(*) AS n FROM view_events WHERE publication_id = ? AND day >= ?', [pubId, day(30)]),
    views_prev_30: await n('SELECT COUNT(*) AS n FROM view_events WHERE publication_id = ? AND day >= ? AND day < ?', [pubId, day(60), day(30)]),
    pending_comments: await n("SELECT COUNT(*) AS n FROM comments c JOIN posts po ON po.id = c.post_id WHERE po.publication_id = ? AND c.status = 'pending'", [pubId]),
    license_days_left: p.license_expires_at ? Math.round((new Date(p.license_expires_at).getTime() - nowMs) / DAY) : null
  }
}

/** Pure: explainable hypotheses from evidence (tested in tests/unit.mjs). */
export function ruleHypotheses(e: Evidence): Hypothesis[] {
  const out: string[] = []
  if (e.members_left_90 >= 2 || (e.members_left_90 >= 1 && e.members_active <= 3))
    out.push(`کوچک شدن تیم: ${e.members_left_90} عضو در ۹۰ روز اخیر رفته‌اند و ${e.members_active} عضو فعال مانده است.`)
  if (e.members_active <= 2) out.push(`تیم بسیار کوچک است (${e.members_active} عضو فعال)؛ تولید منظم با این تعداد دشوار است.`)
  if (e.director_changed_90) out.push(`مدیرمسئول ${e.days_since_director_change} روز پیش تغییر کرده؛ دورهٔ انتقال معمولاً با افت موقت همراه است.`)
  if (e.stuck_items > 0) out.push(`${e.stuck_items} بخش از شماره‌های در حال تولید بیش از ۲۱ روز بدون پیشرفت مانده؛ گلوگاه تولید محتمل است.`)
  if (e.open_issues === 0 && (e.days_since_last_issue ?? 0) > 60) out.push('هیچ شمارهٔ در حال تولیدی ثبت نشده؛ احتمالاً برنامه‌ریزی شمارهٔ بعد شروع نشده است.')
  if (e.last_activity_days == null || e.last_activity_days > 30) out.push(`آخرین فعالیت تیم در سامانه ${e.last_activity_days == null ? 'هرگز' : `${e.last_activity_days} روز پیش`} بوده؛ ممکن است کارها بیرون از سامانه پیش برود یا تیم متوقف شده باشد.`)
  if (e.posts_prev_30 >= 3 && e.posts_30 < e.posts_prev_30 / 2) out.push(`پست‌های اکسپلور از ${e.posts_prev_30} به ${e.posts_30} در ماه کاهش یافته؛ کم شدن دیده‌شدن می‌تواند علت افت بازدید باشد.`)
  if (e.views_prev_30 >= 30 && e.views_30 < e.views_prev_30 / 2 && e.posts_30 >= e.posts_prev_30) out.push('بازدید افت کرده ولی تعداد پست کم نشده؛ احتمالاً موضوع یا زمان انتشار با مخاطب هم‌خوان نبوده است (یا دورهٔ امتحانات/تعطیلات).')
  if (e.views_prev_30 >= 20 && e.views_30 > e.views_prev_30 * 1.5) out.push(`بازدید از ${e.views_prev_30} به ${e.views_30} رسیده؛ ${e.posts_30 > e.posts_prev_30 ? 'افزایش پست‌ها احتمالاً اثرگذار بوده است' : 'احتمالاً یک شماره یا پست خاص پربازدید شده است'}.`)
  if (e.pending_comments >= 5) out.push(`${e.pending_comments} نظر در انتظار بررسی است؛ نشانهٔ کمبود وقت یا نیروی تیم برای پاسخ‌گویی.`)
  if (e.license_days_left != null && e.license_days_left < 0) out.push('مجوز نشریه منقضی شده؛ ممکن است تیم تا تمدید مجوز انتشار را متوقف کرده باشد.')
  if (!out.length) out.push('در داده‌های موجود علت روشنی دیده نشد؛ پیشنهاد می‌شود با مدیرمسئول نشریه گفت‌وگو شود.')
  return out.map((text) => ({ text, source: 'rule' as const }))
}

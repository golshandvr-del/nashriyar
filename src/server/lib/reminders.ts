// In-app reminders (ROADMAP phase 9): upcoming deadlines and licence renewal.
// No cron (works on Cloudflare and Node alike): runs lazily at most once per UTC day, triggered by the
// first team-dashboard / analytics request of the day. Each reminder is de-duplicated per user via a
// stable notification type+link so re-runs never spam.
import type { Db } from '../adapters/db'
import { getSetting, notify, setSetting } from './util'

const DAY = 86400_000
/** Days-before-due at which a reminder is sent (pure, exported for tests). */
export const DEADLINE_MARKS = [7, 3, 1]
export const LICENSE_MARKS = [60, 30, 7]

/** Pure: which reminder mark (if any) applies for `daysLeft`, given descending marks. */
export function reminderMark(daysLeft: number, marks: number[]): number | null {
  if (daysLeft < 0) return null
  const hit = [...marks].sort((a, b) => a - b).find((m) => daysLeft <= m)
  return hit ?? null
}

async function once(db: Db, userId: string, type: string, title: string, link: string) {
  const seen = await db.first('SELECT 1 AS x FROM notifications WHERE user_id = ? AND type = ? AND link = ?', [userId, type, link])
  if (!seen) await notify(db, userId, type, title, link)
}

export async function ensureReminders(db: Db): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10)
  if ((await getSetting<string | null>(db, 'reminders_last_day', null)) === today) return false
  await setSetting(db, 'reminders_last_day', today)
  const now = Date.now()

  // People responsible for active publications (current managing directors / editors-in-chief)
  const leads = await db.all<{ user_id: string; publication_id: string }>(
    `SELECT DISTINCT r.user_id, r.publication_id FROM publication_roles r JOIN publications p ON p.id = r.publication_id
     WHERE r.ended_at IS NULL AND r.role IN ('managing_director','editor_in_chief') AND p.status = 'active' AND p.deleted_at IS NULL`
  )
  const leadUsers = [...new Set(leads.map((l) => l.user_id))]

  // 1. Global deadlines (festival, end of term, …)
  const deadlines = await db.all<{ id: string; title: string; due_at: string }>('SELECT id, title, due_at FROM deadlines WHERE due_at >= ?', [today])
  for (const d of deadlines) {
    const left = Math.ceil((new Date(d.due_at.slice(0, 10) + 'T00:00:00Z').getTime() - new Date(today + 'T00:00:00Z').getTime()) / DAY)
    const mark = reminderMark(left, DEADLINE_MARKS)
    if (mark == null) continue
    for (const uid of leadUsers) await once(db, uid, 'deadline.reminder', `یادآوری مهلت: «${d.title}» — ${left === 0 ? 'امروز' : `${left} روز مانده`}`, `#deadline-${d.id}-${mark}`)
  }

  // 2. Licence renewal: managing director/editor of the publication + all publication officers
  const officers = (await db.all<{ id: string }>("SELECT id FROM users WHERE system_role IN ('pub_officer','super_admin') AND status = 'active' AND deleted_at IS NULL")).map((r) => r.id)
  const pubs = await db.all<{ id: string; title: string; license_expires_at: string }>(
    "SELECT id, title, license_expires_at FROM publications WHERE license_expires_at IS NOT NULL AND status = 'active' AND deleted_at IS NULL"
  )
  for (const p of pubs) {
    const left = Math.ceil((new Date(p.license_expires_at).getTime() - now) / DAY)
    const mark = reminderMark(left, LICENSE_MARKS)
    if (mark == null) continue
    const title = `تمدید مجوز «${p.title}»: ${left} روز تا انقضا`
    for (const l of leads.filter((x) => x.publication_id === p.id)) await once(db, l.user_id, 'license.reminder', title, `/team/${p.id}/profile#license-${mark}`)
    for (const uid of officers) await once(db, uid, 'license.reminder', title, `/admin/publications/${p.id}#license-${mark}`)
  }
  return true
}

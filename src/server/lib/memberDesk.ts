// Access matrix inside a publication (ROADMAP phase 15). The three main accounts (managing director, editor-in-chief,
// license holder) get the publication panel (/team) through publication_roles. Every other team member whose account is
// linked to an active team_members record gets the «میز کار عضو» (/desk). What the desk shows is configurable by the
// publications officer through the `member_desk` setting; unknown keys are ignored and missing keys fall back to defaults.
import type { Db } from '../adapters/db'
import { getSetting } from './util'

export const MEMBER_DESK_DEFAULTS = {
  enabled: true, // members with a linked account land on /desk
  sections: true, // see the TOC sections assigned to them
  update_sections: true, // move their own sections todo → writing → written
  deadlines: true, // upcoming due dates of their sections + university-wide deadlines
  certificates: true // collaboration certificates issued to them
}
export type MemberDesk = typeof MEMBER_DESK_DEFAULTS

export const MEMBER_DESK_LABELS: Record<keyof MemberDesk, string> = {
  enabled: 'میز کار عضو فعال است',
  sections: 'نمایش بخش‌های سپرده‌شده',
  update_sections: 'تغییر وضعیت بخش‌های خود (شروع‌نشده ← در حال نوشتن ← نوشته شد)',
  deadlines: 'نمایش مهلت‌ها',
  certificates: 'نمایش گواهی‌های همکاری'
}

export function sanitizeMemberDesk(v: unknown): MemberDesk {
  const out = { ...MEMBER_DESK_DEFAULTS }
  if (v && typeof v === 'object')
    for (const k of Object.keys(MEMBER_DESK_DEFAULTS) as (keyof MemberDesk)[]) {
      const x = (v as Record<string, unknown>)[k]
      if (typeof x === 'boolean') out[k] = x
    }
  return out
}

export async function getMemberDesk(db: Db): Promise<MemberDesk> {
  return sanitizeMemberDesk(await getSetting<unknown>(db, 'member_desk', {}))
}

/** Active team memberships of an account: linked by user_id, or (legacy, unlinked records) by student number. */
export async function activeMemberships(db: Db, userId: string, studentNumber: string | null) {
  return db.all<{ id: string; publication_id: string; title: string; slug: string; default_role: string | null; joined_at: string | null }>(
    `SELECT tm.id, tm.publication_id, p.title, p.slug, tm.default_role, tm.joined_at
       FROM team_members tm JOIN publications p ON p.id = tm.publication_id AND p.deleted_at IS NULL AND p.status = 'active'
      WHERE tm.is_active = 1 AND (tm.user_id = ? OR (tm.user_id IS NULL AND ? IS NOT NULL AND tm.student_number = ?))
      ORDER BY p.title`,
    [userId, studentNumber, studentNumber]
  )
}

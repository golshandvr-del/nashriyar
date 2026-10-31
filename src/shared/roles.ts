// Single source of truth for role keys and their Persian labels (shared by server and web).
// The database / API use the long keys below; never invent short aliases in the UI again
// (a key mismatch once showed the raw text "managing_director" in the team panel).

export type PubRoleKey = 'managing_director' | 'editor_in_chief' | 'license_holder'

export const PUB_ROLES: { key: PubRoleKey; label: string; short: string }[] = [
  { key: 'managing_director', label: 'مدیرمسئول', short: 'مدیرمسئول' },
  { key: 'editor_in_chief', label: 'سردبیر', short: 'سردبیر' },
  { key: 'license_holder', label: 'صاحب امتیاز', short: 'صاحب امتیاز' }
]

export const PUB_ROLE_LABEL: Record<string, string> = {
  managing_director: 'مدیرمسئول',
  editor_in_chief: 'سردبیر',
  license_holder: 'صاحب امتیاز',
  // legacy short aliases (kept so old cached clients never show raw keys)
  director: 'مدیرمسئول',
  editor: 'سردبیر',
  holder: 'صاحب امتیاز'
}

/** Persian label for a publication role key; falls back to a neutral label instead of the raw key. */
export const pubRoleLabel = (key: string | null | undefined): string => (key && PUB_ROLE_LABEL[key]) || 'عضو تیم'

export type SystemRoleKey = 'developer' | 'super_admin' | 'pub_officer' | 'faculty_supervisor' | 'analyst' | 'team' | 'student'

export const SYSTEM_ROLE_LABEL: Record<SystemRoleKey, string> = {
  developer: 'طراح سامانه',
  super_admin: 'مدیر کل سامانه',
  pub_officer: 'مسئول نشریات',
  faculty_supervisor: 'ناظر دانشکده',
  analyst: 'تحلیلگر',
  team: 'تیم نشریه',
  student: 'دانشجو'
}

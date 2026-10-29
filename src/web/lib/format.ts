// UI label maps + re-exports of shared Persian formatting helpers.
export { faDate, relativeFa, formatNumber, formatToman, toFaDigits, toEnDigits, faMonthLabel, jalaliPresets, normalizeFa } from '../../shared/fa'

export const ISSUE_STATUS: Record<string, { label: string; tone: 'muted' | 'brand' | 'warn' | 'ok' | 'danger' }> = {
  planning: { label: 'برنامه‌ریزی', tone: 'muted' },
  in_production: { label: 'در حال تولید', tone: 'brand' },
  awaiting_approval: { label: 'در انتظار تأیید', tone: 'warn' },
  changes_requested: { label: 'نیازمند اصلاح', tone: 'danger' },
  published: { label: 'منتشرشده', tone: 'ok' },
  archived: { label: 'بایگانی', tone: 'muted' }
}

export const TOC_STATUS: Record<string, string> = {
  todo: 'شروع‌نشده',
  writing: 'در حال نگارش',
  written: 'نوشته‌شده',
  editing: 'در حال ویرایش',
  edited: 'ویرایش‌شده',
  done: 'نهایی'
}

export const STAGE_STATUS: Record<string, string> = { pending: 'در انتظار', in_progress: 'در جریان', done: 'انجام‌شده', skipped: 'ردشده' }

export const PUB_STATUS: Record<string, string> = { active: 'فعال', suspended: 'تعلیق', archived: 'بایگانی' }

export const FREQUENCY: Record<string, string> = {
  monthly: 'ماهنامه',
  bimonthly: 'دوماهنامه',
  quarterly: 'فصلنامه',
  biannual: 'دوفصلنامه',
  irregular: 'گاهنامه'
}

export const ASSOC_KIND: Record<string, string> = {
  scientific_association: 'انجمن علمی',
  cultural_club: 'کانون فرهنگی',
  islamic_association: 'انجمن اسلامی',
  other: 'سایر'
}

export const CHANNEL: Record<string, string> = { card_to_card: 'کارت‌به‌کارت', cash: 'نقدی', gift: 'هدیه', other: 'سایر' }

export const CODE_STATE: Record<string, string> = { active: 'فعال', redeemed: 'استفاده‌شده', expired: 'منقضی', revoked: 'باطل‌شده' }

export const COMMENT_STATUS: Record<string, string> = { pending: 'در انتظار بررسی', approved: 'تأییدشده', rejected: 'ردشده', spam: 'هرزنامه' }

export const MEDIA_ROLE: Record<string, string> = {
  main_pdf: 'نسخهٔ اصلی PDF',
  cover: 'جلد',
  logo: 'لوگو',
  post: 'تصویر پست',
  audio: 'فایل صوتی',
  video: 'ویدئو',
  attachment: 'پیوست',
  image: 'تصویر'
}

export function fileSize(n?: number | null): string {
  if (!n) return '—'
  const u = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(v)} ${u[i]}`
}

export function pct(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n)}٪`
}

/** Percent change between two numbers, or null when undefined. */
export function delta(cur: number, prev: number): number | null {
  if (!prev) return cur ? null : 0
  return ((cur - prev) / prev) * 100
}

export function cx(...a: (string | false | null | undefined)[]): string {
  return a.filter(Boolean).join(' ')
}

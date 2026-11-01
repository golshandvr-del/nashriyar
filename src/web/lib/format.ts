// UI label maps + re-exports of shared Persian formatting helpers.
export { faDate, relativeFa, formatNumber, formatToman, toFaDigits, toEnDigits, faMonthLabel, jalaliPresets, normalizeFa } from '../../shared/fa'

export { ISSUE_STATUS, ISSUE_STATUS_LABEL, TOC_STATUS, STAGE_STATUS, PUB_STATUS, FREQUENCY, ASSOC_KIND, CHANNEL, CODE_STATE, COMMENT_STATUS } from '../../shared/labels'

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

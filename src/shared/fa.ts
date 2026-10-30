// Persian text, digits and Jalali calendar utilities (shared by server and web).

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'

/** Convert Persian/Arabic digits to ASCII digits. */
export function toEnDigits(s: string): string {
  return String(s ?? '').replace(/[۰-۹٠-٩]/g, (d) => {
    const i = FA_DIGITS.indexOf(d)
    return String(i >= 0 ? i : AR_DIGITS.indexOf(d))
  })
}

/** Convert ASCII digits to Persian digits. */
export function toFaDigits(s: string | number): string {
  return String(s ?? '').replace(/[0-9]/g, (d) => FA_DIGITS[+d])
}

/** Normalize Persian text for search: Arabic yeh/kaf, diacritics, ZWNJ, digits, spacing. */
export function normalizeFa(s: string): string {
  return toEnDigits(String(s ?? ''))
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ۀة]/g, 'ه')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/[\u064B-\u065F\u0670]/g, '') // harakat
    .replace(/\u200c|\u200d|\u200e|\u200f/g, ' ') // ZWNJ etc. (alternation: a class with ZWJ trips no-misleading-character-class)
    .replace(/ـ/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: digits }).format(n)
}

export function formatToman(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${formatNumber(n)} تومان`
}

// ───────── Jalali (jalaali-js algorithm, MIT) ─────────
const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178]
const div = (a: number, b: number) => ~~(a / b)
const mod = (a: number, b: number) => a - ~~(a / b) * b

function jalCal(jy: number) {
  const bl = breaks.length
  const gy = jy + 621
  let leapJ = -14
  let jp = breaks[0]
  let jm = 0
  let jump = 0
  for (let i = 1; i < bl; i += 1) {
    jm = breaks[i]
    jump = jm - jp
    if (jy < jm) break
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4)
    jp = jm
  }
  let n = jy - jp
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4)
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150
  const march = 20 + leapJ - leapG
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33
  let leap = mod(mod(n + 1, 33) - 1, 4)
  if (leap === -1) leap = 4
  return { leap, gy, march }
}

function g2d(gy: number, gm: number, gd: number) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752
  return d
}

function d2g(jdn: number) {
  let j = 4 * jdn + 139361631
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908
  const i = div(mod(j, 1461), 4) * 5 + 308
  const gd = div(mod(i, 153), 5) + 1
  const gm = mod(div(i, 153), 12) + 1
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6)
  return { gy, gm, gd }
}

function j2d(jy: number, jm: number, jd: number) {
  const r = jalCal(jy)
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1
}

function d2j(jdn: number) {
  const gy = d2g(jdn).gy
  let jy = gy - 621
  const r = jalCal(jy)
  const jdn1f = g2d(gy, 3, r.march)
  let k = jdn - jdn1f
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 }
    k -= 186
  } else {
    jy -= 1
    k += 179
    if (r.leap === 1) k += 1
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 }
}

export function toJalali(gy: number, gm: number, gd: number) {
  return d2j(g2d(gy, gm, gd))
}

export function toGregorian(jy: number, jm: number, jd: number) {
  return d2g(j2d(jy, jm, jd))
}

export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31
  if (jm <= 11) return 30
  return jalCal(jy).leap === 0 ? 30 : 29
}

export const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']
export const WEEKDAYS_FA = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']

/** ISO date (YYYY-MM-DD) for a Jalali date. */
export function jalaliToIso(jy: number, jm: number, jd: number): string {
  const g = toGregorian(jy, jm, jd)
  return `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`
}

export function isoToJalali(iso: string) {
  const d = new Date(iso)
  return toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

/** Format an ISO timestamp as a Persian Jalali date, e.g. «۸ آبان ۱۴۰۵». */
export function faDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const j = toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate())
  let s = `${toFaDigits(j.jd)} ${JALALI_MONTHS[j.jm - 1]} ${toFaDigits(j.jy)}`
  if (withTime) s += ` — ${toFaDigits(String(d.getHours()).padStart(2, '0'))}:${toFaDigits(String(d.getMinutes()).padStart(2, '0'))}`
  return s
}

/** Short Jalali month label like «آبان ۰۵». */
export function faMonthLabel(ym: string): string {
  // ym: YYYY-MM (gregorian month start) -> jalali month of the 15th
  const [y, m] = ym.split('-').map(Number)
  const j = toJalali(y, m, 15)
  return `${JALALI_MONTHS[j.jm - 1]} ${toFaDigits(String(j.jy).slice(2))}`
}

export function relativeFa(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'لحظاتی پیش'
  if (diff < 3600) return `${toFaDigits(Math.floor(diff / 60))} دقیقه پیش`
  if (diff < 86400) return `${toFaDigits(Math.floor(diff / 3600))} ساعت پیش`
  if (diff < 86400 * 30) return `${toFaDigits(Math.floor(diff / 86400))} روز پیش`
  return faDate(iso)
}

/** Current Jalali year/month helpers for preset ranges. */
export function jalaliPresets(now = new Date()) {
  const j = toJalali(now.getFullYear(), now.getMonth() + 1, now.getDate())
  const today = now.toISOString().slice(0, 10)
  const monthStart = jalaliToIso(j.jy, j.jm, 1)
  const prevM = j.jm === 1 ? { y: j.jy - 1, m: 12 } : { y: j.jy, m: j.jm - 1 }
  const yearStart = jalaliToIso(j.jy, 1, 1)
  // academic year starts 1 Mehr
  const acadY = j.jm >= 7 ? j.jy : j.jy - 1
  const acadStart = jalaliToIso(acadY, 7, 1)
  // term: Mehr-Bahman (fall) or Bahman-Tir (spring)
  const termStart = j.jm >= 7 && j.jm <= 10 ? jalaliToIso(j.jy, 7, 1) : j.jm >= 11 ? jalaliToIso(j.jy, 11, 1) : j.jm <= 4 ? jalaliToIso(j.jy - 1, 11, 1) : jalaliToIso(j.jy, 4, 1)
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000).toISOString().slice(0, 10)
  return [
    { key: '7d', label: '۷ روز اخیر', from: daysAgo(6), to: today },
    { key: '30d', label: '۳۰ روز اخیر', from: daysAgo(29), to: today },
    { key: 'month', label: 'ماه جاری', from: monthStart, to: today },
    { key: 'prevMonth', label: 'ماه گذشته', from: jalaliToIso(prevM.y, prevM.m, 1), to: jalaliToIso(prevM.y, prevM.m, jalaliMonthLength(prevM.y, prevM.m)) },
    { key: 'term', label: 'ترم جاری', from: termStart, to: today },
    { key: 'acad', label: 'سال تحصیلی', from: acadStart, to: today },
    { key: 'year', label: 'سال شمسی جاری', from: yearStart, to: today },
    { key: 'prevYear', label: 'سال گذشته', from: jalaliToIso(j.jy - 1, 1, 1), to: jalaliToIso(j.jy - 1, 12, jalaliMonthLength(j.jy - 1, 12)) },
    { key: 'all', label: 'از ابتدا', from: '2015-01-01', to: today }
  ]
}

/**
 * Current academic term bounds (ISO dates). Fall: 1 Mehr → end of Dey; spring: 1 Bahman → end of Tir;
 * summer: 1 Mordad → end of Shahrivar. Used by the analytics forecast ("by the end of the term").
 */
export function termBounds(now = new Date()): { start: string; end: string; label: string } {
  const j = toJalali(now.getFullYear(), now.getMonth() + 1, now.getDate())
  const endOf = (y: number, m: number) => jalaliToIso(y, m, jalaliMonthLength(y, m))
  if (j.jm >= 7 && j.jm <= 10) return { start: jalaliToIso(j.jy, 7, 1), end: endOf(j.jy, 10), label: `نیم‌سال اول ${toFaDigits(j.jy)}–${toFaDigits(j.jy + 1)}` }
  if (j.jm >= 11) return { start: jalaliToIso(j.jy, 11, 1), end: endOf(j.jy + 1, 4), label: `نیم‌سال دوم ${toFaDigits(j.jy)}–${toFaDigits(j.jy + 1)}` }
  if (j.jm <= 4) return { start: jalaliToIso(j.jy - 1, 11, 1), end: endOf(j.jy, 4), label: `نیم‌سال دوم ${toFaDigits(j.jy - 1)}–${toFaDigits(j.jy)}` }
  return { start: jalaliToIso(j.jy, 5, 1), end: endOf(j.jy, 6), label: `ترم تابستان ${toFaDigits(j.jy)}` }
}

/** Least-squares line through (x, y) points. Returns slope/intercept and r² (0 when undefined). */
export function linearFit(points: { x: number; y: number }[]): { slope: number; intercept: number; r2: number } {
  const n = points.length
  if (n < 2) return { slope: 0, intercept: n ? points[0].y : 0, r2: 0 }
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (const p of points) {
    sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y
  }
  const den = n * sxx - sx * sx
  if (den === 0) return { slope: 0, intercept: sy / n, r2: 0 }
  const slope = (n * sxy - sx * sy) / den
  const intercept = (sy - slope * sx) / n
  const mean = sy / n
  let ssTot = 0, ssRes = 0
  for (const p of points) {
    ssTot += (p.y - mean) ** 2
    ssRes += (p.y - (slope * p.x + intercept)) ** 2
  }
  return { slope, intercept, r2: ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot) }
}

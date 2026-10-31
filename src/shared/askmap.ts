// Persian statistical Q&A → one of the predefined reports (ROADMAP phase 10).
// Never free SQL: a question is mapped to an existing analytics tab + a range preset (+ optional faculty),
// and the answer is shown with the same dashboard components. Pure and deterministic, so it works
// without any AI provider; the optional AI may only pick from the same whitelists.
import { normalizeFa } from './fa'

export const ASK_REPORTS = ['trends', 'ranking', 'production', 'gaps', 'directors', 'explore', 'sales', 'forecast'] as const
export type AskReport = (typeof ASK_REPORTS)[number]
export const ASK_RANGES = ['week', '7d', '30d', 'month', 'prevMonth', 'term', 'semester', 'acad', 'year', 'prevYear', 'all'] as const
export type AskRange = (typeof ASK_RANGES)[number]

export const ASK_REPORT_LABELS: Record<AskReport, string> = {
  trends: 'روندها',
  ranking: 'رتبه‌بندی',
  production: 'سرعت تولید',
  gaps: 'فاصلهٔ انتشار',
  directors: 'بازدهی مدیران',
  explore: 'اکسپلور',
  sales: 'فروش',
  forecast: 'پیش‌بینی ترم'
}

export interface AskRoute {
  report: AskReport
  range: AskRange | null
  faculty_id: string | null
  /** 0..1 — how many signals matched; 0 means "fell back to the default report". */
  confidence: number
}

// Order matters: more specific reports first.
const REPORT_WORDS: [AskReport, string[]][] = [
  ['forecast', ['پیش بینی', 'پیشبینی', 'ترم آینده', 'ترم بعد', 'آینده']],
  ['directors', ['مدیرمسئول', 'مدیر مسئول', 'مدیران', 'مدیر']],
  ['sales', ['فروش', 'خرید', 'درآمد', 'کد خرید', 'کدهای', 'نسخه چاپی', 'پولی']],
  ['explore', ['اکسپلور', 'پست', 'استوری', 'لایک', 'پسند']],
  ['production', ['سرعت تولید', 'تولید', 'مرحله', 'گلوگاه', 'ویراستاری', 'صفحه آرایی', 'گیر کرده']],
  ['gaps', ['فاصله', 'نظم', 'منظم', 'نامنظم', 'تاخیر', 'تأخیر', 'عقب', 'دیر', 'کمتر منتشر', 'منتشر نکرده', 'غیرفعال']],
  ['ranking', ['رتبه', 'بهترین', 'برترین', 'برتر', 'فعال ترین', 'فعالترین', 'بیشترین', 'کمترین', 'مقایسه']],
  ['trends', ['روند', 'بازدید', 'خواننده', 'مطالعه', 'رشد', 'افت', 'کاهش', 'افزایش']]
]

const RANGE_WORDS: [AskRange, string[]][] = [
  ['prevYear', ['سال گذشته', 'سال قبل', 'پارسال']],
  ['prevMonth', ['ماه گذشته', 'ماه قبل', 'ماه پیش']],
  ['acad', ['سال تحصیلی', 'شش ماه', '6 ماه', 'نیمسال اخیر']],
  ['semester', ['نیمسال', 'نیم سال']],
  ['term', ['ترم']],
  ['7d', ['7 روز', 'هفت روز', 'یک هفته']],
  ['week', ['هفته']],
  ['30d', ['30 روز', 'سی روز', 'یک ماه']],
  ['month', ['ماه']],
  ['year', ['امسال', 'سال جاری', 'سال']],
  ['all', ['از ابتدا', 'کل دوره', 'همیشه', 'تا حالا', 'تاکنون']]
]

/** Normalises a question for matching: Persian letters, ASCII digits, ZWNJ → space, single spaces. */
export function normQuestion(q: string): string {
  return ` ${normalizeFa(q)
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/\u200c/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `
}

const has = (n: string, w: string) => n.includes(` ${normQuestion(w).trim()}`)

/** Maps a question to a report/range/faculty using whitelists only. */
export function mapQuestion(question: string, faculties: { id: string; name: string }[] = []): AskRoute {
  const n = normQuestion(question)
  let report: AskReport = 'trends'
  let hits = 0
  for (const [r, words] of REPORT_WORDS) {
    if (words.some((w) => has(n, w))) {
      report = r
      hits++
      break
    }
  }
  let range: AskRange | null = null
  for (const [r, words] of RANGE_WORDS) {
    if (words.some((w) => has(n, w))) {
      range = r
      hits++
      break
    }
  }
  let faculty_id: string | null = null
  // Full names first (longest first so "فنی و مهندسی" wins over "فنی"), then a unique first word
  // ("فنی" → "فنی و مهندسی") as long as no other faculty starts with the same word.
  const names = faculties.map((f) => ({ id: f.id, name: normQuestion(f.name.replace(/^دانشکده(ٔ|ی)?\s*/, '')).trim() }))
  const firstWord = (s: string) => s.split(' ')[0]
  const full = [...names].sort((a, b) => b.name.length - a.name.length).find((f) => f.name.length >= 2 && n.includes(` ${f.name} `))
  const short = full
    ? null
    : names.find((f) => {
        const w = firstWord(f.name)
        return w.length >= 3 && names.filter((g) => firstWord(g.name) === w).length === 1 && n.includes(` ${w} `)
      })
  const fac = full || short
  if (fac) {
    faculty_id = fac.id
    hits++
  }
  return { report, range, faculty_id, confidence: Math.min(1, hits / 2) }
}

/** Validates an AI-proposed route against the same whitelists (anything unknown is dropped). */
export function sanitizeRoute(raw: unknown, faculties: { id: string }[] = []): Partial<AskRoute> {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Partial<AskRoute> = {}
  if ((ASK_REPORTS as readonly string[]).includes(String(o.report))) out.report = o.report as AskReport
  if ((ASK_RANGES as readonly string[]).includes(String(o.range))) out.range = o.range as AskRange
  if (typeof o.faculty_id === 'string' && faculties.some((f) => f.id === o.faculty_id)) out.faculty_id = o.faculty_id
  return out
}

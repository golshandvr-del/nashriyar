// Optional AI layer (Phase 10). Fully optional: when disabled or not configured, a NullProvider is used
// and every endpoint returns a clear "disabled" response. Only aggregated statistics are sent — never
// personal data (names, student numbers) — see docs/SECURITY.md.
import type { Context } from 'hono'
import type { AppEnv } from './context'
import { getSetting, setSetting } from './lib/util'
import type { Db } from './adapters/db'

export interface AIProvider {
  readonly enabled: boolean
  complete(system: string, user: string): Promise<string>
  /** Tokens reported by the last call (0 when unknown). */
  lastTokens?: number
}

// ---- Usage budget + circuit breaker (ROADMAP phase 10) ----
// State lives in the settings table (no migration): `ai_usage` = calls/tokens of the current month,
// `ai_breaker` = consecutive failures and an "open until" time. `ai_monthly_call_limit` (0 = unlimited)
// is the monthly budget set by the super admin.
export interface AIUsage { month: string; calls: number; tokens: number; failures: number }
interface Breaker { fails: number; open_until: string | null }
const BREAKER_THRESHOLD = 3
const BREAKER_COOLDOWN_MS = 10 * 60 * 1000
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7)

export async function getAiUsage(db: Db): Promise<AIUsage> {
  const u = await getSetting<AIUsage | null>(db, 'ai_usage', null)
  const m = monthKey()
  return u && u.month === m ? { month: m, calls: u.calls || 0, tokens: u.tokens || 0, failures: u.failures || 0 } : { month: m, calls: 0, tokens: 0, failures: 0 }
}

export async function getAiStatus(db: Db) {
  const usage = await getAiUsage(db)
  const limit = Number(await getSetting(db, 'ai_monthly_call_limit', 0)) || 0
  const br = await getSetting<Breaker>(db, 'ai_breaker', { fails: 0, open_until: null })
  const open = !!br.open_until && new Date(br.open_until).getTime() > Date.now()
  return { usage, limit, remaining: limit ? Math.max(0, limit - usage.calls) : null, breaker_open: open, breaker_open_until: open ? br.open_until : null }
}

class BudgetError extends Error {}

// ---- Data minimisation (ROADMAP phase 10): nothing personal ever leaves the server ----
// Keys that may carry personal data are dropped from any JSON payload, and free text is redacted:
// student numbers / phone numbers (8+ consecutive digits), e-mail addresses and @handles.
const PERSONAL_KEY = /(^|_)(display_name|name|username|student_number|student|email|phone|mobile|actor|actor_name|user_id|viewer|ip|national_id)$/i
const SAFE_KEYS = new Set(['title', 'publication_title', 'issue_title', 'faculty', 'faculty_name', 'category', 'category_name', 'association', 'association_name'])

/** Redacts personal identifiers from free text. */
export function redactText(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[ایمیل]')
    .replace(/@\w{3,}/g, '[شناسه]')
    .replace(/[0-9۰-۹]{8,}/g, '[شماره]')
}

/** Deep-copies a payload without personal keys; strings are redacted. */
export function scrubPersonal(v: unknown, depth = 0): unknown {
  if (depth > 8) return null
  if (typeof v === 'string') return redactText(v)
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => scrubPersonal(x, depth + 1))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) {
      if (!SAFE_KEYS.has(k) && PERSONAL_KEY.test(k)) continue
      out[k] = scrubPersonal(x, depth + 1)
    }
    return out
  }
  return v
}

/** Wraps a real provider: refuses when over budget or while the breaker is open, records usage and failures. */
class GuardedProvider implements AIProvider {
  readonly enabled = true
  constructor(private inner: AIProvider, private db: Db) {}
  async complete(system: string, user: string): Promise<string> {
    const st = await getAiStatus(this.db)
    if (st.breaker_open) throw new BudgetError('سرویس هوش مصنوعی پس از چند خطای پیاپی موقتاً متوقف شده است؛ چند دقیقهٔ دیگر دوباره تلاش کنید.')
    if (st.limit && st.usage.calls >= st.limit) throw new BudgetError('سقف ماهانهٔ استفاده از هوش مصنوعی پر شده است؛ سوپرادمین می‌تواند سقف را در تنظیمات افزایش دهد.')
    const usage = st.usage
    try {
      // Last line of defence: whatever the caller built, identifiers are redacted before leaving the server.
      const out = await this.inner.complete(system, redactText(user))
      await setSetting(this.db, 'ai_usage', { ...usage, calls: usage.calls + 1, tokens: usage.tokens + (this.inner.lastTokens || 0) })
      await setSetting(this.db, 'ai_breaker', { fails: 0, open_until: null })
      return out
    } catch (e) {
      const br = await getSetting<Breaker>(this.db, 'ai_breaker', { fails: 0, open_until: null })
      const fails = (br.fails || 0) + 1
      await setSetting(this.db, 'ai_breaker', { fails, open_until: fails >= BREAKER_THRESHOLD ? new Date(Date.now() + BREAKER_COOLDOWN_MS).toISOString() : null })
      await setSetting(this.db, 'ai_usage', { ...usage, failures: usage.failures + 1 })
      throw e
    }
  }
}

const failMessage = (e: unknown) => (e instanceof BudgetError ? e.message : 'پاسخ از سرویس هوش مصنوعی دریافت نشد. بعداً تلاش کنید.')

class NullProvider implements AIProvider {
  readonly enabled = false
  async complete(): Promise<string> {
    return ''
  }
}

/** OpenAI-compatible chat completions provider (works with any compatible endpoint). */
class OpenAICompatibleProvider implements AIProvider {
  readonly enabled = true
  lastTokens = 0
  constructor(private baseUrl: string, private apiKey: string, private model: string, private timeoutMs = 15000) {}
  async complete(system: string, user: string): Promise<string> {
    // Short timeout: a slow AI service must never slow down the dashboard (ROADMAP phase 10).
    const res = await fetch(this.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      signal: AbortSignal.timeout(this.timeoutMs),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, temperature: 0.3, max_tokens: 900, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
    })
    if (!res.ok) throw new Error(`AI provider error ${res.status}`)
    const j: any = await res.json()
    this.lastTokens = Number(j?.usage?.total_tokens) || 0
    return String(j?.choices?.[0]?.message?.content || '').trim()
  }
}

export async function getProvider(c: Context<AppEnv>): Promise<AIProvider> {
  const db = c.get('db')
  if (!(await getSetting(db, 'ai_enabled', false))) return new NullProvider()
  const deps = c.get('deps')
  const baseUrl = (await getSetting(db, 'ai_base_url', '')) || deps.ai?.baseUrl || ''
  const apiKey = (await getSetting(db, 'ai_api_key', '')) || deps.ai?.apiKey || ''
  const model = (await getSetting(db, 'ai_model', '')) || deps.ai?.model || 'gpt-4o-mini'
  if (!baseUrl || !apiKey) return new NullProvider()
  const timeoutSec = Math.min(60, Math.max(3, Number(await getSetting(db, 'ai_timeout_sec', 15)) || 15))
  return new GuardedProvider(new OpenAICompatibleProvider(baseUrl, apiKey, model, timeoutSec * 1000), db)
}

const SYSTEM_FA =
  'تو دستیار تحلیل آمار سامانهٔ نشریات دانشجویی هستی. فقط بر اساس داده‌های داده‌شده پاسخ بده، عدد نساز، ' +
  'کوتاه و دقیق به فارسی روان بنویس و در پایان حداکثر سه پیشنهاد عملی بده. اگر داده کافی نیست صریح بگو.'

const DISABLED = { enabled: false, text: '', message: 'لایهٔ هوش مصنوعی غیرفعال است. سوپرادمین می‌تواند آن را در تنظیمات فعال کند.' }

export async function aiNarrative(c: Context<AppEnv>, data: unknown) {
  const p = await getProvider(c)
  if (!p.enabled) return DISABLED
  try {
    const text = await p.complete(SYSTEM_FA, 'گزارش روایی کوتاهی از وضعیت نشریات در این بازه بنویس. داده‌ها (JSON):\n' + JSON.stringify(scrubPersonal(data)))
    return { enabled: true, text }
  } catch (e) {
    return { enabled: true, text: '', message: failMessage(e) }
  }
}

export async function aiAsk(c: Context<AppEnv>, question: string, data: unknown) {
  const p = await getProvider(c)
  if (!p.enabled) return DISABLED
  if (question.trim().length < 3) return { enabled: true, text: '', message: 'پرسش خود را کامل‌تر بنویسید.' }
  try {
    const text = await p.complete(SYSTEM_FA, `پرسش مسئول نشریات: ${question}\nداده‌های تجمیعی موجود (JSON):\n${JSON.stringify(scrubPersonal(data))}`)
    return { enabled: true, text }
  } catch (e) {
    return { enabled: true, text: '', message: failMessage(e) }
  }
}

/** Keyword suggestions for an issue (team panel). Falls back to simple frequency extraction when AI is off. */
export async function suggestKeywords(c: Context<AppEnv>, text: string): Promise<string[]> {
  const p = await getProvider(c)
  if (p.enabled) {
    try {
      const out = await p.complete('فقط فهرستی از حداکثر ۸ کلیدواژهٔ فارسی کوتاه، جداشده با ویرگول فارسی (،) برگردان؛ بدون توضیح.', text.slice(0, 4000))
      const arr = out.split(/[،,\n]/).map((s) => s.trim()).filter((s) => s && s.length < 40)
      if (arr.length) return arr.slice(0, 8)
    } catch {}
  }
  const stop = new Set(['و', 'در', 'به', 'از', 'که', 'این', 'را', 'با', 'برای', 'آن', 'یک', 'است', 'های', 'ها', 'تا', 'بر', 'یا', 'هم', 'نیز', 'شده', 'می', 'شود', 'کند', 'ای'])
  const counts = new Map<string, number>()
  for (const w of text.replace(/[^\p{L}\s]/gu, ' ').split(/\s+/)) {
    if (w.length < 3 || stop.has(w)) continue
    counts.set(w, (counts.get(w) || 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w)
}

/**
 * Optional AI hypotheses for an insight's root cause (ROADMAP phase 10). Receives only aggregated
 * evidence (counts/days), returns at most 3 short hypotheses; any failure ⇒ empty list (silent).
 */
export async function aiExplain(c: Context<AppEnv>, insight: { title: string; detail: string }, evidence: unknown): Promise<string[]> {
  const p = await getProvider(c)
  if (!p.enabled) return []
  try {
    const out = await p.complete(
      'تو تحلیلگر نشریات دانشجویی هستی. فقط بر اساس شواهد داده‌شده حداکثر ۳ فرضیهٔ کوتاه (هر کدام یک خط) دربارهٔ علت این وضعیت بنویس. عدد نساز. هر فرضیه را در یک خط جدا و بدون شماره‌گذاری بنویس.',
      `بینش: ${insight.title} — ${insight.detail}\nشواهد تجمیعی (JSON):\n${JSON.stringify(scrubPersonal(evidence))}`
    )
    return out
      .split('\n')
      .map((s) => s.replace(/^[\s\-•*\d۰-۹.)]+/, '').trim())
      .filter((s) => s.length > 5 && s.length < 400)
      .slice(0, 3)
  } catch {
    return []
  }
}

// ---- Team helpers (ROADMAP phase 10): category suggestion + caption draft ----
const faNorm = (s: string) =>
  String(s || '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u200c\u200d]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/** Pure fallback: scores categories by word overlap between the text and the category name (≥3-letter stems). */
export function scoreCategories(text: string, cats: { id: string; name: string }[]): string[] {
  const words = new Set(faNorm(text).split(' ').filter((w) => w.length >= 3))
  const stem = (w: string) => w.replace(/(ها|های|ی|ای|ان|ات)$/, '')
  const stems = new Set([...words].map(stem))
  const scored = cats
    .map((c) => {
      const parts = faNorm(c.name).split(' ').filter((w) => w.length >= 3)
      const hit = parts.filter((w) => words.has(w) || stems.has(stem(w))).length
      return { id: c.id, score: parts.length ? hit / parts.length : 0 }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, 3).map((x) => x.id)
}

/** Suggests up to 3 category ids for an issue; the AI may only choose from the given list. */
export async function suggestCategories(c: Context<AppEnv>, text: string, cats: { id: string; name: string }[]): Promise<string[]> {
  const p = await getProvider(c)
  if (p.enabled && cats.length) {
    try {
      const list = cats.map((x, i) => `${i + 1}. ${x.name}`).join('\n')
      const out = await p.complete('از فهرست دسته‌های داده‌شده حداکثر ۳ مورد مرتبط با متن را انتخاب کن و فقط شماره‌هایشان را با ویرگول برگردان؛ بدون توضیح.', `دسته‌ها:\n${list}\n\nمتن:\n${text.slice(0, 3000)}`)
      const ids = [...new Set(toAscii(out).match(/\d+/g) || [])].map((n) => cats[Number(n) - 1]?.id).filter(Boolean) as string[]
      if (ids.length) return ids.slice(0, 3)
    } catch {}
  }
  return scoreCategories(text, cats)
}
const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))

/** Pure fallback caption: a short, editable template from the source section and issue. */
export function templateCaption(src: { section: string; issue_title: string; issue_number: number | string | null; summary?: string | null; publication: string }): string {
  const lead = (src.summary || '').split(/(?<=[.!؟?])\s+/)[0]?.trim()
  return [
    `«${src.section}» از شمارهٔ ${src.issue_number ?? ''} ${src.publication}${src.issue_title ? ` — ${src.issue_title}` : ''}.`.replace(/\s+/g, ' '),
    lead && lead.length < 280 ? lead : '',
    'متن کامل را در پیشخوان نشریه بخوانید.'
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Draft caption for an explore post from its source section (AI when enabled; template otherwise). */
export async function draftCaption(c: Context<AppEnv>, src: Parameters<typeof templateCaption>[0]): Promise<{ text: string; source: 'ai' | 'template' }> {
  const p = await getProvider(c)
  if (p.enabled) {
    try {
      const out = await p.complete(
        'یک کپشن کوتاه (حداکثر ۴ جمله، بدون هشتگ زیاد، لحن علمی و صمیمی) برای معرفی این بخش از نشریهٔ دانشجویی بنویس. چیزی از خودت درباره محتوا نساز؛ فقط از اطلاعات داده‌شده استفاده کن.',
        JSON.stringify(scrubPersonal(src))
      )
      if (out.trim()) return { text: out.trim().slice(0, 2200), source: 'ai' }
    } catch {}
  }
  return { text: templateCaption(src), source: 'template' }
}

// ---- Comment-queue assistance (ROADMAP phase 10): labels only, the decision always stays with a human ----
export type CommentLabel = 'ok' | 'spam' | 'abusive'
export interface CommentHint { id: string; label: CommentLabel; reasons: string[]; source: 'rule' | 'ai' }

/** Pure: rule labels from the moderation pre-flag reasons (profanity ⇒ abusive; link/repetition/shouting ⇒ spam). */
export function ruleCommentLabel(reasons: string[]): CommentLabel {
  if (reasons.includes('profanity')) return 'abusive'
  if (reasons.some((r) => r === 'link' || r === 'repetition' || r === 'shouting')) return 'spam'
  return 'ok'
}

/**
 * Optional AI labels for pending comments. Only the comment text (redacted) is sent — never the author.
 * Returns a map id → label; any failure ⇒ empty map (rule labels stay).
 */
export async function aiCommentLabels(c: Context<AppEnv>, items: { id: string; body: string }[]): Promise<Record<string, CommentLabel>> {
  const p = await getProvider(c)
  if (!p.enabled || !items.length) return {}
  try {
    const list = items.slice(0, 30).map((x, i) => `${i + 1}) ${redactText(x.body).replace(/\s+/g, ' ').slice(0, 300)}`).join('\n')
    const out = await p.complete(
      'برای هر نظر کاربر فقط یکی از برچسب‌های ok یا spam یا abusive را بده. خروجی: هر خط «شماره: برچسب» و هیچ توضیح دیگری. در تردید ok بده.',
      list
    )
    const res: Record<string, CommentLabel> = {}
    for (const line of out.split('\n')) {
      const m = line.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).match(/(\d+)\s*[:：)\-]\s*(ok|spam|abusive)/i)
      const it = m && items[Number(m[1]) - 1]
      if (it) res[it.id] = m![2].toLowerCase() as CommentLabel
    }
    return res
  } catch {
    return {}
  }
}

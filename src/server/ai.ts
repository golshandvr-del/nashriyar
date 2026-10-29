// Optional AI layer (Phase 10). Fully optional: when disabled or not configured, a NullProvider is used
// and every endpoint returns a clear "disabled" response. Only aggregated statistics are sent — never
// personal data (names, student numbers) — see docs/SECURITY.md.
import type { Context } from 'hono'
import type { AppEnv } from './context'
import { getSetting } from './lib/util'

export interface AIProvider {
  readonly enabled: boolean
  complete(system: string, user: string): Promise<string>
}

class NullProvider implements AIProvider {
  readonly enabled = false
  async complete(): Promise<string> {
    return ''
  }
}

/** OpenAI-compatible chat completions provider (works with any compatible endpoint). */
class OpenAICompatibleProvider implements AIProvider {
  readonly enabled = true
  constructor(private baseUrl: string, private apiKey: string, private model: string) {}
  async complete(system: string, user: string): Promise<string> {
    const res = await fetch(this.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, temperature: 0.3, max_tokens: 900, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
    })
    if (!res.ok) throw new Error(`AI provider error ${res.status}`)
    const j: any = await res.json()
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
  return new OpenAICompatibleProvider(baseUrl, apiKey, model)
}

const SYSTEM_FA =
  'تو دستیار تحلیل آمار سامانهٔ نشریات دانشجویی هستی. فقط بر اساس داده‌های داده‌شده پاسخ بده، عدد نساز، ' +
  'کوتاه و دقیق به فارسی روان بنویس و در پایان حداکثر سه پیشنهاد عملی بده. اگر داده کافی نیست صریح بگو.'

const DISABLED = { enabled: false, text: '', message: 'لایهٔ هوش مصنوعی غیرفعال است. سوپرادمین می‌تواند آن را در تنظیمات فعال کند.' }

export async function aiNarrative(c: Context<AppEnv>, data: unknown) {
  const p = await getProvider(c)
  if (!p.enabled) return DISABLED
  try {
    const text = await p.complete(SYSTEM_FA, 'گزارش روایی کوتاهی از وضعیت نشریات در این بازه بنویس. داده‌ها (JSON):\n' + JSON.stringify(data))
    return { enabled: true, text }
  } catch (e) {
    return { enabled: true, text: '', message: 'پاسخ از سرویس هوش مصنوعی دریافت نشد. بعداً تلاش کنید.' }
  }
}

export async function aiAsk(c: Context<AppEnv>, question: string, data: unknown) {
  const p = await getProvider(c)
  if (!p.enabled) return DISABLED
  if (question.trim().length < 3) return { enabled: true, text: '', message: 'پرسش خود را کامل‌تر بنویسید.' }
  try {
    const text = await p.complete(SYSTEM_FA, `پرسش مسئول نشریات: ${question}\nداده‌های تجمیعی موجود (JSON):\n${JSON.stringify(data)}`)
    return { enabled: true, text }
  } catch {
    return { enabled: true, text: '', message: 'پاسخ از سرویس هوش مصنوعی دریافت نشد. بعداً تلاش کنید.' }
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

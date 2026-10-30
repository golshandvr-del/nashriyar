import { useState } from 'react'
import { Link } from 'react-router-dom'
import { EyeOff, Info, Sparkles } from 'lucide-react'
import { api, qs } from '../lib/api'
import { toFaDigits } from '../lib/format'
import { Async, Button, Card, Empty, PageHeader, Textarea, useAction, useAsync } from '../components/ui'
import { RangePicker, defaultRange } from '../team/Stats'
import { SEVERITY_CLS, SEVERITY_ICON } from './Overview'

const SEV_LABEL: Record<string, string> = { critical: 'بحرانی', warning: 'هشدار', info: 'اطلاع', positive: 'مثبت' }
const SEV_ORDER = ['critical', 'warning', 'info', 'positive']

export default function AdminInsights() {
  const st = useAsync(() => api.get('/api/analytics/insights'), [])
  const [sev, setSev] = useState('')
  const { run } = useAction()
  const dismiss = async (key: string) => {
    if (await run(() => api.post(`/api/analytics/insights/${encodeURIComponent(key)}/dismiss`), 'پنهان شد')) st.reload()
  }

  return (
    <div className="space-y-6">
      <PageHeader title="بینش‌ها" subtitle="هشدارها و نکته‌هایی که موتور قاعده‌محور از داده‌ها استخراج کرده است" />
      <Async state={st}>
        {(d: any) => {
          const counts: Record<string, number> = {}
          for (const it of d.items) counts[it.severity] = (counts[it.severity] || 0) + 1
          const items = d.items.filter((it: any) => !sev || it.severity === sev)
          return (
            <>
              <div className="flex flex-wrap gap-2">
                <button className={sev === '' ? 'chip border-brand bg-brand-soft text-brand' : 'chip'} onClick={() => setSev('')}>همه ({toFaDigits(d.items.length)})</button>
                {SEV_ORDER.filter((s) => counts[s]).map((s) => (
                  <button key={s} className={sev === s ? 'chip border-brand bg-brand-soft text-brand' : 'chip'} onClick={() => setSev(s)}>
                    {SEV_LABEL[s]} ({toFaDigits(counts[s])})
                  </button>
                ))}
              </div>
              {!items.length ? (
                <Empty title="بینشی برای نمایش نیست" hint="وضعیت فعلی نشریات نکتهٔ قابل‌توجهی ندارد." />
              ) : (
                <ul className="grid gap-3 md:grid-cols-2">
                  {items.map((it: any) => {
                    const Icon = SEVERITY_ICON[it.severity] || Info
                    return (
                      <li key={it.key} className={`flex items-start gap-3 rounded-2xl border p-4 ${SEVERITY_CLS[it.severity] || SEVERITY_CLS.info}`}>
                        <Icon className="mt-0.5 size-5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="font-bold">{it.title}</div>
                          <p className="mt-1 text-sm opacity-90">{it.detail}</p>
                          <div className="mt-2 flex flex-wrap gap-3 text-xs">
                            {it.link && <Link to={it.link} className="font-bold underline">بررسی</Link>}
                            <button className="inline-flex items-center gap-1 opacity-70 hover:opacity-100" onClick={() => dismiss(it.key)}>
                              <EyeOff className="size-3" /> پنهان کردن
                            </button>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )
        }}
      </Async>
      <AiPanel />
    </div>
  )
}

/** Optional AI layer — degrades gracefully to a "disabled" note when no provider is configured. */
function AiPanel() {
  const [range, setRange] = useState(defaultRange('90d'))
  const [narr, setNarr] = useState<{ text: string; message?: string; enabled: boolean } | null>(null)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<{ text: string; message?: string; enabled: boolean } | null>(null)
  const a1 = useAction()
  const a2 = useAction()
  const q = qs({ from: range.from, to: range.to })
  return (
    <Card title={<span className="flex items-center gap-2"><Sparkles className="size-4 text-brand" /> دستیار هوش مصنوعی (اختیاری)</span>}>
      <p className="mb-3 text-xs text-muted">فقط آمار تجمیعی و بی‌نام به سرویس ارسال می‌شود. پاسخ‌ها را پیش از استفاده با داده‌های داشبورد تطبیق دهید.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="text-sm font-bold">گزارش روایی</div>
          <RangePicker value={range} onChange={setRange} />
          <Button variant="ghost" loading={a1.busy} onClick={async () => setNarr((await a1.run(() => api.post(`/api/analytics/ai/narrative${q}`))) ?? null)}>تولید گزارش</Button>
          {narr && <AiResult r={narr} />}
        </div>
        <div className="space-y-2">
          <div className="text-sm font-bold">پرسش آماری</div>
          <Textarea rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={500} placeholder="مثلاً: کدام دانشکده‌ها در شش ماه اخیر کمتر منتشر کرده‌اند؟" />
          <Button variant="ghost" loading={a2.busy} disabled={question.trim().length < 3} onClick={async () => setAnswer((await a2.run(() => api.post('/api/analytics/ai/ask', { question }))) ?? null)}>پرسیدن</Button>
          {answer && <AiResult r={answer} />}
        </div>
      </div>
    </Card>
  )
}

function AiResult({ r }: { r: { text: string; message?: string; enabled: boolean } }) {
  if (r.message && !r.text) return <div className="rounded-xl bg-surface-2 p-3 text-sm text-muted">{r.message}</div>
  return <div className="rounded-xl border border-line p-3 text-sm leading-7 whitespace-pre-wrap">{r.text}</div>
}

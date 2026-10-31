import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, HardDrive, Save, Sparkles } from 'lucide-react'
import { api } from '../lib/api'
import { faDate, toFaDigits } from '../../shared/fa'
import { Async, Button, Card, Input, PageHeader, Select, useAction, useAsync } from '../components/ui'
import AllowlistCard from './AllowlistCard'

type S = Record<string, any>

const THRESHOLD_LABELS: Record<string, string> = {
  overdue_factor: 'ضریب تأخیر انتشار (× دورهٔ اعلامی)',
  inactive_days: 'روزهای بی‌فعالیتی تیم',
  license_warn_days: 'هشدار انقضای مجوز (روز قبل)',
  stuck_days: 'توقف تولید شماره (روز)',
  approval_wait_days: 'معطلی تأیید انتشار (روز)',
  pending_comments: 'انباشت نظرهای در انتظار (تعداد)',
  growth_pct: 'رشد چشمگیر بازدید (٪)',
  drop_pct: 'افت بازدید (٪)',
  expired_codes: 'کدهای منقضی‌شدهٔ بی‌استفاده (تعداد)',
  slow_stage_factor: 'مرحلهٔ طولانی (× میانهٔ همان مرحله)',
  irregular_cv: 'فاصلهٔ نامنظم (ضریب تغییرات)',
  team_shrink: 'کوچک شدن تیم (ترک عضو در ۶۰ روز)',
  bot_views: 'بازدید مشکوک ربات (بازدید یک نفر در روز)',
  director_effect_days: 'پایش اثر تغییر مدیرمسئول (روز)'
}
const WEIGHT_LABELS: Record<string, string> = {
  regularity: 'نظم انتشار',
  activity: 'فعالیت تولید',
  audience: 'مخاطب و بازدید',
  explore: 'فعالیت اکسپلور',
  hygiene: 'رسیدگی به نظرها'
}

const FEATURE_LABELS: Record<string, string> = {
  explore: 'اکسپلور و پست‌ها',
  comments: 'نظر دانشجویان زیر پست‌ها',
  recruitment: 'فراخوان جذب نیرو',
  paid_content: 'محتوای پولی و کد خرید',
  certificates: 'استعلام گواهی همکاری',
  physical_sales: 'ثبت فروش نسخهٔ چاپی',
  member_portal: 'ورود محدود اعضای عادی تیم (تیک بخش‌های خودشان)'
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3">
      <input type="checkbox" className="mt-1 size-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  )
}

export default function AdminSettings() {
  const st = useAsync(() => api.get('/api/admin/settings'), [])
  return (
    <div className="space-y-6">
      <PageHeader title="تنظیمات" subtitle="تنظیمات عمومی سامانه و لایهٔ اختیاری هوش مصنوعی" />
      <Async state={st}>{(d: any) => <Form initial={d.settings} isSuper={d.is_super} reload={st.reload} />}</Async>
      <AllowlistCard />
      <MonitoringCard />
    </div>
  )
}

function fmtBytes(n: number) {
  if (!Number.isFinite(n) || n <= 0) return '۰'
  const gb = n / (1024 ** 3)
  if (gb >= 1) return toFaDigits(gb.toFixed(1)) + ' گیگابایت'
  return toFaDigits(Math.round(n / (1024 ** 2))) + ' مگابایت'
}

function MonitoringCard() {
  const st = useAsync(() => api.get<any>('/api/admin/monitoring'), [])
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Activity className="size-5 text-brand" /> پایش سلامت سرور، دیسک و زمان پاسخ
        </h2>
        <Button variant="ghost" className="text-xs" onClick={st.reload}>به‌روزرسانی</Button>
      </div>
      <Async state={st}>
        {(m: any) => (
          <div className="space-y-3 text-sm">
            {m.disk?.warn && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-4 shrink-0" />
                <span>هشدار فضای دیسک: {toFaDigits(m.disk.used_pct)}٪ از دیسک پر شده است (آستانهٔ هشدار: {toFaDigits(m.disk.warn_pct)}٪ — فضای آزاد: {fmtBytes(m.disk.free_bytes)}).</span>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-xl bg-surface-2 p-3">
                <div className="text-xs text-muted">زمان پاسخ (میانگین / صدک ۹۵)</div>
                <div className="mt-1 font-bold">{toFaDigits(m.latency_ms?.avg ?? 0)} / {toFaDigits(m.latency_ms?.p95 ?? 0)} ms</div>
                <div className="text-xs text-muted">بیشینه: {toFaDigits(m.latency_ms?.max ?? 0)} ms · DB: {toFaDigits(m.db_latency_ms ?? 0)} ms</div>
              </div>
              <div className="rounded-xl bg-surface-2 p-3">
                <div className="text-xs text-muted">درخواست‌ها از زمان راه‌اندازی</div>
                <div className="mt-1 font-bold">{toFaDigits(m.requests_total ?? 0)} درخواست</div>
                <div className="text-xs text-muted">خطای ۵xx: {toFaDigits(m.errors_5xx ?? 0)} · ۴xx: {toFaDigits(m.errors_4xx ?? 0)}</div>
              </div>
              <div className="rounded-xl bg-surface-2 p-3">
                <div className="flex items-center gap-1 text-xs text-muted"><HardDrive className="size-3.5" /> فضای دیسک داده</div>
                {m.disk ? (
                  <>
                    <div className="mt-1 font-bold">{toFaDigits(m.disk.used_pct)}٪ مصرف‌شده</div>
                    <div className="text-xs text-muted">آزاد: {fmtBytes(m.disk.free_bytes)} از {fmtBytes(m.disk.total_bytes)}</div>
                  </>
                ) : (
                  <div className="mt-1 text-xs text-muted">فضای ابری (مدیریت‌شده)</div>
                )}
              </div>
              <div className="rounded-xl bg-surface-2 p-3">
                <div className="text-xs text-muted">زمان‌بند و تبدیل PDF</div>
                <div className="mt-1 font-bold">{m.server_pdf ? `سرور (${m.server_pdf})` : 'مرورگر (pdf.js)'}</div>
                <div className="text-xs text-muted">آخرین تجمیع: {m.maintenance_last?.rollup_until ? toFaDigits(m.maintenance_last.rollup_until) : '—'}</div>
              </div>
            </div>
            {m.recent_errors?.length > 0 && (
              <div className="rounded-xl border border-line p-3">
                <div className="mb-2 text-xs font-bold text-red-600 dark:text-red-400">خطاهای ۵xx اخیر سرور ({toFaDigits(m.recent_errors.length)})</div>
                <div className="max-h-40 space-y-1 overflow-auto text-xs" dir="ltr">
                  {m.recent_errors.map((e: any, idx: number) => (
                    <div key={idx} className="flex flex-wrap gap-2 border-b border-line/50 pb-1 last:border-0">
                      <span className="text-muted">{e.at.slice(0, 19).replace('T', ' ')}</span>
                      <span className="font-mono font-semibold">{e.method} {e.path}</span>
                      <span className="text-red-600 dark:text-red-400">[{e.status}] {e.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Async>
    </Card>
  )
}

function Form({ initial, isSuper, reload }: { initial: S; isSuper: boolean; reload: () => void }) {
  const [s, setS] = useState<S>(initial)
  const [dirty, setDirty] = useState(false)
  const { run, busy } = useAction()
  useEffect(() => setS(initial), [initial])
  const set = (patch: S) => {
    setS((x) => ({ ...x, ...patch }))
    setDirty(true)
  }
  const save = async () => {
    if (await run(() => api.post('/api/admin/settings', s), 'تنظیمات ذخیره شد')) {
      setDirty(false)
      reload()
    }
  }
  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-5">
        <h2 className="text-lg font-bold">عمومی</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">نام سامانه</span>
            <Input value={s.site_name || ''} maxLength={60} onChange={(e) => set({ site_name: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">نام دانشگاه</span>
            <Input value={s.university_name || ''} maxLength={100} onChange={(e) => set({ university_name: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">حداکثر نشست هم‌زمان هر کاربر</span>
            <Input dir="ltr" type="number" min={1} max={20} value={s.max_sessions ?? 5} onChange={(e) => set({ max_sessions: Number(e.target.value) || 5 })} />
            <span className="mt-1 block text-xs text-muted">با ورود از دستگاه جدید، قدیمی‌ترین نشست‌های اضافه خارج می‌شوند (مقابله با اشتراک حساب).</span>
          </label>
          <label className="block">
            <span className="label">اعتبار پیش‌فرض کد خرید (ساعت)</span>
            <Input dir="ltr" type="number" min={1} max={24} value={s.default_code_ttl_hours ?? 24} onChange={(e) => set({ default_code_ttl_hours: Number(e.target.value) || 24 })} />
            <span className="mt-1 block text-xs text-muted">برای شماره‌های تازه اعمال می‌شود؛ تیم می‌تواند برای هر شماره تا سقف ۲۴ ساعت تغییرش دهد.</span>
          </label>
          <label className="block">
            <span className="label">روش ثبت‌نام دانشجویان</span>
            <Select
              value={s.registration_mode || 'open'}
              onChange={(e) => set({ registration_mode: e.target.value })}
              options={[
                { value: 'open', label: 'ثبت‌نام آزاد (هر شماره دانشجویی)' },
                { value: 'allowlist', label: 'فقط فهرست مجاز (CSV / کد فعال‌سازی)' }
              ]}
            />
            <span className="mt-1 block text-xs text-muted">در حالت فهرست مجاز، فهرست را در کارت «فهرست مجاز ثبت‌نام» پایین همین صفحه بارگذاری کنید.</span>
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Toggle checked={!!s.registration_open} onChange={(v) => set({ registration_open: v })} label="ثبت‌نام دانشجویان باز است" hint="در صورت بستن، فقط حساب‌های موجود می‌توانند وارد شوند." />
          <Toggle checked={!!s.guest_can_read_free} onChange={(v) => set({ guest_can_read_free: v })} label="مهمان‌ها شماره‌های رایگان را بخوانند" hint="بدون ورود به سامانه." />
          <Toggle checked={!!s.supervisor_can_approve} onChange={(v) => set({ supervisor_can_approve: v })} label="ناظر دانشکده مجوز تأیید انتشار دارد" hint="در غیر این صورت فقط مسئول نشریات تأیید می‌کند." />
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-lg font-bold">قابلیت‌های سامانه</h2>
        <p className="text-sm text-muted">
          {isSuper ? 'با خاموش کردن هر قابلیت، بخش مربوط برای همهٔ کاربران پنهان و مسیرهای API آن مسدود می‌شود. داده‌ها حذف نمی‌شوند.' : 'فقط سوپرادمین می‌تواند قابلیت‌ها را روشن یا خاموش کند.'}
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          {Object.entries(FEATURE_LABELS).map(([k, label]) => (
            <label key={k} className={`flex items-start gap-3 rounded-xl border border-line p-3 ${isSuper ? 'cursor-pointer' : 'opacity-70'}`}>
              <input
                type="checkbox"
                className="mt-1 size-4"
                disabled={!isSuper}
                checked={s.feature_flags?.[k] !== false}
                onChange={(e) => set({ feature_flags: { ...(s.feature_flags || {}), [k]: e.target.checked } })}
              />
              <span className="font-medium">{label}</span>
            </label>
          ))}
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-lg font-bold">قواعد بینش و امتیاز سلامت</h2>
        <p className="text-sm text-muted">آستانهٔ هشدارهای خودکار و وزن هر مؤلفه در امتیاز سلامت نشریه (امتیاز همیشه به ۰ تا ۱۰۰ نرمال می‌شود).</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {Object.entries(THRESHOLD_LABELS).map(([k, label]) => (
            <label key={k} className="block">
              <span className="label">{label}</span>
              <Input dir="ltr" type="number" min={0} step={k === 'overdue_factor' || k === 'slow_stage_factor' || k === 'irregular_cv' ? 0.1 : 1} value={s.insight_thresholds?.[k] ?? ''} onChange={(e) => set({ insight_thresholds: { ...(s.insight_thresholds || {}), [k]: Number(e.target.value) } })} />
            </label>
          ))}
        </div>
        <h3 className="font-bold">وزن مؤلفه‌های امتیاز سلامت</h3>
        <div className="grid gap-3 sm:grid-cols-5">
          {Object.entries(WEIGHT_LABELS).map(([k, label]) => (
            <label key={k} className="block">
              <span className="label">{label}</span>
              <Input dir="ltr" type="number" min={0} max={100} value={s.health_weights?.[k] ?? ''} onChange={(e) => set({ health_weights: { ...(s.health_weights || {}), [k]: Number(e.target.value) } })} />
            </label>
          ))}
        </div>
      </Card>

      {isSuper && (
        <Card className="space-y-4 p-5">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Sparkles className="size-5 text-brand" /> هوش مصنوعی (اختیاری)
          </h2>
          <p className="text-sm text-muted">
            سامانه بدون این بخش کامل کار می‌کند. با فعال‌سازی، متن تحلیلی و پاسخ به پرسش در صفحهٔ بینش‌ها در دسترس قرار می‌گیرد. هر سرویس سازگار با OpenAI Chat Completions پشتیبانی می‌شود.
          </p>
          <Toggle checked={!!s.ai_enabled} onChange={(v) => set({ ai_enabled: v })} label="فعال‌سازی لایهٔ هوش مصنوعی" />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">آدرس پایهٔ API</span>
              <Input dir="ltr" value={s.ai_base_url || ''} placeholder="https://api.openai.com/v1" onChange={(e) => set({ ai_base_url: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">مدل</span>
              <Input dir="ltr" value={s.ai_model || ''} placeholder="gpt-4o-mini" onChange={(e) => set({ ai_model: e.target.value })} />
            </label>
            <label className="block sm:col-span-2">
              <span className="label">کلید API</span>
              <Input
                dir="ltr"
                type="password"
                autoComplete="off"
                value={s.ai_api_key || ''}
                placeholder="sk-…"
                onChange={(e) => set({ ai_api_key: e.target.value })}
              />
              <span className="mt-1 block text-xs text-muted">کلید ذخیره‌شده فقط با چهار نویسهٔ آخر نمایش داده می‌شود؛ برای تغییر، کلید جدید را کامل وارد کنید.</span>
            </label>
            <label className="block">
              <span className="label">سقف درخواست ماهانه (۰ = نامحدود)</span>
              <Input dir="ltr" type="number" min={0} value={s.ai_monthly_call_limit ?? 0} onChange={(e) => set({ ai_monthly_call_limit: Number(e.target.value) || 0 })} />
            </label>
            <label className="block">
              <span className="label">مهلت هر درخواست (ثانیه، ۳ تا ۶۰)</span>
              <Input dir="ltr" type="number" min={3} max={60} value={s.ai_timeout_sec ?? 15} onChange={(e) => set({ ai_timeout_sec: Number(e.target.value) || 15 })} />
            </label>
          </div>
          {s.ai_status && (
            <div className="rounded-xl bg-surface-2 p-3 text-sm">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span>مصرف این ماه: <b>{toFaDigits(s.ai_status.usage.calls)}</b> درخواست{s.ai_status.limit ? <> از <b>{toFaDigits(s.ai_status.limit)}</b></> : null}</span>
                <span>توکن: <b>{toFaDigits(s.ai_status.usage.tokens)}</b></span>
                <span>خطا: <b>{toFaDigits(s.ai_status.usage.failures)}</b></span>
              </div>
              {s.ai_status.breaker_open && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">به‌دلیل چند خطای پیاپی، فراخوانی سرویس تا {faDate(s.ai_status.breaker_open_until, true)} موقتاً متوقف است (قطع‌کنندهٔ مدار).</p>
              )}
            </div>
          )}
        </Card>
      )}

      <div className="sticky bottom-4 flex justify-end">
        <Button disabled={busy || !dirty} onClick={save} className="shadow-lg">
          <Save className="size-4" /> ذخیرهٔ تنظیمات
        </Button>
      </div>
    </div>
  )
}

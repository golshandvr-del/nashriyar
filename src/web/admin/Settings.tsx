import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { api } from '../lib/api'
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
      <PageHeader title="تنظیمات نشریات" subtitle="ثبت‌نام، تأیید انتشار، کد خرید و قواعد بینش — تنظیمات فنی سامانه فقط در پنل طراح است" />
      <Async state={st}>{(d: any) => <Form initial={d.settings} reload={st.reload} />}</Async>
      <AllowlistCard />
    </div>
  )
}

function Form({ initial, reload }: { initial: S; reload: () => void }) {
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
        <div className="grid gap-3 md:grid-cols-2">
          <Toggle checked={!!s.registration_open} onChange={(v) => set({ registration_open: v })} label="ثبت‌نام دانشجویان باز است" hint="در صورت بستن، فقط حساب‌های موجود می‌توانند وارد شوند." />
          <Toggle checked={!!s.supervisor_can_approve} onChange={(v) => set({ supervisor_can_approve: v })} label="ناظر دانشکده مجوز تأیید انتشار دارد" hint="در غیر این صورت فقط مسئول نشریات تأیید می‌کند." />
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

      <div className="sticky bottom-4 flex justify-end">
        <Button disabled={busy || !dirty} onClick={save} className="shadow-lg">
          <Save className="size-4" /> ذخیرهٔ تنظیمات
        </Button>
      </div>
    </div>
  )
}

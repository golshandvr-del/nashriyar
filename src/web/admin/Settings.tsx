import { useEffect, useState } from 'react'
import { Save, Sparkles } from 'lucide-react'
import { api } from '../lib/api'
import { Async, Button, Card, Input, PageHeader, useAction, useAsync } from '../components/ui'

type S = Record<string, any>

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
    </div>
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
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Toggle checked={!!s.registration_open} onChange={(v) => set({ registration_open: v })} label="ثبت‌نام دانشجویان باز است" hint="در صورت بستن، فقط حساب‌های موجود می‌توانند وارد شوند." />
          <Toggle checked={!!s.guest_can_read_free} onChange={(v) => set({ guest_can_read_free: v })} label="مهمان‌ها شماره‌های رایگان را بخوانند" hint="بدون ورود به سامانه." />
          <Toggle checked={!!s.supervisor_can_approve} onChange={(v) => set({ supervisor_can_approve: v })} label="ناظر دانشکده مجوز تأیید انتشار دارد" hint="در غیر این صورت فقط مسئول نشریات تأیید می‌کند." />
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
          </div>
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

// /system/settings — technical settings owned by the developer console (ROADMAP phase 13):
// AI layer, feature flags, members-only reading, concurrent-session cap and maintenance mode.
// Saving needs sudo mode; the SudoProvider asks for password + TOTP when required.
import { useEffect, useState } from 'react'
import { BellRing, Fingerprint, Save, Sparkles, Wrench } from 'lucide-react'
import { api } from '../lib/api'
import { Async, Button, Card, Field, Input, PageHeader, PasswordInput, Select, Textarea, useAsync } from '../components/ui'
import { faDate, toFaDigits } from '../../shared/fa'
import { useSudo } from './lib'

type Data = {
  settings: Record<string, any>
  feature_flags: Record<string, boolean>
  feature_labels: Record<string, string>
  maintenance: { on: boolean; message: string; since?: string | null }
  ai_status: any
}

function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3">
      <input type="checkbox" className="mt-1 size-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  )
}

/** Live status of the outbound channels: configured, linked users, queue, and the Bale webhook path. */
function ChannelStatus() {
  const st = useAsync(() => api.get<any>('/api/channels/status'), [])
  if (!st.data) return null
  const d = st.data
  const names: Record<string, string> = { email: 'ایمیل', bale: 'بله', eitaa: 'ایتا' }
  return (
    <div className="rounded-xl bg-surface-2 p-3 text-sm leading-7">
      <div className="flex flex-wrap gap-x-6">
        {Object.entries(d.channels as Record<string, { on: boolean; linked: number }>).map(([k, v]) => (
          <span key={k}>
            {names[k] || k}: <b>{v.on ? 'فعال' : 'خاموش'}</b> · {toFaDigits(v.linked)} کاربر متصل
          </span>
        ))}
      </div>
      <div>
        صف ارسال: {toFaDigits(d.queue.pending)} در انتظار · {toFaDigits(d.queue.sent)} فرستاده · {toFaDigits(d.queue.failed)} ناموفق
      </div>
      {d.bale_webhook_path && (
        <p className="text-xs text-muted">
          وب‌هوک بله (اختیاری؛ بدون آن، کدهای اتصال در نگهداری دوره‌ای خوانده می‌شوند): <code dir="ltr">{(d.site_url || location.origin) + d.bale_webhook_path}</code>
        </p>
      )}
    </div>
  )
}

export default function SystemSettings() {
  const st = useAsync(() => api.get<Data>('/api/system/settings'), [])
  return (
    <div className="space-y-4">
      <PageHeader title="تنظیمات فنی" subtitle="هوش مصنوعی، قابلیت‌ها، نشست‌ها و حالت تعمیرات — ذخیره نیازمند تأیید دوبارهٔ هویت است" />
      <Async state={st}>{(d) => <Form data={d} reload={st.reload} />}</Async>
    </div>
  )
}

function Form({ data, reload }: { data: Data; reload: () => void }) {
  const { guard } = useSudo()
  const [s, setS] = useState(data.settings)
  const [flags, setFlags] = useState(data.feature_flags)
  const [maint, setMaint] = useState({ on: !!data.maintenance?.on, message: data.maintenance?.message || '' })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setS(data.settings)
    setFlags(data.feature_flags)
    setMaint({ on: !!data.maintenance?.on, message: data.maintenance?.message || '' })
  }, [data])
  const set = (p: Record<string, any>) => setS((x) => ({ ...x, ...p }))
  const save = async () => {
    setBusy(true)
    const r = await guard(() => api.post('/api/system/settings', { ...s, feature_flags: flags, maintenance: maint }), 'تنظیمات فنی ذخیره شد')
    setBusy(false)
    if (r) reload()
  }
  const ai = data.ai_status
  return (
    <div className="space-y-4">
      <Card title={<span className="flex items-center gap-2"><Wrench className="size-4" /> حالت تعمیرات</span>} className={maint.on ? 'border-amber-400' : undefined}>
        <div className="space-y-3">
          <Check
            checked={maint.on}
            onChange={(v) => setMaint({ ...maint, on: v })}
            label="فعال‌سازی حالت تعمیرات"
            hint="سایت برای همه (به‌جز پنل طراح) پیام تعمیرات نشان می‌دهد و درخواست‌های تغییر داده با ۵۰۳ رد می‌شوند."
          />
          <Field label="پیام سفارشی (اختیاری)">
            <Textarea rows={2} maxLength={300} value={maint.message} placeholder="سامانه در حال به‌روزرسانی است؛ تا دقایقی دیگر بازمی‌گردیم." onChange={(e) => setMaint({ ...maint, message: e.target.value })} />
          </Field>
          {data.maintenance?.on && data.maintenance.since && <p className="text-xs text-amber-700 dark:text-amber-300">فعال از {faDate(data.maintenance.since, true)}</p>}
        </div>
      </Card>

      <Card title="قابلیت‌های سامانه">
        <p className="mb-3 text-sm text-muted">با خاموش کردن هر قابلیت، بخش مربوط برای همه پنهان و مسیرهای API آن مسدود می‌شود. داده‌ها حذف نمی‌شوند.</p>
        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(data.feature_labels).map(([k, label]) => (
            <Check key={k} checked={flags[k] !== false} onChange={(v) => setFlags({ ...flags, [k]: v })} label={label} />
          ))}
        </div>
      </Card>

      <Card title="دسترسی و نشست‌ها">
        <div className="grid gap-3 md:grid-cols-2">
          <Check checked={!!s.guest_can_read_free} onChange={(v) => set({ guest_can_read_free: v })} label="مهمان‌ها شماره‌های رایگان را بخوانند" hint="خاموش = حالت فقط‌اعضا؛ خواندن نیازمند ورود است." />
          <Field label="حداکثر نشست هم‌زمان هر کاربر" hint="با ورود از دستگاه جدید، قدیمی‌ترین نشست‌های اضافه بسته می‌شوند (۱ تا ۲۰).">
            <Input dir="ltr" type="number" min={1} max={20} value={s.max_sessions ?? 5} onChange={(e) => set({ max_sessions: Number(e.target.value) || 5 })} />
          </Field>
        </div>
      </Card>

      <Card title={<span className="flex items-center gap-2"><Sparkles className="size-4 text-brand" /> هوش مصنوعی (اختیاری)</span>}>
        <div className="space-y-3">
          <p className="text-sm text-muted">سامانه بدون این بخش کامل کار می‌کند. هر سرویس سازگار با OpenAI Chat Completions پشتیبانی می‌شود.</p>
          <Check checked={!!s.ai_enabled} onChange={(v) => set({ ai_enabled: v })} label="فعال‌سازی لایهٔ هوش مصنوعی" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="آدرس پایهٔ API">
              <Input dir="ltr" value={s.ai_base_url || ''} placeholder="https://api.openai.com/v1" onChange={(e) => set({ ai_base_url: e.target.value })} />
            </Field>
            <Field label="مدل">
              <Input dir="ltr" value={s.ai_model || ''} placeholder="gpt-4o-mini" onChange={(e) => set({ ai_model: e.target.value })} />
            </Field>
            <Field label="مدل تبدیل متن به گفتار (TTS)" hint="سرویس سازگار با /audio/speech؛ off = خاموش (صدای مرورگر جایگزین می‌شود).">
              <Input dir="ltr" value={s.ai_tts_model || ''} placeholder="tts-1" onChange={(e) => set({ ai_tts_model: e.target.value })} />
            </Field>
            <Field label="صدای TTS">
              <Input dir="ltr" value={s.ai_tts_voice || ''} placeholder="alloy" onChange={(e) => set({ ai_tts_voice: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="کلید API" hint="کلید ذخیره‌شده فقط با چهار نویسهٔ آخر نمایش داده می‌شود؛ برای تغییر، کلید جدید را کامل وارد کنید.">
                <PasswordInput autoComplete="off" value={s.ai_api_key || ''} placeholder="sk-…" onChange={(e) => set({ ai_api_key: e.target.value })} />
              </Field>
            </div>
            <Field label="سقف درخواست ماهانه (۰ = نامحدود)">
              <Input dir="ltr" type="number" min={0} value={s.ai_monthly_call_limit ?? 0} onChange={(e) => set({ ai_monthly_call_limit: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="مهلت هر درخواست (ثانیه، ۳ تا ۶۰)">
              <Input dir="ltr" type="number" min={3} max={60} value={s.ai_timeout_sec ?? 15} onChange={(e) => set({ ai_timeout_sec: Number(e.target.value) || 15 })} />
            </Field>
          </div>
          {ai?.usage && (
            <div className="rounded-xl bg-surface-2 p-3 text-sm">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span>
                  مصرف این ماه: <b>{toFaDigits(ai.usage.calls)}</b> درخواست{ai.limit ? <> از <b>{toFaDigits(ai.limit)}</b></> : null}
                </span>
                <span>توکن: <b>{toFaDigits(ai.usage.tokens)}</b></span>
                <span>خطا: <b>{toFaDigits(ai.usage.failures)}</b></span>
              </div>
              {ai.breaker_open && <p className="mt-2 text-xs text-danger">به‌دلیل خطاهای پیاپی، فراخوانی تا {faDate(ai.breaker_open_until, true)} موقتاً متوقف است.</p>}
            </div>
          )}
        </div>
      </Card>

      <Card title={<span className="flex items-center gap-2"><BellRing className="size-4 text-brand" /> اعلان در ایمیل، بله و ایتا (اختیاری)</span>}>
        <div className="space-y-3">
          <p className="text-sm text-muted">هر کانالی که پیکربندی شود، در تنظیمات حساب کاربران برای اتصال نمایش داده می‌شود. خالی گذاشتن کلید = خاموش.</p>
          <Field label="نشانی عمومی سایت (برای پیوند پیام‌ها)" hint="مثل https://nashriyar.example.ac.ir — خالی = نشانی درخواست">
            <Input dir="ltr" value={s.site_url || ''} placeholder="https://…" onChange={(e) => set({ site_url: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ایمیل — نشانی API ارسال" hint="سازگار با Resend: POST JSON {from,to,subject,text,html}">
              <Input dir="ltr" value={s.notify_email_url || ''} placeholder="https://api.resend.com/emails" onChange={(e) => set({ notify_email_url: e.target.value })} />
            </Field>
            <Field label="ایمیل — فرستنده">
              <Input dir="ltr" value={s.notify_email_from || ''} placeholder="Nashriyar <no-reply@…>" onChange={(e) => set({ notify_email_from: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="ایمیل — کلید API">
                <PasswordInput autoComplete="off" value={s.notify_email_key || ''} onChange={(e) => set({ notify_email_key: e.target.value })} />
              </Field>
            </div>
            <Field label="بله — توکن ربات" hint="از @botfather در بله">
              <PasswordInput autoComplete="off" value={s.notify_bale_token || ''} onChange={(e) => set({ notify_bale_token: e.target.value })} />
            </Field>
            <Field label="بله — نام کاربری ربات">
              <Input dir="ltr" value={s.notify_bale_bot || ''} placeholder="nashriyar_bot" onChange={(e) => set({ notify_bale_bot: e.target.value })} />
            </Field>
            <Field label="بله — نشانی API (اختیاری)">
              <Input dir="ltr" value={s.notify_bale_api || ''} placeholder="https://tapi.bale.ai" onChange={(e) => set({ notify_bale_api: e.target.value })} />
            </Field>
            <Field label="ایتا — توکن ایتایار">
              <PasswordInput autoComplete="off" value={s.notify_eitaa_token || ''} onChange={(e) => set({ notify_eitaa_token: e.target.value })} />
            </Field>
            <Field label="ایتا — نشانی API (اختیاری)">
              <Input dir="ltr" value={s.notify_eitaa_api || ''} placeholder="https://eitaayar.ir/api" onChange={(e) => set({ notify_eitaa_api: e.target.value })} />
            </Field>
          </div>
          <ChannelStatus />
        </div>
      </Card>

      <Card title={<span className="flex items-center gap-2"><Fingerprint className="size-4 text-brand" /> ورود پیامکی و ورود با حساب دانشگاه (اختیاری)</span>}>
        <div className="space-y-3">
          <p className="text-sm text-muted">ورود با رمز عبور همیشه برقرار است. کاربران پس از تأیید شمارهٔ همراه یا اتصال حساب دانشگاه از تنظیمات حساب، می‌توانند از این روش‌ها استفاده کنند.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="سرویس پیامک" hint="http: درگاه عمومی POST JSON {to,text,sender}؛ kavenegar: API کاوه‌نگار">
              <Select value={s.sms_provider || 'off'} onChange={(e) => set({ sms_provider: e.target.value })} options={[{ value: 'off', label: 'خاموش' }, { value: 'http', label: 'درگاه HTTP عمومی' }, { value: 'kavenegar', label: 'کاوه‌نگار' }]} />
            </Field>
            <Field label="پیامک — نشانی API" hint="برای kavenegar اختیاری (پیش‌فرض https://api.kavenegar.com)">
              <Input dir="ltr" value={s.sms_api_url || ''} placeholder="https://sms.example.ir/send" onChange={(e) => set({ sms_api_url: e.target.value })} />
            </Field>
            <Field label="پیامک — کلید API">
              <PasswordInput autoComplete="off" value={s.sms_api_key || ''} onChange={(e) => set({ sms_api_key: e.target.value })} />
            </Field>
            <Field label="پیامک — شمارهٔ فرستنده (اختیاری)">
              <Input dir="ltr" value={s.sms_sender || ''} placeholder="10004346" onChange={(e) => set({ sms_sender: e.target.value })} />
            </Field>
            <Field label="کاوه‌نگار — نام قالب تأیید (اختیاری)" hint="با قالب، کد از مسیر verify/lookup فرستاده می‌شود">
              <Input dir="ltr" value={s.sms_template || ''} placeholder="nashriyar-otp" onChange={(e) => set({ sms_template: e.target.value })} />
            </Field>
          </div>
          <hr className="border-line" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="SSO — نشانی صادرکننده (issuer)" hint="سرور OpenID Connect دانشگاه؛ باید /.well-known/openid-configuration داشته باشد. خالی = خاموش">
                <Input dir="ltr" value={s.sso_issuer || ''} placeholder="https://sso.university.ac.ir/realms/students" onChange={(e) => set({ sso_issuer: e.target.value })} />
              </Field>
            </div>
            <Field label="SSO — شناسهٔ کلاینت (client_id)">
              <Input dir="ltr" value={s.sso_client_id || ''} onChange={(e) => set({ sso_client_id: e.target.value })} />
            </Field>
            <Field label="SSO — رمز کلاینت (اختیاری؛ کلاینت عمومی با PKCE)">
              <PasswordInput autoComplete="off" value={s.sso_client_secret || ''} onChange={(e) => set({ sso_client_secret: e.target.value })} />
            </Field>
            <Field label="SSO — متن دکمه">
              <Input value={s.sso_label || ''} placeholder="ورود با حساب دانشگاه" onChange={(e) => set({ sso_label: e.target.value })} />
            </Field>
            <Field label="SSO — scope">
              <Input dir="ltr" value={s.sso_scopes || ''} placeholder="openid profile email" onChange={(e) => set({ sso_scopes: e.target.value })} />
            </Field>
            <Field label="SSO — claim شمارهٔ دانشجویی" hint="مثل student_number یا preferred_username">
              <Input dir="ltr" value={s.sso_student_claim || ''} placeholder="student_number" onChange={(e) => set({ sso_student_claim: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <Check checked={s.sso_auto_create === true} onChange={(v) => set({ sso_auto_create: v })} label="ساخت خودکار حساب دانشجو در اولین ورود SSO" hint="خاموش: فقط حساب‌های موجود (با همان شماره دانشجویی) یا حساب‌های متصل‌شده وارد می‌شوند." />
            </div>
          </div>
          <p className="text-xs text-muted">
            نشانی بازگشت (redirect URI) برای ثبت در سرور SSO: <code dir="ltr">{(s.site_url || location.origin).replace(/\/+$/, '') + '/api/signin/sso/callback'}</code>
          </p>
        </div>
      </Card>

      <div className="sticky bottom-4 flex justify-end">
        <Button loading={busy} icon={<Save className="size-4" />} onClick={save} className="shadow-lg">
          ذخیرهٔ تنظیمات فنی
        </Button>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Building2, KeyRound, LogIn, MessageSquareText } from 'lucide-react'
import { api } from '../lib/api'
import { usePublicSettings } from '../lib/features'
import { useAuth } from '../lib/auth'
import { Button, Card, ErrorBox, Field, Input, PasswordInput } from '../components/ui'
import { Illustration } from '../components/Illustration'

/** Demo accounts (only listed when the database was created with `--seed`, i.e. settings.demo_mode). */
const DEMO_ACCOUNTS: { role: string; username: string; password: string }[] = [
  { role: 'مسئول نشریات دانشگاه', username: 'officer', password: 'officer1234' },
  { role: 'مدیر کل سامانه', username: 'admin', password: 'admin1234' },
  { role: 'مدیرمسئول «فرامتن»', username: 'pub1-director', password: 'team1234' },
  { role: 'سردبیر «فرامتن»', username: 'pub1-editor', password: 'team1234' },
  { role: 'صاحب امتیاز «فرامتن»', username: 'pub1-holder', password: 'team1234' },
  { role: 'ناظر دانشکده', username: 'supervisor', password: 'super1234' },
  { role: 'تحلیلگر آمار', username: 'analyst', password: 'analyst1234' },
  { role: 'دانشجو', username: '40012345', password: 'student1234' }
]

/** Only allow same-site relative redirects (prevents open redirect). */
export function safeNext(n: string | null, fallback = '/') {
  return n && n.startsWith('/') && !n.startsWith('//') ? n : fallback
}

/** Messages for `/login?sso_error=…` (set by /api/signin/sso/callback). */
const SSO_ERRORS: Record<string, string> = {
  sso_off: 'ورود با حساب دانشگاه فعال نیست.',
  provider_unreachable: 'سامانهٔ ورود دانشگاه در دسترس نیست؛ کمی بعد دوباره تلاش کنید.',
  provider_denied: 'ورود در سامانهٔ دانشگاه لغو شد.',
  bad_request: 'پاسخ سامانهٔ دانشگاه ناقص بود.',
  state_invalid: 'مهلت ورود تمام شد؛ دوباره تلاش کنید.',
  token_invalid: 'هویت تأیید نشد؛ دوباره تلاش کنید.',
  no_account: 'حسابی با این مشخصات در نشریار نیست؛ ابتدا ثبت‌نام کنید و سپس از تنظیمات حساب، حساب دانشگاه را متصل کنید.',
  link_from_settings: 'این شماره دانشجویی به حساب کارکنان تعلق دارد؛ با رمز عبور وارد شوید و از تنظیمات حساب اتصال را انجام دهید.',
  account_inactive: 'حساب شما غیرفعال شده است.',
  login_required: 'برای اتصال حساب دانشگاه ابتدا وارد شوید.'
}

/** Sign in with a one-time code sent by SMS to the account's verified mobile number (ROADMAP phase 19). */
function OtpLogin({ next }: { next: string | null }) {
  const { refresh } = useAuth()
  const nav = useNavigate()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const send = async (e?: FormEvent) => {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ sent_to: string }>('/api/signin/otp/send', { phone: phone.trim() })
      setSent(r.sent_to)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const verify = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ home: string }>('/api/signin/otp/verify', { phone: phone.trim(), code: code.trim() })
      await refresh()
      nav(safeNext(next, r.home), { replace: true })
    } catch (err: any) {
      setError(err.message)
      setCode('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={sent ? verify : send} className="space-y-4">
      <Field label="شمارهٔ همراه تأییدشده" hint="شماره‌ای که در تنظیمات حساب تأیید کرده‌اید.">
        <Input dir="ltr" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09123456789" required disabled={!!sent} autoFocus />
      </Field>
      {sent && (
        <Field label="کد شش‌رقمی پیامک‌شده" hint={`اگر این شماره به حسابی متصل باشد، کد به ${sent} فرستاده شد (۵ دقیقه اعتبار).`}>
          <Input dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9۰-۹]{6}" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
        </Field>
      )}
      {error && <ErrorBox error={error} />}
      <Button type="submit" className="w-full" loading={busy}>
        {sent ? 'ورود' : 'دریافت کد'}
      </Button>
      {sent && (
        <button type="button" className="w-full text-center text-xs text-muted hover:text-brand" onClick={() => { setSent(null); setCode('') }}>
          تغییر شماره یا ارسال دوباره
        </button>
      )}
    </form>
  )
}

export default function Login() {
  const { user, login, home } = useAuth()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  // Second step: shown after the server answers `totp_required` for a staff account with 2FA enabled.
  const [needTotp, setNeedTotp] = useState(false)
  const [totp, setTotp] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const demo = usePublicSettings()?.demo_mode === true
  // ROADMAP phase 19: alternative sign-in methods configured by the developer console
  const [methods, setMethods] = useState<{ otp: boolean; sso: { label: string } | null } | null>(null)
  const [mode, setMode] = useState<'password' | 'otp'>('password')
  useEffect(() => {
    api.get<{ otp: boolean; sso: { label: string } | null }>('/api/signin/methods').then(setMethods).catch(() => setMethods(null))
  }, [])
  const ssoError = sp.get('sso_error')

  if (user) return <Navigate to={safeNext(sp.get('next'), home)} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const h = await login(username.trim(), password, needTotp ? totp.trim() : undefined)
      nav(safeNext(sp.get('next'), h), { replace: true })
    } catch (err: any) {
      if (err?.code === 'totp_required') {
        setNeedTotp(true)
        setError(null)
        return
      }
      if (err?.code === 'totp_invalid') setTotp('')
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto mt-6 max-w-sm">
      {/* ROADMAP phase 16: «نقش جهان» banner with girih tiles above the sign-in card */}
      <div id="login-banner" className="motif-girih frame-arch bg-banner mb-3 flex h-28 items-end justify-center overflow-hidden rounded-2xl pb-1" style={{ ['--motif-color' as any]: '#ffffff', ['--motif-opacity' as any]: 0.14, ['--frame-color' as any]: '#ffffff', ['--frame-opacity' as any]: 0.5 }} aria-hidden="true">
        <Illustration name="square" className="h-20 w-44 text-white opacity-80" />
      </div>
      <Card className="tile-corners">
        <h1 className="mb-1 flex items-center gap-2 text-xl font-extrabold">
          <LogIn className="size-6 text-brand" /> ورود به نشریار
        </h1>
        <p className="mb-5 text-sm text-muted">دانشجویان با شماره دانشجویی؛ تیم‌ها و مدیران با نام کاربری.</p>
        {ssoError && <ErrorBox error={SSO_ERRORS[ssoError] || 'ورود با حساب دانشگاه ناموفق بود.'} />}
        {methods?.sso && (
          <a
            id="sso-login"
            href={`/api/signin/sso/start${sp.get('next') ? `?next=${encodeURIComponent(safeNext(sp.get('next'), '/'))}` : ''}`}
            className="btn-ghost mb-4 mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-line py-2 font-bold"
          >
            <Building2 className="size-4 text-brand" /> {methods.sso.label}
          </a>
        )}
        {methods?.otp && (
          <div role="tablist" aria-label="روش ورود" className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1 text-sm">
            <button type="button" role="tab" aria-selected={mode === 'password'} className={`rounded-lg py-1.5 ${mode === 'password' ? 'bg-surface font-bold shadow-sm' : 'text-muted'}`} onClick={() => setMode('password')}>
              <KeyRound className="ml-1 inline size-4" /> رمز عبور
            </button>
            <button type="button" role="tab" aria-selected={mode === 'otp'} className={`rounded-lg py-1.5 ${mode === 'otp' ? 'bg-surface font-bold shadow-sm' : 'text-muted'}`} onClick={() => setMode('otp')}>
              <MessageSquareText className="ml-1 inline size-4" /> کد پیامکی
            </button>
          </div>
        )}
        {mode === 'otp' && methods?.otp ? (
          <OtpLogin next={sp.get('next')} />
        ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="شماره دانشجویی یا نام کاربری">
            <Input dir="ltr" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          </Field>
          <Field label="رمز عبور">
            <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {needTotp && (
            <Field label="کد شش‌رقمی برنامهٔ احراز هویت" hint="کد فعلی را از Google Authenticator یا برنامهٔ مشابه وارد کنید.">
              <Input
                dir="ltr"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                pattern="[0-9۰-۹]{6}"
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
                required
                autoFocus
              />
            </Field>
          )}
          {error && <ErrorBox error={error} />}
          <Button type="submit" className="w-full" loading={busy}>
            ورود
          </Button>
        </form>
        )}
        <p className="mt-3 text-center text-xs">
          <Link to="/recover" className="text-muted hover:text-brand">
            رمز عبور را فراموش کرده‌اید؟
          </Link>
        </p>
        <p className="mt-4 text-center text-sm text-muted">
          حساب ندارید؟{' '}
          <Link to={`/register${sp.get('next') ? `?next=${encodeURIComponent(sp.get('next')!)}` : ''}`} className="font-bold text-brand">
            ثبت‌نام دانشجو
          </Link>
        </p>
      </Card>
      <p className="mt-4 text-center text-xs leading-6 text-muted">رمز عبور حساب‌های تیم نشریه توسط مسئول نشریات صادر می‌شود و در اولین ورود باید تغییر کند.</p>
      {demo && (
        <Card className="mt-4">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-bold">
            <KeyRound className="size-4 text-brand" /> حساب‌های نمایشی
          </h2>
          <p className="mb-3 text-xs text-muted">این فهرست فقط در نسخهٔ نمایشی دیده می‌شود. برای پر شدن فرم روی هر حساب بزنید.</p>
          <ul className="divide-y divide-line text-xs">
            {DEMO_ACCOUNTS.map((a) => (
              <li key={a.username}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 py-2 text-right hover:text-brand"
                  onClick={() => {
                    setUsername(a.username)
                    setPassword(a.password)
                    setNeedTotp(false)
                  }}
                >
                  <span className="font-medium">{a.role}</span>
                  <span dir="ltr" className="font-mono text-muted">
                    {a.username} / {a.password}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

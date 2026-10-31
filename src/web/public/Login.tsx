import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { KeyRound, LogIn } from 'lucide-react'
import { usePublicSettings } from '../lib/features'
import { useAuth } from '../lib/auth'
import { Button, Card, ErrorBox, Field, Input, PasswordInput } from '../components/ui'

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
      <Card>
        <h1 className="mb-1 flex items-center gap-2 text-xl font-extrabold">
          <LogIn className="size-6 text-brand" /> ورود به نشریار
        </h1>
        <p className="mb-5 text-sm text-muted">دانشجویان با شماره دانشجویی؛ تیم‌ها و مدیران با نام کاربری.</p>
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

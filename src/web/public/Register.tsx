import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { GraduationCap, UserPlus, UsersRound } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { toEnDigits } from '../lib/format'
import { Button, Card, ErrorBox, Field, Input, PasswordInput, Select } from '../components/ui'
import { safeNext } from './Login'
import JoinPicker, { EMPTY_JOIN } from './JoinPicker'
import type { JoinValue } from './JoinPicker'
import { cx } from '../lib/format'

export default function Register() {
  const { user, refresh } = useAuth()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const [f, setF] = useState({ student_number: '', display_name: '', faculty_id: '', password: '', password2: '', accept_terms: false, secret: '' })
  const [faculties, setFaculties] = useState<{ id: string; name: string }[]>([])
  const [open, setOpen] = useState(true)
  const [mode, setMode] = useState<'open' | 'allowlist'>('open')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // ROADMAP phase 15: two-path registration — plain student, or student + request to join a publication team
  const [path, setPath] = useState<'student' | 'team'>(sp.get('path') === 'team' ? 'team' : 'student')
  const [join, setJoin] = useState<JoinValue>(EMPTY_JOIN)

  useEffect(() => {
    api.get('/api/public/categories').then((r) => setFaculties(r.faculties || [])).catch(() => {})
    api.get('/api/public/settings').then((r) => (setOpen(r.registration_open !== false), setMode(r.registration_mode === 'allowlist' ? 'allowlist' : 'open'))).catch(() => {})
  }, [])

  if (user) return <Navigate to={safeNext(sp.get('next'))} replace />

  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (f.password !== f.password2) return setError('تکرار رمز عبور یکسان نیست')
    if (f.password.length < 8) return setError('رمز عبور باید حداقل ۸ نویسه باشد')
    if (path === 'team' && !join.publication_id) return setError('نشریه‌ای را که می‌خواهید عضو تیمش شوید انتخاب کنید')
    setBusy(true)
    try {
      const r = await api.post<{ home: string; request: string | null; join_error: string | null }>('/api/auth/register', {
        student_number: toEnDigits(f.student_number.trim()),
        display_name: f.display_name.trim(),
        faculty_id: f.faculty_id || null,
        password: f.password,
        accept_terms: f.accept_terms,
        ...(mode === 'allowlist' && f.secret.trim() ? { secret: toEnDigits(f.secret.trim()) } : {}),
        ...(path === 'team' ? { join: { publication_id: join.publication_id, role_name: join.role_name || undefined, message: join.message.trim() || undefined } } : {})
      })
      await refresh()
      if (path === 'team') nav(r.join_error ? `/settings?tab=membership&join_error=${encodeURIComponent(r.join_error)}` : '/settings?tab=membership', { replace: true })
      else nav(safeNext(sp.get('next')), { replace: true })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cx('mx-auto mt-6', path === 'team' ? 'max-w-lg' : 'max-w-sm')}>
      <Card>
        <h1 className="mb-4 flex items-center gap-2 text-xl font-extrabold">
          <UserPlus className="size-6 text-brand" /> ثبت‌نام
        </h1>
        <div className="mb-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label="نوع ثبت‌نام">
          {([
            ['student', 'دانشجو', 'خواندن، دنبال‌کردن و خرید', GraduationCap],
            ['team', 'عضویت در تیم نشریه', 'درخواست همکاری با یک نشریه', UsersRound]
          ] as const).map(([k, label, hint, Icon]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={path === k}
              id={`register-path-${k}`}
              onClick={() => setPath(k)}
              className={cx('flex flex-col items-center gap-1 rounded-xl border p-3 text-center text-sm', path === k ? 'border-brand bg-brand-soft font-bold text-brand' : 'border-line hover:bg-surface-2')}
            >
              <Icon className="size-5" />
              {label}
              <span className="text-[11px] font-normal text-muted">{hint}</span>
            </button>
          ))}
        </div>
        {!open ? (
          <ErrorBox error="ثبت‌نام در حال حاضر بسته است." />
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Field label="شماره دانشجویی" hint="فقط رقم؛ نام کاربری شما همین شماره خواهد بود.">
              <Input dir="ltr" inputMode="numeric" value={f.student_number} onChange={set('student_number')} required autoFocus />
            </Field>
            {mode === 'allowlist' && (
              <Field label="کد ملی یا کد فعال‌سازی" hint="ثبت‌نام فقط برای دانشجویان فهرست مجاز باز است؛ اگر مسئول نشریات برای شما کد فعال‌سازی صادر کرده آن را وارد کنید، وگرنه کد ملی.">
                <Input dir="ltr" value={f.secret} onChange={set('secret')} autoComplete="off" maxLength={40} />
              </Field>
            )}
            <Field label="نام و نام خانوادگی">
              <Input value={f.display_name} onChange={set('display_name')} required minLength={2} maxLength={80} />
            </Field>
            <Field label="دانشکده (اختیاری)">
              <Select value={f.faculty_id} onChange={set('faculty_id')} placeholder="انتخاب کنید" options={faculties.map((x) => ({ value: x.id, label: x.name }))} />
            </Field>
            <Field label="رمز عبور" hint="حداقل ۸ نویسه">
              <PasswordInput strength autoComplete="new-password" value={f.password} onChange={set('password')} required />
            </Field>
            <Field label="تکرار رمز عبور">
              <PasswordInput autoComplete="new-password" value={f.password2} onChange={set('password2')} required />
            </Field>
            {path === 'team' && (
              <fieldset className="space-y-2 rounded-2xl border border-line p-3">
                <legend className="px-1 text-sm font-bold">نشریه و سمت درخواستی</legend>
                <JoinPicker value={join} onChange={setJoin} />
                <p className="text-xs text-muted">پس از تأیید مدیرمسئول یا سردبیر، حساب شما به تیم نشریه متصل می‌شود و اعلان دریافت می‌کنید.</p>
              </fieldset>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 accent-[var(--brand)]" checked={f.accept_terms} onChange={set('accept_terms')} />
              <span>قوانین استفاده را می‌پذیرم؛ از جمله اینکه بازنشر محتوای پولی نشریات مجاز نیست و صفحات با شماره دانشجویی من نشان‌گذاری می‌شوند.</span>
            </label>
            {error && <ErrorBox error={error} />}
            <Button type="submit" className="w-full" loading={busy} disabled={!f.accept_terms}>
              {path === 'team' ? 'ساخت حساب و ارسال درخواست' : 'ساخت حساب'}
            </Button>
          </form>
        )}
        <p className="mt-4 text-center text-sm text-muted">
          حساب دارید؟{' '}
          <Link to="/login" className="font-bold text-brand">
            ورود
          </Link>
        </p>
      </Card>
    </div>
  )
}

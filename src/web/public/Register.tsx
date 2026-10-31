import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { UserPlus } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { toEnDigits } from '../lib/format'
import { Button, Card, ErrorBox, Field, Input, PasswordInput, Select } from '../components/ui'
import { safeNext } from './Login'

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
    setBusy(true)
    try {
      await api.post('/api/auth/register', {
        student_number: toEnDigits(f.student_number.trim()),
        display_name: f.display_name.trim(),
        faculty_id: f.faculty_id || null,
        password: f.password,
        accept_terms: f.accept_terms,
        ...(mode === 'allowlist' && f.secret.trim() ? { secret: toEnDigits(f.secret.trim()) } : {})
      })
      await refresh()
      nav(safeNext(sp.get('next')), { replace: true })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto mt-6 max-w-sm">
      <Card>
        <h1 className="mb-4 flex items-center gap-2 text-xl font-extrabold">
          <UserPlus className="size-6 text-brand" /> ثبت‌نام دانشجو
        </h1>
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
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 accent-[var(--brand)]" checked={f.accept_terms} onChange={set('accept_terms')} />
              <span>قوانین استفاده را می‌پذیرم؛ از جمله اینکه بازنشر محتوای پولی نشریات مجاز نیست و صفحات با شماره دانشجویی من نشان‌گذاری می‌شوند.</span>
            </label>
            {error && <ErrorBox error={error} />}
            <Button type="submit" className="w-full" loading={busy} disabled={!f.accept_terms}>
              ساخت حساب
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

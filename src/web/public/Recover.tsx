import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { api } from '../lib/api'
import { toEnDigits } from '../lib/format'
import { Button, Card, ErrorBox, Field, Input, PasswordInput } from '../components/ui'

/** Self-service password recovery with the one-time recovery code (ROADMAP phase 5; SMS later). */
export default function Recover() {
  const [f, setF] = useState({ username: '', code: '', next: '', next2: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (f.next !== f.next2) return setError('تکرار رمز جدید یکسان نیست')
    if (f.next.length < 8) return setError('رمز جدید باید حداقل ۸ نویسه باشد')
    setBusy(true)
    try {
      await api.post('/api/auth/recover', { username: toEnDigits(f.username.trim()), code: toEnDigits(f.code.trim()), next: f.next })
      setDone(true)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto mt-6 max-w-sm">
      <Card>
        <h1 className="mb-1 flex items-center gap-2 text-xl font-extrabold">
          <KeyRound className="size-6 text-brand" /> بازیابی رمز عبور
        </h1>
        {done ? (
          <div className="space-y-4">
            <p className="text-sm leading-7">رمز عبور شما تغییر کرد و همهٔ نشست‌های قبلی بسته شد. کد بازیابی مصرف شد؛ پس از ورود از «تنظیمات حساب» یک کد تازه بسازید.</p>
            <Link to="/login" className="btn btn-primary w-full">
              ورود
            </Link>
          </div>
        ) : (
          <>
            <p className="mb-5 text-sm leading-6 text-muted">
              کد بازیابی‌ای را که قبلاً در «تنظیمات حساب» ساخته‌اید وارد کنید. اگر کد ندارید، از مسئول نشریات بخواهید رمز شما را بازنشانی کند.
            </p>
            <form onSubmit={submit} className="space-y-4">
              <Field label="شماره دانشجویی یا نام کاربری">
                <Input dir="ltr" autoComplete="username" value={f.username} onChange={set('username')} required autoFocus />
              </Field>
              <Field label="کد بازیابی" hint="مثل ABCD-EFGH-JKLM">
                <Input dir="ltr" autoComplete="off" value={f.code} onChange={set('code')} required maxLength={40} />
              </Field>
              <Field label="رمز جدید" hint="حداقل ۸ نویسه">
                <PasswordInput strength autoComplete="new-password" value={f.next} onChange={set('next')} required />
              </Field>
              <Field label="تکرار رمز جدید">
                <PasswordInput autoComplete="new-password" value={f.next2} onChange={set('next2')} required />
              </Field>
              {error && <ErrorBox error={error} />}
              <Button type="submit" className="w-full" loading={busy}>
                تعیین رمز جدید
              </Button>
            </form>
          </>
        )}
        <p className="mt-4 text-center text-sm text-muted">
          <Link to="/login" className="font-bold text-brand">
            بازگشت به ورود
          </Link>
        </p>
      </Card>
    </div>
  )
}

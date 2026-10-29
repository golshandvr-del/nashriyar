import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Button, Card, ErrorBox, Field, Input } from '../components/ui'

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
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={safeNext(sp.get('next'), home)} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const h = await login(username.trim(), password)
      nav(safeNext(sp.get('next'), h), { replace: true })
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
          <LogIn className="size-6 text-brand" /> ورود به نشریار
        </h1>
        <p className="mb-5 text-sm text-muted">دانشجویان با شماره دانشجویی؛ تیم‌ها و مدیران با نام کاربری.</p>
        <form onSubmit={submit} className="space-y-4">
          <Field label="شماره دانشجویی یا نام کاربری">
            <Input dir="ltr" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          </Field>
          <Field label="رمز عبور">
            <Input dir="ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && <ErrorBox error={error} />}
          <Button type="submit" className="w-full" loading={busy}>
            ورود
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted">
          حساب ندارید؟{' '}
          <Link to={`/register${sp.get('next') ? `?next=${encodeURIComponent(sp.get('next')!)}` : ''}`} className="font-bold text-brand">
            ثبت‌نام دانشجو
          </Link>
        </p>
      </Card>
      <p className="mt-4 text-center text-xs leading-6 text-muted">رمز عبور حساب‌های تیم نشریه توسط مسئول نشریات صادر می‌شود و در اولین ورود باید تغییر کند.</p>
    </div>
  )
}

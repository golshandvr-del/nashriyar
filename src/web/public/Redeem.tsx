import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { CheckCircle2, KeyRound } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { faDate, toEnDigits, toFaDigits } from '../lib/format'
import { Button, Card, ErrorBox, Field, Input } from '../components/ui'
import { Cover } from '../components/cards'

interface Checked {
  issue: { id: string; title: string; number: number; cover_key: string | null; publication_title: string }
  expires_at: string
}

/** Formats raw input into NSH-XXXX-XXXX while typing. */
function formatCode(raw: string) {
  const s = toEnDigits(raw).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^NSH/, '').slice(0, 8)
  return 'NSH-' + (s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s)
}

export default function Redeem() {
  const { user, loading } = useAuth()
  const nav = useNavigate()
  // A printed/shared QR opens /redeem#code=… — the fragment never reaches the server or its logs.
  const [code, setCode] = useState(() => {
    const m = /(?:^|[#&])code=([A-Za-z0-9-]{4,40})/.exec(window.location.hash)
    return m ? m[1].toUpperCase() : 'NSH-'
  })
  const [checked, setChecked] = useState<Checked | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!loading && !user) return <Navigate to="/login?next=/redeem" replace />

  const check = async () => {
    setBusy(true)
    setError(null)
    try {
      setChecked(await api.post<Checked>('/api/me/codes/check', { code }))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  const redeem = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ issue_id: string }>('/api/me/codes/redeem', { code })
      setDone(r.issue_id)
    } catch (e: any) {
      setError(e.message)
      setChecked(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 flex items-center gap-2 text-xl font-extrabold">
        <KeyRound className="size-6 text-brand" /> ثبت کد خرید
      </h1>
      {done ? (
        <Card className="text-center">
          <CheckCircle2 className="mx-auto size-12 text-ok" />
          <p className="mt-3 font-bold">شماره به کتابخانهٔ شما اضافه شد</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={() => nav(`/read/${done}`)}>شروع خواندن</Button>
            <Link to="/library">
              <Button variant="ghost">کتابخانه</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="mb-4 text-sm leading-7 text-muted">
            کدی را که پس از پرداخت از تیم نشریه گرفته‌اید وارد کنید. هر کد فقط یک بار و تا حداکثر ۲۴ ساعت پس از صدور قابل استفاده است و ممکن است فقط برای شماره دانشجویی شما صادر شده باشد.
          </p>
          <Field label="کد خرید">
            <Input
              dir="ltr"
              className="text-center font-mono text-lg tracking-widest"
              value={code}
              onChange={(e) => {
                setCode(formatCode(e.target.value))
                setChecked(null)
                setError(null)
              }}
              placeholder="NSH-XXXX-XXXX"
              autoComplete="off"
              inputMode="text"
              aria-label="کد خرید"
            />
          </Field>
          {error && (
            <div className="mt-3">
              <ErrorBox error={error} />
            </div>
          )}
          {checked ? (
            <div className="mt-4 rounded-xl border border-line p-3">
              <div className="flex gap-3">
                <Cover src={checked.issue.cover_key} title={checked.issue.title} className="w-16 shrink-0" />
                <div className="text-sm">
                  <div className="text-muted">{checked.issue.publication_title}</div>
                  <div className="font-bold">{checked.issue.title}</div>
                  <div className="text-xs text-muted">شمارهٔ {toFaDigits(checked.issue.number)}</div>
                  <div className="mt-1 text-xs text-muted">اعتبار کد تا {faDate(checked.expires_at, true)}</div>
                </div>
              </div>
              <Button className="mt-3 w-full" loading={busy} onClick={redeem}>
                تأیید و افزودن به کتابخانه
              </Button>
            </div>
          ) : (
            <Button className="mt-4 w-full" loading={busy} disabled={code.replace(/[^A-Z0-9]/g, '').length < 11} onClick={check}>
              بررسی کد
            </Button>
          )}
        </Card>
      )}
    </div>
  )
}

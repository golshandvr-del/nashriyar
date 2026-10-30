import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Award, CheckCircle2, ShieldCheck } from 'lucide-react'
import { api } from '../lib/api'
import { faDate, formatNumber, toEnDigits } from '../lib/format'
import { Async, Button, Card, Input, useAsync } from '../components/ui'

interface Cert {
  verify_code: string
  roles: string
  issued_at: string
  full_name: string
  issue_title: string | null
  issue_number: number
  publication_title: string
}

/** Public verification of a contributor certificate (/verify and /verify/:code). */
export default function Verify() {
  const { code } = useParams()
  const nav = useNavigate()
  const [q, setQ] = useState(code || '')
  const st = useAsync(() => (code ? api.get<{ certificate: Cert }>(`/api/public/certificates/${encodeURIComponent(code)}`) : Promise.resolve(null as any)), [code])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const c = toEnDigits(q.trim()).toUpperCase()
    if (c) nav(`/verify/${encodeURIComponent(c)}`)
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <header className="text-center">
        <ShieldCheck className="mx-auto size-10 text-brand" />
        <h1 className="mt-2 text-xl font-extrabold">استعلام گواهی همکاری</h1>
        <p className="text-sm text-muted">کد درج‌شده روی گواهی را وارد کنید تا اصالت آن بررسی شود.</p>
      </header>
      <form onSubmit={submit} className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="مثلاً CERT-XXXX" dir="ltr" className="text-center tracking-widest" aria-label="کد گواهی" />
        <Button type="submit">استعلام</Button>
      </form>
      {code && (
        <Async state={st}>
          {(d) =>
            d?.certificate ? (
              <Card className="border-emerald-400">
                <div className="flex items-center gap-2 text-ok">
                  <CheckCircle2 className="size-5" />
                  <span className="font-bold">این گواهی معتبر است</span>
                </div>
                <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted">نام همکار</dt>
                  <dd className="font-bold">{d.certificate.full_name}</dd>
                  <dt className="text-muted">نقش</dt>
                  <dd>{d.certificate.roles}</dd>
                  <dt className="text-muted">نشریه</dt>
                  <dd>{d.certificate.publication_title}</dd>
                  <dt className="text-muted">شماره</dt>
                  <dd>
                    شمارهٔ {formatNumber(d.certificate.issue_number)}
                    {d.certificate.issue_title ? ` — ${d.certificate.issue_title}` : ''}
                  </dd>
                  <dt className="text-muted">تاریخ صدور</dt>
                  <dd>{faDate(d.certificate.issued_at)}</dd>
                  <dt className="text-muted">کد</dt>
                  <dd dir="ltr" className="text-left font-mono">
                    {d.certificate.verify_code}
                  </dd>
                </dl>
                <Award className="mt-4 size-8 text-amber-500" aria-hidden />
              </Card>
            ) : null
          }
        </Async>
      )}
    </div>
  )
}

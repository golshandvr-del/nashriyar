// /system/database — version, applied migrations, table sizes and VACUUM / ANALYZE (sudo) (ROADMAP phase 13).
import { useState } from 'react'
import { Database, Gauge } from 'lucide-react'
import { api } from '../lib/api'
import { Async, Badge, Button, Card, PageHeader, useAsync, useToast } from '../components/ui'
import { faDate, toFaDigits } from '../../shared/fa'
import { fmtBytes, useSudo } from './lib'

type D = {
  version: { app: string; commit: string | null; node: string; started_at: string } | null
  db_file_bytes: number | null
  migrations: { name: string; applied_at: string | null }[]
  tables: { name: string; rows: number }[]
  ops_available: boolean
}

export default function SystemDatabase() {
  const st = useAsync(() => api.get<D>('/api/system/db'), [])
  const { guard } = useSudo()
  const { confirm } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [last, setLast] = useState<string | null>(null)
  const run = async (op: 'vacuum' | 'analyze') => {
    if (op === 'vacuum' && !(await confirm('VACUUM پایگاه داده را بازسازی می‌کند و در این مدت نوشتن قفل می‌شود. ادامه می‌دهید؟', { okLabel: 'اجرا' }))) return
    setBusy(op)
    const r = await guard(() => api.post<{ ms: number; before_bytes: number | null; after_bytes: number | null }>(`/api/system/db/${op}`, {}))
    setBusy(null)
    if (r) {
      setLast(`${op.toUpperCase()} در ${toFaDigits(r.ms)} میلی‌ثانیه انجام شد${r.before_bytes != null ? ` · ${fmtBytes(r.before_bytes)} ← ${fmtBytes(r.after_bytes)}` : ''}`)
      st.reload()
    }
  }
  return (
    <div className="space-y-4">
      <PageHeader title="پایگاه داده" subtitle="مایگریشن‌ها، اندازهٔ جداول و نگهداری" />
      <Async state={st}>
        {(d) => {
          const pending = d.migrations.filter((m) => !m.applied_at).length
          return (
            <>
              <Card title={<span className="flex items-center gap-2"><Database className="size-4" /> وضعیت</span>}>
                <dl className="grid gap-3 text-sm sm:grid-cols-4">
                  <div><dt className="text-xs text-muted">نسخهٔ برنامه</dt><dd dir="ltr" className="text-start font-mono">{d.version?.app ?? '—'}</dd></div>
                  <div><dt className="text-xs text-muted">کامیت</dt><dd dir="ltr" className="text-start font-mono">{d.version?.commit ? d.version.commit.slice(0, 10) : '—'}</dd></div>
                  <div><dt className="text-xs text-muted">حجم فایل پایگاه داده</dt><dd>{d.db_file_bytes != null ? fmtBytes(d.db_file_bytes) : 'ابری (D1)'}</dd></div>
                  <div><dt className="text-xs text-muted">مایگریشن‌ها</dt><dd>{toFaDigits(d.migrations.length - pending)} از {toFaDigits(d.migrations.length)} {pending ? <Badge tone="danger">{toFaDigits(pending)} اجرانشده</Badge> : <Badge tone="ok">به‌روز</Badge>}</dd></div>
                </dl>
                {d.ops_available && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button variant="ghost" loading={busy === 'analyze'} icon={<Gauge className="size-4" />} onClick={() => run('analyze')}>
                      ANALYZE (به‌روزرسانی آمار پرس‌وجو)
                    </Button>
                    <Button variant="ghost" loading={busy === 'vacuum'} onClick={() => run('vacuum')}>
                      VACUUM (فشرده‌سازی)
                    </Button>
                    {last && <span className="text-xs text-ok">{last}</span>}
                  </div>
                )}
              </Card>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="مایگریشن‌ها">
                  <ul className="divide-y divide-line text-sm">
                    {d.migrations.map((m) => (
                      <li key={m.name} className="flex items-center justify-between gap-2 py-1.5">
                        <span dir="ltr" className="font-mono text-xs">{m.name}</span>
                        {m.applied_at ? <span className="text-xs text-muted">{faDate(m.applied_at, true)}</span> : <Badge tone="danger">اجرانشده</Badge>}
                      </li>
                    ))}
                  </ul>
                </Card>
                <Card title={`جداول (${toFaDigits(d.tables.length)})`}>
                  <ul className="max-h-[28rem] divide-y divide-line overflow-auto text-sm">
                    {d.tables.map((t) => (
                      <li key={t.name} className="flex items-center justify-between gap-2 py-1.5">
                        <span dir="ltr" className="font-mono text-xs">{t.name}</span>
                        <span className="text-xs">{toFaDigits(t.rows.toLocaleString('en-US'))} ردیف</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            </>
          )
        }}
      </Async>
    </div>
  )
}

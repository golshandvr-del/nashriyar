// /system/backups — list, run now, restore test and secure download (sudo) of server backups (ROADMAP phase 13).
import { useState } from 'react'
import { DatabaseBackup, Download, Play, ShieldCheck } from 'lucide-react'
import { api } from '../lib/api'
import { Async, Badge, Button, Card, Empty, PageHeader, useAsync } from '../components/ui'
import { faDate, toFaDigits } from '../../shared/fa'
import { fmtBytes, useSudo } from './lib'

type B = { name: string; size: number; mtime: string; kind: 'db' | 'files' }

export default function SystemBackups() {
  const st = useAsync(() => api.get<{ available: boolean; backups: B[]; restore_test: any }>('/api/system/backups'), [])
  const { guard } = useSudo()
  const [busy, setBusy] = useState<string | null>(null)
  const act = async (key: string, fn: () => Promise<any>, ok: string) => {
    setBusy(key)
    const r = await guard(fn, ok)
    setBusy(null)
    if (r) st.reload()
  }
  /** Downloads through fetch so a sudo_required answer can trigger re-authentication instead of a broken file. */
  const download = async (name: string) => {
    setBusy('dl:' + name)
    await guard(async () => {
      const res = await fetch(`/api/system/backups/${encodeURIComponent(name)}/download`, { credentials: 'same-origin' })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        const { ApiError } = await import('../lib/api')
        throw new ApiError(res.status, d?.error || 'دانلود ناموفق بود', d?.code)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      return true
    })
    setBusy(null)
  }
  return (
    <div className="space-y-4">
      <PageHeader title="پشتیبان‌ها" subtitle="نسخهٔ پشتیبان پایگاه داده و فایل‌ها، آزمون بازیابی و دانلود امن" />
      <Async state={st}>
        {(d) =>
          !d.available ? (
            <Empty title="پشتیبان‌گیری در این محیط در دسترس نیست" hint="این بخش فقط روی سرور خودمیزبان (Node) کار می‌کند؛ روی Cloudflare، پشتیبان D1 از داشبورد Cloudflare (Time Travel) انجام می‌شود." />
          ) : (
            <>
              <Card title="اجرای فوری">
                <div className="flex flex-wrap gap-2">
                  <Button loading={busy === 'db'} icon={<DatabaseBackup className="size-4" />} onClick={() => act('db', () => api.post('/api/system/backups/run', { kind: 'db' }), 'پشتیبان پایگاه داده ساخته شد')}>
                    پشتیبان پایگاه داده
                  </Button>
                  <Button variant="ghost" loading={busy === 'files'} icon={<Play className="size-4" />} onClick={() => act('files', () => api.post('/api/system/backups/run', { kind: 'files' }), 'پشتیبان فایل‌ها ساخته شد')}>
                    پشتیبان فایل‌ها
                  </Button>
                  <Button variant="ghost" loading={busy === 'rt'} icon={<ShieldCheck className="size-4" />} onClick={() => act('rt', () => api.post('/api/system/backups/restore-test', {}), 'آزمون بازیابی اجرا شد')}>
                    آزمون بازیابی آخرین پشتیبان
                  </Button>
                </div>
                {d.restore_test && (
                  <p className="mt-3 text-sm">
                    آخرین آزمون بازیابی: {d.restore_test.ok ? <Badge tone="ok">موفق</Badge> : <Badge tone="danger">ناموفق</Badge>} <span className="text-muted">{faDate(d.restore_test.at, true)}</span>
                    {d.restore_test.backup && (
                      <span dir="ltr" className="ms-2 font-mono text-xs text-muted">
                        {d.restore_test.backup}
                      </span>
                    )}
                  </p>
                )}
              </Card>
              <Card title={`فایل‌های پشتیبان (${toFaDigits(d.backups.length)})`}>
                {d.backups.length === 0 ? (
                  <Empty title="هنوز پشتیبانی ساخته نشده است" />
                ) : (
                  <ul className="divide-y divide-line text-sm">
                    {d.backups.map((b) => (
                      <li key={b.name} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <div className="min-w-0">
                          <div dir="ltr" className="truncate text-start font-mono text-xs">
                            {b.name}
                          </div>
                          <div className="text-xs text-muted">
                            <Badge tone={b.kind === 'db' ? 'info' : 'muted'}>{b.kind === 'db' ? 'پایگاه داده' : 'فایل‌ها'}</Badge> {fmtBytes(b.size)} · {faDate(b.mtime, true)}
                          </div>
                        </div>
                        <Button variant="ghost" loading={busy === 'dl:' + b.name} icon={<Download className="size-4" />} onClick={() => download(b.name)}>
                          دانلود
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          )
        }
      </Async>
    </div>
  )
}

// /system — server health: response times, 5xx errors, disk, PDF renderer, scheduler, version (moved from the officer's settings).
import { AlertTriangle, HardDrive, RefreshCw } from 'lucide-react'
import { api } from '../lib/api'
import { Async, Button, Card, PageHeader, Stat, useAsync } from '../components/ui'
import { faDate, toFaDigits } from '../../shared/fa'
import { fmtBytes } from './lib'

export default function SystemHealth() {
  const st = useAsync(() => api.get<any>('/api/system/health'), [])
  return (
    <div className="space-y-4">
      <PageHeader
        title="سلامت سرور"
        subtitle="زمان پاسخ، خطاهای اخیر، فضای دیسک و نسخهٔ در حال اجرا"
        actions={
          <Button variant="ghost" icon={<RefreshCw className="size-4" />} onClick={st.reload}>
            به‌روزرسانی
          </Button>
        }
      />
      <Async state={st}>
        {(m) => (
          <>
            {m.disk?.warn && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300" role="alert">
                <AlertTriangle className="size-4 shrink-0" />
                هشدار فضای دیسک: {toFaDigits(m.disk.used_pct)}٪ پر شده است (آستانه {toFaDigits(m.disk.warn_pct)}٪ — آزاد: {fmtBytes(m.disk.free_bytes)}).
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="زمان پاسخ (میانگین / صدک ۹۵)" value={`${toFaDigits(m.latency_ms?.avg ?? 0)} / ${toFaDigits(m.latency_ms?.p95 ?? 0)} ms`} sub={`بیشینه ${toFaDigits(m.latency_ms?.max ?? 0)} ms · پایگاه داده ${toFaDigits(m.db_latency_ms ?? 0)} ms`} />
              <Stat label="درخواست‌ها از راه‌اندازی" value={toFaDigits(m.requests_total ?? 0)} sub={`۵xx: ${toFaDigits(m.errors_5xx ?? 0)} · ۴xx: ${toFaDigits(m.errors_4xx ?? 0)}`} tone={m.errors_5xx ? 'danger' : 'ok'} />
              <Stat
                label="فضای دیسک داده"
                value={m.disk ? `${toFaDigits(m.disk.used_pct)}٪` : 'ابری'}
                sub={m.disk ? `آزاد ${fmtBytes(m.disk.free_bytes)} از ${fmtBytes(m.disk.total_bytes)}` : 'فضای مدیریت‌شده'}
                tone={m.disk?.warn ? 'danger' : undefined}
              />
              <Stat label="تبدیل PDF" value={m.server_pdf ? `سرور (${m.server_pdf})` : 'مرورگر'} sub={`آخرین نگهداری: ${m.maintenance_last?.at ? faDate(m.maintenance_last.at, true) : '—'}`} />
            </div>
            <Card title={<span className="flex items-center gap-2"><HardDrive className="size-4" /> نسخه</span>}>
              {m.version ? (
                <dl className="grid gap-2 text-sm sm:grid-cols-4">
                  <div><dt className="text-xs text-muted">نسخهٔ برنامه</dt><dd dir="ltr" className="font-mono">{m.version.app}</dd></div>
                  <div><dt className="text-xs text-muted">کامیت</dt><dd dir="ltr" className="font-mono">{m.version.commit ? String(m.version.commit).slice(0, 10) : '—'}</dd></div>
                  <div><dt className="text-xs text-muted">Node</dt><dd dir="ltr" className="font-mono">{m.version.node}</dd></div>
                  <div><dt className="text-xs text-muted">راه‌اندازی</dt><dd>{faDate(m.version.started_at, true)}</dd></div>
                </dl>
              ) : (
                <p className="text-sm text-muted">اجرا روی Cloudflare — اطلاعات نسخهٔ سرور در دسترس نیست.</p>
              )}
            </Card>
            <Card title={`خطاهای ۵xx اخیر (${toFaDigits(m.recent_errors?.length ?? 0)})`}>
              {m.recent_errors?.length ? (
                <div className="max-h-80 space-y-1 overflow-auto text-xs" dir="ltr">
                  {m.recent_errors.map((e: any, i: number) => (
                    <div key={i} className="flex flex-wrap gap-2 border-b border-line/50 pb-1 last:border-0">
                      <span className="text-muted">{String(e.at).slice(0, 19).replace('T', ' ')}</span>
                      <span className="font-mono font-semibold">
                        {e.method} {e.path}
                      </span>
                      <span className="text-danger">
                        [{e.status}] {e.message}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ok">از زمان راه‌اندازی هیچ خطای ۵xx ثبت نشده است.</p>
              )}
            </Card>
          </>
        )}
      </Async>
    </div>
  )
}

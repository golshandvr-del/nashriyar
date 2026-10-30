import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowDown, ArrowUp, CheckSquare, Info, Lightbulb, ShieldAlert } from 'lucide-react'
import { api, qs } from '../lib/api'
import { delta, formatNumber, formatToman, toFaDigits } from '../lib/format'
import { Async, Card, PageHeader, Stat, useAsync } from '../components/ui'
import { RangePicker, defaultRange } from '../team/Stats'
import { useAdminRole } from './Layout'

const KPIS: { key: string; label: string; money?: boolean }[] = [
  { key: 'published', label: 'شمارهٔ منتشرشده' },
  { key: 'pages', label: 'صفحهٔ منتشرشده' },
  { key: 'started', label: 'شمارهٔ آغازشده' },
  { key: 'active_publications', label: 'نشریهٔ فعال' },
  { key: 'views', label: 'بازدید کل' },
  { key: 'reads', label: 'خواندن شماره' },
  { key: 'post_views', label: 'بازدید پست' },
  { key: 'new_followers', label: 'دنبال‌کنندهٔ جدید' },
  { key: 'digital_sold', label: 'فروش دیجیتال' },
  { key: 'revenue_digital', label: 'درآمد دیجیتال', money: true },
  { key: 'print_sold', label: 'فروش چاپی (نسخه)' },
  { key: 'new_students', label: 'دانشجوی تازه‌ثبت‌نام' }
]

export function DeltaBadge({ cur, prev }: { cur: number; prev: number }) {
  const d = delta(cur, prev)
  if (d === null) return <span className="text-xs text-muted">بدون دادهٔ دورهٔ قبل</span>
  const up = d >= 0
  return (
    <span className={up ? 'inline-flex items-center gap-0.5 text-xs text-ok' : 'inline-flex items-center gap-0.5 text-xs text-danger'}>
      {up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
      {toFaDigits(Math.abs(Math.round(d)))}٪ نسبت به دورهٔ قبل
    </span>
  )
}

export const SEVERITY_ICON = { critical: AlertTriangle, warning: AlertTriangle, info: Info, positive: Lightbulb } as Record<string, typeof Info>
export const SEVERITY_CLS: Record<string, string> = {
  critical: 'border-danger/40 bg-danger/5 text-danger',
  warning: 'border-amber-400/50 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  info: 'border-line bg-surface-2 text-ink',
  positive: 'border-ok/40 bg-ok/5 text-ok'
}

export default function AdminOverview() {
  const { role } = useAdminRole()
  const [range, setRange] = useState(defaultRange('30d'))
  const base = useAsync(() => Promise.all([api.get('/api/admin/overview'), api.get('/api/analytics/insights')]), [])
  const sum = useAsync(() => api.get(`/api/analytics/summary${qs({ from: range.from, to: range.to })}`), [range.from, range.to])

  return (
    <div className="space-y-6">
      <PageHeader title="نمای کلی" subtitle="وضعیت کلی نشریات دانشگاه در یک نگاه" actions={<RangePicker value={range} onChange={setRange} />} />

      <Async state={base}>
        {([o, ins]: any) => (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="نشریات" value={formatNumber(o.counts.publications || 0)} sub={`${toFaDigits(o.counts.active || 0)} فعال · ${toFaDigits(o.counts.suspended || 0)} تعلیق`} />
              <Stat label="شماره‌های منتشرشده" value={formatNumber(o.issues.published || 0)} />
              <Stat label="در حال تولید" value={formatNumber(o.issues.in_progress || 0)} />
              <Stat label="دانشجویان عضو" value={formatNumber(o.students || 0)} />
            </div>
            <div className="flex flex-wrap gap-3">
              {role !== 'analyst' && (
                <Link to="/admin/approvals" className="card flex items-center gap-3 p-3 hover:border-brand">
                  <CheckSquare className="size-5 text-brand" />
                  <span className="text-sm">
                    <b>{toFaDigits(o.issues.awaiting || 0)}</b> شماره در انتظار تأیید انتشار
                  </span>
                </Link>
              )}
              {(role === 'super_admin' || role === 'pub_officer') && (
                <Link to="/admin/moderation?tab=reports" className="card flex items-center gap-3 p-3 hover:border-brand">
                  <ShieldAlert className="size-5 text-danger" />
                  <span className="text-sm">
                    <b>{toFaDigits(o.pendingReports || 0)}</b> گزارش تخلف باز
                  </span>
                </Link>
              )}
            </div>
            {!!ins.items.length && (
              <Card title="مهم‌ترین بینش‌ها" action={<Link to="/admin/insights" className="text-sm text-brand">همه</Link>}>
                <ul className="space-y-2">
                  {ins.items.slice(0, 5).map((it: any) => {
                    const Icon = SEVERITY_ICON[it.severity] || Info
                    return (
                      <li key={it.key} className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${SEVERITY_CLS[it.severity] || SEVERITY_CLS.info}`}>
                        <Icon className="mt-0.5 size-4 shrink-0" />
                        <div className="min-w-0">
                          <div className="font-bold">{it.title}</div>
                          <div className="text-xs opacity-80">{it.detail}</div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </Card>
            )}
          </>
        )}
      </Async>

      <Async state={sum}>
        {(s: any) => (
          <Card title="شاخص‌های کلیدی بازهٔ انتخابی">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {KPIS.map((k) => {
                const cur = Number(s.current[k.key] || 0)
                const prev = Number(s.previous[k.key] || 0)
                return (
                  <div key={k.key} className="rounded-xl border border-line p-3">
                    <div className="text-xs text-muted">{k.label}</div>
                    <div className="mt-1 text-xl font-extrabold">{k.money ? formatToman(cur) : formatNumber(cur)}</div>
                    <DeltaBadge cur={cur} prev={prev} />
                  </div>
                )
              })}
            </div>
          </Card>
        )}
      </Async>
    </div>
  )
}

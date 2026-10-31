// Unified publication dossier tabs (ROADMAP phase 14): licence, statistics and sales for a single publication.
// Reuses the scoped analytics endpoints (scorecard + sales filtered by ?publication=) so numbers match the dashboards.
import { api } from '../lib/api'
import { faDate, faMonthLabel, formatNumber, formatToman, toFaDigits } from '../lib/format'
import { Async, Badge, Button, Card, Empty, Progress, useAsync } from '../components/ui'
import { Chart } from '../components/Chart'

const DAY = 86400000

const KPI_FA: Record<string, string> = {
  published: 'شمارهٔ منتشرشده',
  pages: 'صفحهٔ منتشرشده',
  views: 'بازدید',
  reads: 'مطالعهٔ کامل شماره',
  new_followers: 'دنبال‌کنندهٔ جدید',
  posts: 'پست اکسپلور',
  digital_sold: 'فروش دیجیتال',
  print_sold: 'فروش چاپی',
  members: 'اعضای فعال تیم'
}
const HEALTH_FA: Record<string, [string, number]> = {
  regularity: ['نظم انتشار', 35],
  activity: ['فعالیت تولید', 20],
  audience: ['مخاطب', 20],
  explore: ['اکسپلور', 15],
  hygiene: ['نظم اداری', 10]
}

/** Licence status: valid / expiring (< 60 days) / expired / unknown, with validity elapsed. */
export function licenseState(p: any) {
  const exp = p.license_expires_at ? new Date(p.license_expires_at).getTime() : NaN
  const iss = p.license_issued_at ? new Date(p.license_issued_at).getTime() : NaN
  if (!Number.isFinite(exp)) return { key: 'unknown' as const, label: 'نامشخص', tone: 'muted' as const, days: null as number | null, elapsed: null as number | null }
  const days = Math.ceil((exp - Date.now()) / DAY)
  const elapsed = Number.isFinite(iss) && exp > iss ? Math.round(((Date.now() - iss) / (exp - iss)) * 100) : null
  if (days < 0) return { key: 'expired' as const, label: 'منقضی شده', tone: 'danger' as const, days, elapsed }
  if (days <= 60) return { key: 'expiring' as const, label: 'رو به انقضا', tone: 'warn' as const, days, elapsed }
  return { key: 'valid' as const, label: 'معتبر', tone: 'ok' as const, days, elapsed }
}

export function LicenseTab({ p, roles, admin, onEdit }: { p: any; roles: any[]; admin: boolean; onEdit: () => void }) {
  const s = licenseState(p)
  const holders = roles.filter((r) => r.role === 'license_holder')
  const current = holders.find((r) => !r.ended_at)
  return (
    <div className="space-y-4">
      <Card
        title="وضعیت مجوز"
        action={admin ? <Button variant="ghost" onClick={onEdit}>ثبت تمدید / ویرایش</Button> : undefined}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={s.tone}>{s.label}</Badge>
          {s.days != null && (
            <span className="text-sm text-muted">
              {s.days >= 0 ? `${toFaDigits(s.days)} روز تا پایان اعتبار` : `${toFaDigits(-s.days)} روز از پایان اعتبار گذشته`}
            </span>
          )}
        </div>
        {s.elapsed != null && (
          <div className="mt-3">
            <Progress value={Math.min(100, Math.max(0, s.elapsed))} />
            <div className="mt-1 flex justify-between text-xs text-muted">
              <span>صدور: {faDate(p.license_issued_at)}</span>
              <span>انقضا: {faDate(p.license_expires_at)}</span>
            </div>
          </div>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted">شمارهٔ مجوز</dt>
          <dd>{p.license_number ? toFaDigits(p.license_number) : '—'}</dd>
          <dt className="text-muted">تاریخ صدور</dt>
          <dd>{faDate(p.license_issued_at)}</dd>
          <dt className="text-muted">تاریخ انقضا</dt>
          <dd>{faDate(p.license_expires_at)}</dd>
          <dt className="text-muted">صاحب امتیاز فعلی</dt>
          <dd>{current?.display_name || '—'}</dd>
        </dl>
        {s.key === 'expired' && <p className="mt-3 rounded-xl bg-danger/10 p-3 text-sm text-danger">انتشار بدون مجوز معتبر مجاز نیست؛ پیگیری تمدید را در اولویت قرار دهید.</p>}
        {s.key === 'unknown' && <p className="mt-3 rounded-xl bg-surface-2 p-3 text-sm text-muted">تاریخ انقضای مجوز ثبت نشده است؛ برای یادآوری خودکار در «کارهای امروز» آن را ثبت کنید.</p>}
      </Card>
      <Card title="سابقهٔ صاحبان امتیاز">
        {!holders.length ? (
          <Empty title="سابقه‌ای ثبت نشده" />
        ) : (
          <ol className="space-y-2 text-sm">
            {holders.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 border-b border-line pb-2 last:border-0">
                <span>{r.display_name}</span>
                <span className="text-xs text-muted">{faDate(r.started_at)} ← {r.ended_at ? faDate(r.ended_at) : 'اکنون'}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  )
}

export function StatsTab({ pubId }: { pubId: string }) {
  const st = useAsync(() => api.get(`/api/analytics/scorecard/${pubId}`), [pubId])
  return (
    <Async state={st}>
      {(d: any) => (
        <div className="space-y-4">
          <p className="text-xs text-muted">بازهٔ {faDate(d.from)} تا {faDate(d.to)} · مقایسه با میانگین {toFaDigits(d.n_publications)} نشریهٔ فعال</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {d.kpis.map((k: any) => {
              const up = k.value >= k.average
              return (
                <div key={k.key} className="card p-3">
                  <div className="text-xs text-muted">{KPI_FA[k.key] || k.key}</div>
                  <div className="text-xl font-extrabold">{formatNumber(k.value)}</div>
                  <div className={up ? 'text-xs text-ok' : 'text-xs text-danger'}>میانگین: {formatNumber(k.average)}</div>
                </div>
              )
            })}
          </div>
          {d.health && (
            <Card title={`سلامت نشریه: ${toFaDigits(d.health.score)} از ۱۰۰`}>
              <div className="space-y-2">
                {Object.entries(HEALTH_FA).map(([k, [label, max]]) => (
                  <div key={k}>
                    <div className="flex justify-between text-xs"><span>{label}</span><span className="text-muted">{toFaDigits(d.health.parts?.[k] ?? 0)} / {toFaDigits(max)}</span></div>
                    <Progress value={((d.health.parts?.[k] ?? 0) / max) * 100} />
                  </div>
                ))}
              </div>
              {!!d.health.reasons?.length && (
                <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-muted">
                  {d.health.reasons.map((r: string, i: number) => <li key={i}>{toFaDigits(r)}</li>)}
                </ul>
              )}
            </Card>
          )}
          <Card title="شماره‌های منتشرشده در بازه">
            {!d.issues.length ? (
              <Empty title="در این بازه شماره‌ای منتشر نشده" />
            ) : (
              <Chart
                height={260}
                csvName="publication-issues"
                option={{
                  tooltip: { trigger: 'axis' },
                  legend: { data: ['مطالعهٔ کامل', 'روز تولید'] },
                  xAxis: { type: 'category', data: d.issues.map((i: any) => `شمارهٔ ${toFaDigits(i.number)}`) },
                  yAxis: [{ type: 'value' }, { type: 'value', splitLine: { show: false } }],
                  series: [
                    { name: 'مطالعهٔ کامل', type: 'bar', data: d.issues.map((i: any) => Number(i.reads || 0)) },
                    { name: 'روز تولید', type: 'line', yAxisIndex: 1, data: d.issues.map((i: any) => i.cycle_days) }
                  ]
                }}
              />
            )}
          </Card>
        </div>
      )}
    </Async>
  )
}

export function SalesTab({ pubId }: { pubId: string }) {
  const st = useAsync(() => api.get(`/api/analytics/sales?publication=${encodeURIComponent(pubId)}`), [pubId])
  return (
    <Async state={st}>
      {(d: any) => {
        const t = d.totals || {}
        const kpi = (label: string, value: string) => (
          <div className="card p-3"><div className="text-xs text-muted">{label}</div><div className="text-lg font-extrabold">{value}</div></div>
        )
        return (
          <div className="space-y-4">
            <p className="text-xs text-muted">بازهٔ {faDate(d.from)} تا {faDate(d.to)}</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {kpi('کد ساخته‌شده', formatNumber(t.codes_created || 0))}
              {kpi('کد استفاده‌شده', formatNumber(t.codes_redeemed || 0))}
              {kpi('درآمد دیجیتال', formatToman(t.revenue_digital || 0))}
              {kpi('فروش چاپی (نسخه)', formatNumber(t.print_sold || 0))}
            </div>
            <Card title="روند ماهانهٔ فروش دیجیتال">
              {!d.monthly?.length ? (
                <Empty title="فروشی در این بازه ثبت نشده" />
              ) : (
                <Chart
                  height={240}
                  csvName="publication-sales"
                  option={{
                    xAxis: { type: 'category', data: d.monthly.map((m: any) => faMonthLabel(m.m)) },
                    yAxis: { type: 'value' },
                    series: [{ name: 'فروش', type: 'bar', data: d.monthly.map((m: any) => Number(m.sold || 0)) }]
                  }}
                />
              )}
            </Card>
            <Card title="فروش به تفکیک شماره">
              {!d.byIssue?.length ? (
                <Empty title="شمارهٔ پولی منتشرشده‌ای ندارد" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted">
                      <tr><th className="p-2 text-right">شماره</th><th className="p-2">کد استفاده‌شده</th><th className="p-2">درآمد</th><th className="p-2">چاپی</th></tr>
                    </thead>
                    <tbody>
                      {d.byIssue.map((i: any) => (
                        <tr key={i.id} className="border-t border-line">
                          <td className="p-2">{toFaDigits(i.number)} · {i.title}</td>
                          <td className="p-2 text-center">{formatNumber(i.codes_redeemed)}</td>
                          <td className="whitespace-nowrap p-2 text-center">{formatToman(i.revenue_digital)}</td>
                          <td className="p-2 text-center">{formatNumber(i.print_sold)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        )
      }}
    </Async>
  )
}

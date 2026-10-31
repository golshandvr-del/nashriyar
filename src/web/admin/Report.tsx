// Printable periodic report (ROADMAP phase 8): monthly / term / yearly, with charts, ready for meetings.
// Built only from existing analytics endpoints (summary, trends, ranking, insights); the sidebar and toolbar
// carry `no-print`, and the charts are SVG so they print crisply.
import { useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { api, qs } from '../lib/api'
import { delta, faDate, faMonthLabel, formatNumber, formatToman, jalaliPresets, toFaDigits } from '../lib/format'
import { Async, useAsync } from '../components/ui'
import { Chart } from '../components/Chart'

const KPIS: { key: string; label: string; money?: boolean }[] = [
  { key: 'published', label: 'شمارهٔ منتشرشده' },
  { key: 'pages', label: 'صفحهٔ منتشرشده' },
  { key: 'started', label: 'شمارهٔ آغازشده' },
  { key: 'active_publications', label: 'نشریهٔ فعال' },
  { key: 'views', label: 'بازدید کل' },
  { key: 'reads', label: 'مطالعهٔ شماره' },
  { key: 'new_followers', label: 'دنبال‌کنندهٔ جدید' },
  { key: 'posts', label: 'پست اکسپلور' },
  { key: 'digital_sold', label: 'فروش دیجیتال' },
  { key: 'revenue_digital', label: 'درآمد دیجیتال', money: true },
  { key: 'print_sold', label: 'فروش چاپی' },
  { key: 'new_students', label: 'دانشجوی تازه‌ثبت‌نام' }
]
const PERIODS = [
  { key: 'prevMonth', label: 'گزارش ماهانه (ماه گذشته)' },
  { key: 'month', label: 'گزارش ماه جاری' },
  { key: 'term', label: 'گزارش ترمی' },
  { key: 'acad', label: 'گزارش سال تحصیلی' },
  { key: 'year', label: 'گزارش سالانه (سال شمسی جاری)' },
  { key: 'prevYear', label: 'گزارش سالانه (سال گذشته)' }
]
const SEV_FA: Record<string, string> = { critical: 'بحرانی', warning: 'هشدار', info: 'اطلاع', positive: 'مثبت' }

export default function AdminReport() {
  const presets = useMemo(() => jalaliPresets(), [])
  // ROADMAP phase 14: one-click report — period in the URL (?period=term) and ?print=1 opens the print dialog once loaded
  const [sp, setSp] = useSearchParams()
  const period = PERIODS.some((p) => p.key === sp.get('period')) ? (sp.get('period') as string) : 'prevMonth'
  const setPeriod = (k: string) => setSp((prev) => { const n = new URLSearchParams(prev); n.set('period', k); n.delete('print'); return n }, { replace: true })
  const autoPrint = sp.get('print') === '1'
  const printed = useRef(false)
  const range = presets.find((p) => p.key === period) || presets[0]
  const q = qs({ from: range.from, to: range.to })
  const st = useAsync(
    () =>
      Promise.all([
        api.get<any>(`/api/analytics/summary${q}`),
        api.get<any>(`/api/analytics/trends${q}`),
        api.get<any>(`/api/analytics/ranking${q}`),
        api.get<any>('/api/analytics/insights')
      ]),
    [q]
  )
  const label = PERIODS.find((p) => p.key === period)?.label || ''
  useEffect(() => {
    if (!autoPrint || printed.current || st.loading || st.error || !st.data) return
    printed.current = true
    // give ECharts a moment to lay out the SVGs before the print snapshot
    const t = setTimeout(() => window.print(), 900)
    return () => clearTimeout(t)
  }, [autoPrint, st.loading, st.error, st.data])

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <select className="input !w-auto max-w-full" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="دورهٔ گزارش">
          {PERIODS.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
        <button className="btn-primary" onClick={() => window.print()}>
          <Printer className="size-4" /> چاپ / ذخیره PDF
        </button>
      </div>
      <Async state={st}>
        {([sum, tr, rk, ins]: any[]) => {
          const top = [...rk.rows].filter((r: any) => r.status === 'active').sort((a: any, b: any) => (b.health?.score ?? 0) - (a.health?.score ?? 0))
          const best = top.slice(0, 5)
          const weak = top.slice(-5).reverse().filter((r: any) => !best.includes(r))
          const alerts = ins.items.filter((i: any) => i.severity === 'critical' || i.severity === 'warning').slice(0, 8)
          const months = Array.from(new Set([...tr.published, ...tr.views].map((r: any) => r.m))).sort() as string[]
          const at = (rows: any[], m: string, k = 'n') => Number(rows.find((r: any) => r.m === m)?.[k] || 0)
          return (
            <article className="print-sheet card space-y-5 p-6">
              <header className="border-b border-line pb-4">
                <div className="text-xs text-muted">سامانهٔ نشریار · گزارش دوره‌ای نشریات دانشجویی</div>
                <h1 className="text-2xl font-extrabold">{label}</h1>
                <p className="text-sm text-muted">
                  بازه: {faDate(sum.from)} تا {faDate(sum.to)} · مقایسه با دورهٔ هم‌طول قبل ({faDate(sum.prevFrom)} تا {faDate(sum.prevTo)}) · تاریخ تهیه: {faDate(new Date().toISOString())}
                </p>
              </header>

              <section>
                <h2 className="mb-2 font-bold">شاخص‌های کلیدی</h2>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {KPIS.map((k) => {
                    const cur = Number(sum.current[k.key] || 0)
                    const prev = Number(sum.previous[k.key] || 0)
                    const d = delta(cur, prev)
                    return (
                      <div key={k.key} className="rounded-lg border border-line p-2">
                        <div className="text-xs text-muted">{k.label}</div>
                        <div className="text-lg font-extrabold">{k.money ? formatToman(cur) : formatNumber(cur)}</div>
                        <div className={`text-[11px] ${d == null ? 'text-muted' : d >= 0 ? 'text-ok' : 'text-danger'}`}>
                          {d == null ? 'بدون دادهٔ دورهٔ قبل' : `${d >= 0 ? '▲' : '▼'} ${toFaDigits(Math.abs(Math.round(d)))}٪`}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>

              {months.length > 0 && (
                <section>
                  <h2 className="mb-2 font-bold">روند ماهانه</h2>
                  <Chart
                    height={240}
                    option={{
                      tooltip: { trigger: 'axis' },
                      legend: { data: ['شمارهٔ منتشرشده', 'بازدید (÷۱۰)'] },
                      xAxis: { type: 'category', data: months.map(faMonthLabel) },
                      yAxis: { type: 'value' },
                      series: [
                        { name: 'شمارهٔ منتشرشده', type: 'bar', data: months.map((m) => at(tr.published, m)) },
                        { name: 'بازدید (÷۱۰)', type: 'line', data: months.map((m) => Math.round(at(tr.views, m) / 10)) }
                      ]
                    }}
                  />
                </section>
              )}

              {tr.byFaculty.length > 0 && (
                <section>
                  <h2 className="mb-2 font-bold">انتشار به تفکیک دانشکده</h2>
                  <Chart
                    height={Math.max(160, tr.byFaculty.length * 28)}
                    option={{
                      grid: { left: 120 },
                      xAxis: { type: 'value' },
                      yAxis: { type: 'category', inverse: true, data: tr.byFaculty.map((r: any) => r.name) },
                      series: [{ type: 'bar', data: tr.byFaculty.map((r: any) => r.n) }]
                    }}
                  />
                </section>
              )}

              <section className="grid gap-4 sm:grid-cols-2">
                <div>
                  <h2 className="mb-2 font-bold">پیشتازان (امتیاز سلامت)</h2>
                  <RankTable rows={best} />
                </div>
                <div>
                  <h2 className="mb-2 font-bold">نیازمند پیگیری</h2>
                  <RankTable rows={weak} />
                </div>
              </section>

              <section>
                <h2 className="mb-2 font-bold">هشدارها و موارد پیگیری ({toFaDigits(alerts.length)})</h2>
                {!alerts.length ? (
                  <p className="text-sm text-muted">مورد هشدار یا بحرانی وجود ندارد.</p>
                ) : (
                  <ul className="list-inside list-disc space-y-1 text-sm">
                    {alerts.map((a: any) => (
                      <li key={a.key}>
                        <span className={a.severity === 'critical' ? 'font-bold text-danger' : 'font-bold'}>[{SEV_FA[a.severity]}]</span> {a.title} — <span className="text-muted">{a.detail}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <footer className="border-t border-line pt-2 text-[11px] text-muted">
                منبع: داده‌های ثبت‌شده در نشریار. «بازدید» شامل بازدید صفحات نشریه، شماره و پست است؛ هر بیننده در هر روز یک بار شمرده می‌شود.
                فهرست دنبال‌کنندگان در هیچ گزارشی منتشر نمی‌شود.
              </footer>
            </article>
          )
        }}
      </Async>
    </div>
  )
}

function RankTable({ rows }: { rows: any[] }) {
  if (!rows.length) return <p className="text-sm text-muted">—</p>
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-muted">
        <tr><th className="p-1 text-right">نشریه</th><th className="p-1 text-center">سلامت</th><th className="p-1 text-center">انتشار</th><th className="p-1 text-center">بازدید</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-line">
            <td className="p-1">{r.title}</td>
            <td className="p-1 text-center">{toFaDigits(r.health?.score ?? 0)}</td>
            <td className="p-1 text-center">{toFaDigits(r.published)}</td>
            <td className="p-1 text-center">{formatNumber(r.views)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

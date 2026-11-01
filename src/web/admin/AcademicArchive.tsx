// Read-only yearly archive (ROADMAP phase 17 — academic-year dimension).
// Lists academic years (1 Mehr → 31 Shahrivar); a finished year opens its frozen snapshot from
// GET /api/analytics/archive/:year (immutable once created). The current year links to the live reports with ?acad=.
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Archive, Lock } from 'lucide-react'
import { api } from '../lib/api'
import { faDate, faMonthLabel, formatNumber, formatToman } from '../lib/format'
import { Async, Badge, Card, Empty, PageHeader, Stat, useAsync } from '../components/ui'
import { Chart, ExportButtons } from '../components/Chart'

type Year = { year: number; from: string; to: string; label: string; current: boolean; archived: boolean }
type Row = {
  id: string; title: string; faculty_name: string | null; published: number; pages: number; views: number; reads: number
  posts: number; new_followers: number; digital_sold: number; revenue: number; print_sold: number; revenue_print: number
}

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`

export default function AcademicArchive() {
  const [sp, setSp] = useSearchParams()
  const years = useAsync(() => api.get<{ current: number; years: Year[] }>('/api/analytics/academic-years'), [])
  const [picked, setPicked] = useState<number | null>(Number(sp.get('year')) || null)
  const pick = (y: number) => {
    setPicked(y)
    setSp((prev) => { const n = new URLSearchParams(prev); n.set('year', String(y)); return n }, { replace: true })
  }
  return (
    <div className="space-y-4">
      <PageHeader title="آرشیو سال‌های تحصیلی" subtitle="عملکرد هر سال تحصیلی (مهر تا شهریور) پس از پایانش یک‌بار ثبت و از آن پس فقط‌خواندنی نگه داشته می‌شود." />
      <Async state={years}>
        {(d) => {
          const finished = d.years.filter((y) => !y.current)
          const sel = picked && finished.some((y) => y.year === picked) ? picked : finished[0]?.year ?? null
          const cur = d.years.find((y) => y.current)
          return (
            <>
              <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="سال تحصیلی">
                {finished.map((y) => (
                  <button key={y.year} role="tab" aria-selected={y.year === sel} className={y.year === sel ? 'btn-primary' : 'btn-ghost'} onClick={() => pick(y.year)}>
                    {y.label.replace('سال تحصیلی ', '')}
                    {y.archived && <Lock className="size-3 opacity-70" aria-label="ثبت‌شده" />}
                  </button>
                ))}
                {cur && (
                  <Link className="btn-ghost text-sm" to={`/admin/analytics?from=${cur.from}&to=${cur.to}`}>
                    {cur.label} (جاری، در گزارش‌های زنده)
                  </Link>
                )}
              </div>
              {sel ? <YearView year={sel} /> : <Empty title="هنوز هیچ سال تحصیلی‌ای تمام نشده است" icon={<Archive className="size-6" />} />}
            </>
          )
        }}
      </Async>
    </div>
  )
}

function YearView({ year }: { year: number }) {
  const st = useAsync(() => api.get<any>(`/api/analytics/archive/${year}`), [year])
  return (
    <Async state={st}>
      {(a) => {
        const t = a.totals
        const rows: Row[] = a.rows
        const csv = () =>
          [
            ['نشریه', 'دانشکده', 'شمارهٔ منتشرشده', 'صفحه', 'بازدید', 'مطالعه', 'پست', 'دنبال‌کنندهٔ جدید', 'فروش دیجیتال', 'درآمد دیجیتال', 'فروش چاپی', 'درآمد چاپی'],
            ...rows.map((r) => [r.title, r.faculty_name || '', r.published, r.pages, r.views, r.reads, r.posts, r.new_followers, r.digital_sold, r.revenue, r.print_sold, r.revenue_print])
          ].map((l) => l.map(csvCell).join(',')).join('\n')
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <Badge tone="muted"><Lock className="size-3" /> فقط‌خواندنی</Badge>
              <span>{faDate(a.from)} تا {faDate(a.to)}</span>
              {a.archived_at && <span>· ثبت در {faDate(a.archived_at)}</span>}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="نشریهٔ فعال" value={formatNumber(t.publications_active)} />
              <Stat label="شمارهٔ منتشرشده" value={formatNumber(t.published)} sub={`${formatNumber(t.pages)} صفحه`} />
              <Stat label="بازدید" value={formatNumber(t.views)} sub={`${formatNumber(t.reads)} مطالعهٔ شماره`} />
              <Stat label="فروش" value={formatNumber(t.digital_sold + t.print_sold)} sub={formatToman(t.revenue + t.revenue_print)} />
            </div>
            {a.monthly?.length > 0 && (
              <Card title="بازدید و انتشار ماه‌به‌ماه">
                <Chart
                  height={240}
                  csvName={`archive-${year}-monthly`}
                  option={{
                    legend: {},
                    tooltip: { trigger: 'axis' },
                    xAxis: { type: 'category', data: a.monthly.map((m: any) => faMonthLabel(m.m)) },
                    yAxis: [{ type: 'value' }, { type: 'value', minInterval: 1 }],
                    series: [
                      { name: 'بازدید', type: 'bar', data: a.monthly.map((m: any) => m.views) },
                      { name: 'شمارهٔ منتشرشده', type: 'line', yAxisIndex: 1, data: a.monthly.map((m: any) => a.issuesMonthly.find((x: any) => x.m === m.m)?.n || 0) }
                    ]
                  }}
                />
              </Card>
            )}
            {a.byFaculty.length > 1 && (
              <Card title="به تفکیک دانشکده">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted"><tr><th className="p-1 text-right">دانشکده</th><th className="p-1 text-center">نشریهٔ فعال</th><th className="p-1 text-center">شماره</th><th className="p-1 text-center">صفحه</th><th className="p-1 text-center">بازدید</th></tr></thead>
                    <tbody>
                      {a.byFaculty.map((f: any) => (
                        <tr key={f.id || 'none'} className="border-t border-line"><td className="p-1">{f.name}</td><td className="p-1 text-center">{formatNumber(f.publications_active)}</td><td className="p-1 text-center">{formatNumber(f.published)}</td><td className="p-1 text-center">{formatNumber(f.pages)}</td><td className="p-1 text-center">{formatNumber(f.views)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
            <Card title="عملکرد نشریات" action={<ExportButtons name={`archive-${year}`} csv={csv} />}>
              {!rows.length ? <Empty title="در این سال فعالیتی ثبت نشده است" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted"><tr><th className="p-1 text-right">نشریه</th><th className="p-1 text-right">دانشکده</th><th className="p-1 text-center">شماره</th><th className="p-1 text-center">صفحه</th><th className="p-1 text-center">بازدید</th><th className="p-1 text-center">پست</th><th className="p-1 text-center">فروش</th><th className="p-1 text-center">درآمد</th></tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="border-t border-line">
                          <td className="p-1"><Link className="link" to={`/admin/publications/${r.id}`}>{r.title}</Link></td>
                          <td className="p-1 text-muted">{r.faculty_name || '—'}</td>
                          <td className="p-1 text-center">{formatNumber(r.published)}</td>
                          <td className="p-1 text-center">{formatNumber(r.pages)}</td>
                          <td className="p-1 text-center">{formatNumber(r.views)}</td>
                          <td className="p-1 text-center">{formatNumber(r.posts)}</td>
                          <td className="p-1 text-center">{formatNumber(r.digital_sold + r.print_sold)}</td>
                          <td className="p-1 text-center">{formatToman(r.revenue + r.revenue_print)}</td>
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

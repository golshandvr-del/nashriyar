import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, mediaUrl, qs } from '../lib/api'
import { faDate, formatNumber, jalaliPresets } from '../lib/format'
import { Async, Card, Empty, PageHeader, Stat, useAsync } from '../components/ui'
import { Chart, ExportButtons } from '../components/Chart'
import { useTeam } from './Layout'

/** Shared Jalali range picker (presets + custom from/to). */
export function RangePicker({ value, onChange }: { value: { from: string; to: string; key: string }; onChange: (v: { from: string; to: string; key: string }) => void }) {
  const presets = useMemo(() => jalaliPresets(), [])
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="input !w-auto" value={value.key} onChange={(e) => {
        const p = presets.find((x) => x.key === e.target.value)
        if (p) onChange({ from: p.from, to: p.to, key: p.key })
        else onChange({ ...value, key: 'custom' })
      }} aria-label="بازهٔ زمانی">
        {presets.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
        <option value="custom">بازهٔ دلخواه</option>
      </select>
      {value.key === 'custom' && (
        <>
          <input type="date" className="input !w-auto" dir="ltr" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} aria-label="از" />
          <span className="text-muted">تا</span>
          <input type="date" className="input !w-auto" dir="ltr" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} aria-label="تا" />
        </>
      )}
      <span className="text-xs text-muted">
        {faDate(value.from)} — {faDate(value.to)}
      </span>
    </div>
  )
}

/** Never throws: an unknown preset key falls back to the last 30 days (a missing key once blanked whole pages). */
export function defaultRange(key = '30d') {
  const all = jalaliPresets()
  const p = all.find((x) => x.key === key) || all.find((x) => x.key === '30d')!
  return { from: p.from, to: p.to, key: p.key }
}

export default function TeamStats() {
  const { pubId } = useTeam()
  const [range, setRange] = useState(defaultRange('30d'))
  const st = useAsync(() => api.get(`/api/team/${pubId}/stats${qs({ from: range.from, to: range.to })}`), [pubId, range.from, range.to])
  return (
    <div>
      <PageHeader title="آمار نشریه" subtitle="آمار تجمیعی نشریهٔ خودتان؛ بدون رتبه‌بندی، مقایسه با نشریات دیگر یا عدد دنبال‌کننده." actions={<RangePicker value={range} onChange={setRange} />} />
      <Async state={st}>
        {(d: any) => {
          const days = d.daily.map((x: any) => faDate(x.day).replace(/^\S+\s/, ''))
          const option = {
            legend: {},
            xAxis: { type: 'category', data: d.daily.map((x: any) => faDate(x.day)), axisLabel: { hideOverlap: true } },
            yAxis: { type: 'value', minInterval: 1 },
            series: [
              { name: 'بازدید صفحهٔ نشریه', type: 'line', smooth: true, showSymbol: false, data: d.daily.map((x: any) => x.page_views) },
              { name: 'بازدید شماره‌ها', type: 'line', smooth: true, showSymbol: false, data: d.daily.map((x: any) => x.issue_views) },
              { name: 'خواندن', type: 'line', smooth: true, showSymbol: false, data: d.daily.map((x: any) => x.reads) },
              { name: 'بازدید پست‌ها', type: 'line', smooth: true, showSymbol: false, data: d.daily.map((x: any) => x.post_views) }
            ]
          }
          void days
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Stat label="بازدید صفحهٔ نشریه" value={formatNumber(d.totals.page_views)} />
                <Stat label="بازدید شماره‌ها" value={formatNumber(d.totals.issue_views)} />
                <Stat label="خواندن" value={formatNumber(d.totals.reads)} />
                <Stat label="بازدید پست‌ها" value={formatNumber(d.totals.post_views)} />
                <Stat label="میانگین پیشرفت مطالعه" value={`${formatNumber(d.avg_read_percent)}٪`} sub="از کل دوره" />
              </div>
              <Card title="روند روزانه">{d.daily.length ? <Chart option={option} height={300} csvName={`stats-${range.from}-${range.to}`} /> : <Empty title="در این بازه بازدیدی ثبت نشده" />}</Card>
              <Card
                title="شماره‌های منتشرشده"
                action={
                  <ExportButtons
                    name="issues"
                    csv={() =>
                      ['شماره,عنوان,نوع,بازدید,خواندن,فروش دیجیتال,فروش چاپی', ...d.byIssue.map((i: any) => [i.number, `"${String(i.title).replace(/"/g, '""')}"`, i.pricing === 'paid' ? 'پولی' : 'رایگان', i.views, i.reads, i.digital_sold, i.print_sold].join(','))].join('\n')
                    }
                  />
                }
              >
                {!d.byIssue.length ? (
                  <Empty title="هنوز شماره‌ای منتشر نشده" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-muted">
                        <tr>
                          <th className="p-2 text-right">شماره</th>
                          <th className="p-2 text-center">بازدید</th>
                          <th className="p-2 text-center">خواندن</th>
                          <th className="p-2 text-center">فروش دیجیتال</th>
                          <th className="p-2 text-center">فروش چاپی</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.byIssue.map((i: any) => (
                          <tr key={i.id} className="border-t border-line">
                            <td className="p-2">
                              <Link to={`/issue/${i.id}`} className="hover:text-brand">
                                ش {formatNumber(i.number)} — {i.title}
                              </Link>
                              {i.pricing === 'paid' && <span className="mr-1 text-[11px] text-muted">(پولی)</span>}
                            </td>
                            <td className="p-2 text-center">{formatNumber(i.views)}</td>
                            <td className="p-2 text-center">{formatNumber(i.reads)}</td>
                            <td className="p-2 text-center">{i.pricing === 'paid' ? formatNumber(i.digital_sold) : '—'}</td>
                            <td className="p-2 text-center">{formatNumber(i.print_sold)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
              <Card title="پربازدیدترین پست‌ها در این بازه">
                {!d.topPosts.length ? (
                  <Empty title="پستی وجود ندارد" />
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {d.topPosts.map((p: any) => (
                      <Link key={p.id} to={`/post/${p.id}`} className="group relative aspect-square overflow-hidden rounded-xl bg-surface-2">
                        {p.image && <img src={mediaUrl(p.image)} alt="" className="size-full object-cover" loading="lazy" />}
                        <span className="absolute inset-x-0 bottom-0 bg-black/55 p-1 text-center text-[11px] text-white">{formatNumber(p.views)} بازدید</span>
                      </Link>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          )
        }}
      </Async>
    </div>
  )
}

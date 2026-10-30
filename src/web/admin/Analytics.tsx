import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Download } from 'lucide-react'
import { api, qs } from '../lib/api'
import { FREQUENCY, faDate, faMonthLabel, formatNumber, formatToman, toFaDigits, CHANNEL } from '../lib/format'
import { Async, Badge, Card, Empty, PageHeader, Tabs, useAsync } from '../components/ui'
import { Chart, downloadCsv } from '../components/Chart'
import { RangePicker, defaultRange } from '../team/Stats'
import { useAdminRole } from './Layout'

type Tab = 'trends' | 'ranking' | 'production' | 'gaps' | 'directors' | 'explore' | 'sales' | 'forecast'
const TABS: { key: Tab; label: string }[] = [
  { key: 'trends', label: 'روندها' },
  { key: 'ranking', label: 'رتبه‌بندی' },
  { key: 'production', label: 'سرعت تولید' },
  { key: 'gaps', label: 'فاصلهٔ انتشار' },
  { key: 'directors', label: 'بازدهی مدیران' },
  { key: 'explore', label: 'اکسپلور' },
  { key: 'sales', label: 'فروش' },
  { key: 'forecast', label: 'پیش‌بینی ترم' }
]
const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']
const HEALTH_PARTS: Record<string, string> = { regularity: 'نظم انتشار (۳۵)', activity: 'فعالیت تولید (۲۵)', audience: 'مخاطب (۲۰)', explore: 'اکسپلور (۱۰)', hygiene: 'رسیدگی به نظرها (۱۰)' }

const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
const csvOf = (head: string[], rows: unknown[][]) => [head.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')

export default function AdminAnalytics() {
  const { role } = useAdminRole()
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') as Tab) || 'trends'
  const [range, setRange] = useState(defaultRange('1y'))
  const [faculty, setFaculty] = useState('')
  const structure = useAsync(() => (role === 'faculty_supervisor' ? Promise.resolve({ faculties: [] }) : api.get('/api/admin/structure')), [role])
  const q = qs({ from: range.from, to: range.to, faculty })

  return (
    <div className="space-y-4">
      <PageHeader
        title="آمار و تحلیل"
        subtitle="شاخص‌ها و مقایسهٔ نشریات در بازهٔ انتخابی"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {role !== 'faculty_supervisor' && !!structure.data?.faculties?.length && (
              <select className="input !w-auto" value={faculty} onChange={(e) => setFaculty(e.target.value)} aria-label="دانشکده">
                <option value="">همهٔ دانشکده‌ها</option>
                {structure.data.faculties.map((f: any) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            )}
            <RangePicker value={range} onChange={setRange} />
          </div>
        }
      />
      <Tabs<Tab> value={tab} onChange={(k) => setSp({ tab: k }, { replace: true })} tabs={TABS} />
      {tab === 'trends' && <Trends q={q} />}
      {tab === 'ranking' && <Ranking q={q} />}
      {tab === 'production' && <Production q={q} />}
      {tab === 'gaps' && <Gaps q={q} />}
      {tab === 'directors' && <Directors q={q} />}
      {tab === 'explore' && <ExploreStats q={q} />}
      {tab === 'sales' && <Sales q={q} />}
      {tab === 'forecast' && <Forecast q={q} />}
    </div>
  )
}

function Trends({ q }: { q: string }) {
  const st = useAsync(() => api.get(`/api/analytics/trends${q}`), [q])
  return (
    <Async state={st}>
      {(d: any) => {
        const months = Array.from(new Set([...d.published, ...d.views, ...d.sales, ...d.followers].map((x: any) => x.m))).sort() as string[]
        const pick = (arr: any[], k: string) => months.map((m) => arr.find((x) => x.m === m)?.[k] ?? 0)
        const labels = months.map(faMonthLabel)
        return (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="انتشار ماهانه">
              <Chart csvName="published-monthly" option={{ legend: {}, xAxis: { type: 'category', data: labels }, yAxis: [{ type: 'value', minInterval: 1 }, { type: 'value' }], series: [{ name: 'شماره', type: 'bar', data: pick(d.published, 'n') }, { name: 'صفحه', type: 'line', yAxisIndex: 1, smooth: true, data: pick(d.published, 'pages') }] }} />
            </Card>
            <Card title="بازدید ماهانه">
              <Chart csvName="views-monthly" option={{ legend: {}, xAxis: { type: 'category', data: labels }, yAxis: { type: 'value' }, series: [{ name: 'بازدید کل', type: 'line', smooth: true, areaStyle: { opacity: 0.12 }, data: pick(d.views, 'n') }, { name: 'خواندن شماره', type: 'line', smooth: true, data: pick(d.views, 'reads') }, { name: 'بازدید پست', type: 'line', smooth: true, data: pick(d.views, 'post_views') }] }} />
            </Card>
            <Card title="فروش دیجیتال">
              <Chart csvName="sales-monthly" option={{ legend: {}, xAxis: { type: 'category', data: labels }, yAxis: [{ type: 'value', minInterval: 1 }, { type: 'value' }], series: [{ name: 'تعداد', type: 'bar', data: pick(d.sales, 'n') }, { name: 'درآمد (تومان)', type: 'line', yAxisIndex: 1, smooth: true, data: pick(d.sales, 'revenue') }] }} />
            </Card>
            <Card title="دنبال‌کنندهٔ جدید">
              <Chart csvName="followers-monthly" option={{ xAxis: { type: 'category', data: labels }, yAxis: { type: 'value', minInterval: 1 }, series: [{ name: 'دنبال‌کنندهٔ جدید', type: 'bar', data: pick(d.followers, 'n') }] }} />
            </Card>
            <Card title="انتشار به تفکیک دانشکده">
              {!d.byFaculty.length ? <Empty title="داده‌ای نیست" /> : <Chart csvName="by-faculty" option={{ tooltip: { trigger: 'item' }, series: [{ name: 'شماره', type: 'pie', radius: ['40%', '70%'], data: d.byFaculty.map((x: any) => ({ name: x.name, value: x.n })) }] }} />}
            </Card>
            <Card title="انتشار به تفکیک موضوع">
              {!d.byCategory.length ? <Empty title="داده‌ای نیست" /> : <Chart csvName="by-category" option={{ grid: { left: 110 }, xAxis: { type: 'value', minInterval: 1 }, yAxis: { type: 'category', inverse: true, data: d.byCategory.map((x: any) => x.name) }, series: [{ name: 'شماره', type: 'bar', data: d.byCategory.map((x: any) => x.n) }] }} />}
            </Card>
            {d.yoy && (
              <Card title="مقایسهٔ سال‌به‌سال (همین بازه در سال قبل)" className="lg:col-span-2">
                <Chart
                  height={240}
                  csvName="yoy"
                  option={{
                    legend: {},
                    xAxis: { type: 'category', data: labels },
                    yAxis: [{ type: 'value', minInterval: 1 }, { type: 'value' }],
                    series: [
                      { name: 'شماره — امسال', type: 'bar', data: pick(d.published, 'n') },
                      { name: 'شماره — سال قبل', type: 'bar', data: pick(d.yoy.published, 'n'), itemStyle: { opacity: 0.45 } },
                      { name: 'بازدید — امسال', type: 'line', yAxisIndex: 1, smooth: true, data: pick(d.views, 'n') },
                      { name: 'بازدید — سال قبل', type: 'line', yAxisIndex: 1, smooth: true, lineStyle: { type: 'dashed' }, data: pick(d.yoy.views, 'n') }
                    ]
                  }}
                />
              </Card>
            )}
            {d.newPerYear?.length > 0 && (
            <Card title="نشریات جدید ثبت‌شده در هر سال">
              <Chart height={220} csvName="new-publications" option={{ xAxis: { type: 'category', data: d.newPerYear.map((r: any) => toFaDigits(r.y)) }, yAxis: { type: 'value', minInterval: 1 }, series: [{ name: 'نشریهٔ جدید', type: 'bar', data: d.newPerYear.map((r: any) => r.n) }] }} />
            </Card>
          )}
          <Card title="بازدید بر حسب روز هفته" className="lg:col-span-2">
              <Chart height={220} csvName="weekday" option={{ xAxis: { type: 'category', data: [6, 0, 1, 2, 3, 4, 5].map((i) => WEEKDAYS[i]) }, yAxis: { type: 'value' }, series: [{ name: 'بازدید', type: 'bar', data: [6, 0, 1, 2, 3, 4, 5].map((i) => d.weekday.find((w: any) => w.d === i)?.n ?? 0) }] }} />
            </Card>
          </div>
        )
      }}
    </Async>
  )
}

const RANK_COLS: { key: string; label: string; money?: boolean }[] = [
  { key: 'health', label: 'سلامت' },
  { key: 'published', label: 'شماره' },
  { key: 'pages', label: 'صفحه' },
  { key: 'views', label: 'بازدید' },
  { key: 'reads', label: 'خواندن' },
  { key: 'followers', label: 'دنبال‌کننده' },
  { key: 'new_followers', label: 'دنبال‌کنندهٔ جدید' },
  { key: 'digital_sold', label: 'فروش دیجیتال' },
  { key: 'revenue', label: 'درآمد', money: true },
  { key: 'posts', label: 'پست' },
  { key: 'members', label: 'اعضا' }
]

function Ranking({ q }: { q: string }) {
  const st = useAsync(() => api.get(`/api/analytics/ranking${q}`), [q])
  const [sort, setSort] = useState('health')
  return (
    <Async state={st}>
      {(d: any) => {
        const val = (r: any, k: string) => (k === 'health' ? r.health?.score ?? 0 : Number(r[k] || 0))
        const rows = [...d.rows].sort((a, b) => val(b, sort) - val(a, sort))
        const exportCsv = () => downloadCsv(`ranking-${d.from}-${d.to}`, csvOf(['نشریه', 'دانشکده', ...RANK_COLS.map((c) => c.label), 'آخرین انتشار'], rows.map((r) => [r.title, r.faculty_name, ...RANK_COLS.map((c) => val(r, c.key)), faDate(r.last_published_at)])))
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted">این رتبه‌بندی فقط برای مسئولان قابل مشاهده است و هرگز به تیم‌ها نشان داده نمی‌شود. روی عنوان ستون بزنید تا مرتب شود.</p>
              <button className="btn-ghost" onClick={exportCsv}><Download className="size-4" /> CSV</button>
            </div>
            {!rows.length ? (
              <Empty title="داده‌ای نیست" />
            ) : (
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-xs text-muted">
                    <tr>
                      <th className="p-2 text-right">#</th>
                      <th className="p-2 text-right">نشریه</th>
                      {RANK_COLS.map((c) => (
                        <th key={c.key} className="cursor-pointer p-2 text-center whitespace-nowrap hover:text-ink" onClick={() => setSort(c.key)}>
                          {c.label}{sort === c.key ? ' ▼' : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, idx) => (
                      <tr key={r.id} className="border-t border-line hover:bg-surface-2/50">
                        <td className="p-2 text-muted">{toFaDigits(idx + 1)}</td>
                        <td className="p-2">
                          <Link to={`/admin/publications/${r.id}`} className="flex items-center gap-2 font-medium hover:text-brand">
                            <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.theme_color || 'var(--brand)' }} />
                            <span className="whitespace-nowrap">{r.title}</span>
                            {r.status !== 'active' && <Badge tone="danger">{r.status === 'suspended' ? 'تعلیق' : 'بایگانی'}</Badge>}
                          </Link>
                          <div className="text-[11px] text-muted">{r.faculty_name || '—'} · {FREQUENCY[r.frequency] || r.frequency}</div>
                        </td>
                        {RANK_COLS.map((c) => (
                          <td key={c.key} className="p-2 text-center">
                            {c.key === 'health' ? (
                              <span
                                title={Object.entries(r.health?.parts || {}).map(([k, v]) => `${HEALTH_PARTS[k] || k}: ${v}`).join('\n')}
                                className={`inline-block min-w-10 rounded-md px-1.5 py-0.5 text-xs font-bold ${val(r, 'health') >= 70 ? 'bg-ok/10 text-ok' : val(r, 'health') >= 40 ? 'bg-warn/10 text-warn' : 'bg-danger/10 text-danger'}`}
                              >
                                {toFaDigits(val(r, 'health'))}
                              </span>
                            ) : c.money ? (
                              <span className="whitespace-nowrap text-xs">{formatToman(val(r, c.key))}</span>
                            ) : (
                              formatNumber(val(r, c.key))
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted">امتیاز سلامت (۰ تا ۱۰۰) = {Object.values(HEALTH_PARTS).join(' + ')}. برای دیدن اجزا نشانگر را روی عدد نگه دارید.</p>
          </div>
        )
      }}
    </Async>
  )
}

function Forecast({ q }: { q: string }) {
  // The forecast always covers the current academic term; only the faculty filter from q applies.
  const fq = new URLSearchParams(q.replace(/^\?/, '')).get('faculty') || ''
  const st = useAsync(() => api.get(`/api/analytics/forecast${qs({ faculty: fq })}`), [fq])
  return (
    <Async state={st}>
      {(d: any) => {
        const reliability = (r2: number, weeks: number) => (weeks < 4 ? 'داده کم — فقط تقریبی' : r2 >= 0.8 ? 'قابل اتکا' : r2 >= 0.5 ? 'متوسط' : 'ضعیف')
        const line = (key: 'issues' | 'pages') => {
          const f = d[key]
          const xs = Array.from({ length: d.term.weeks_total }, (_, i) => i + 1)
          return {
            tooltip: { trigger: 'axis' },
            legend: { data: ['واقعی', 'روند خطی'] },
            xAxis: { type: 'category', data: xs.map((w) => `هفتهٔ ${toFaDigits(w)}`) },
            yAxis: { type: 'value' },
            series: [
              { name: 'واقعی', type: 'line', data: d.cumulative.map((c: any) => c[key]) },
              { name: 'روند خطی', type: 'line', lineStyle: { type: 'dashed' }, symbol: 'none', data: xs.map((w) => Math.max(0, Math.round((f.per_week * (w - d.term.weeks_elapsed) + f.actual) * 10) / 10)) }
            ]
          }
        }
        const behind = d.publications.filter((p: any) => p.behind)
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              {d.term.label} · {faDate(d.term.start)} تا {faDate(d.term.end)} · هفتهٔ {toFaDigits(d.term.weeks_elapsed)} از {toFaDigits(d.term.weeks_total)}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['issues', 'pages'] as const).map((k) => (
                <div key={k} className="card p-3">
                  <div className="text-xs text-muted">{k === 'issues' ? 'شمارهٔ منتشرشده' : 'صفحهٔ منتشرشده'} تا پایان ترم</div>
                  <div className="text-xl font-extrabold">
                    {formatNumber(d[k].actual)} <span className="text-sm font-normal text-muted">← پیش‌بینی</span> {formatNumber(d[k].projected)}
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    سرعت: {toFaDigits(d[k].per_week)} در هفته · r² = {toFaDigits(d[k].r2)} · {reliability(d[k].r2, d.term.weeks_elapsed)}
                  </div>
                </div>
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="روند تجمعی شماره‌ها"><Chart csvName="forecast-issues" option={line('issues')} /></Card>
              <Card title="روند تجمعی صفحات"><Chart csvName="forecast-pages" option={line('pages')} /></Card>
            </div>
            <Card title={`پیش‌بینی هر نشریه${behind.length ? ` — ${toFaDigits(behind.length)} نشریه عقب از دورهٔ انتشار` : ''}`}>
              {!d.publications.length ? <Empty title="نشریهٔ فعالی نیست" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted"><tr><th className="p-2 text-right">نشریه</th><th className="p-2 text-center">دورهٔ انتشار</th><th className="p-2 text-center">تاکنون</th><th className="p-2 text-center">پیش‌بینی پایان ترم</th><th className="p-2 text-center">انتظار طبق دوره</th></tr></thead>
                    <tbody>
                      {d.publications.map((p: any) => (
                        <tr key={p.id} className="border-t border-line">
                          <td className="p-2"><Link to={`/admin/publications/${p.id}`} className="hover:text-brand">{p.title}</Link></td>
                          <td className="p-2 text-center">{FREQUENCY[p.frequency] || '—'}</td>
                          <td className="p-2 text-center">{toFaDigits(p.actual)}</td>
                          <td className="p-2 text-center">{toFaDigits(p.projected)}</td>
                          <td className="p-2 text-center">{p.expected == null ? '—' : p.behind ? <Badge tone="danger">{toFaDigits(p.expected)}</Badge> : <Badge tone="ok">{toFaDigits(p.expected)}</Badge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <p className="text-xs text-muted">روش: برازش خط حداقل مربعات روی تعداد تجمعی هفتگی از ابتدای ترم و برون‌یابی تا پایان ترم. پیش‌بینی هر نشریه = سرعت تاکنون × کل هفته‌های ترم.</p>
          </div>
        )
      }}
    </Async>
  )
}

function Production({ q }: { q: string }) {
  const st = useAsync(() => api.get(`/api/analytics/production${q}`), [q])
  return (
    <Async state={st}>
      {(d: any) => (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-3"><div className="text-xs text-muted">درخواست تأیید</div><div className="text-xl font-extrabold">{formatNumber(d.approvals?.n || 0)}</div></div>
            <div className="card p-3"><div className="text-xs text-muted">میانگین زمان تأیید</div><div className="text-xl font-extrabold">{toFaDigits(Math.round((d.approvals?.avg_days || 0) * 10) / 10)} روز</div></div>
            <div className="card p-3"><div className="text-xs text-muted">درخواست اصلاح</div><div className="text-xl font-extrabold">{formatNumber(d.approvals?.changes || 0)}</div></div>
          </div>
          <Card title="میانگین مدت هر مرحلهٔ تولید (روز)">
            {!d.stages.length ? <Empty title="داده‌ای نیست" /> : (
              <Chart csvName="stage-durations" option={{ grid: { left: 110 }, xAxis: { type: 'value' }, yAxis: { type: 'category', inverse: true, data: d.stages.map((s: any) => s.title) }, legend: {}, series: [{ name: 'میانگین روز', type: 'bar', data: d.stages.map((s: any) => Math.round((s.avg_days || 0) * 10) / 10) }, { name: 'میانه روز', type: 'bar', data: d.stages.map((s: any) => Math.round((s.median_days || 0) * 10) / 10) }] }} />
            )}
          </Card>
          {d.bottlenecks?.length > 0 && (
            <Card title="نقشهٔ حرارتی گلوگاه‌ها (میانگین روز هر مرحله در هر نشریه)">
              <Chart
                height={Math.max(240, d.bottlenecks.length * 26 + 80)}
                csvName="bottlenecks"
                option={{
                  grid: { left: 120, bottom: 60 },
                  tooltip: { position: 'top' },
                  xAxis: { type: 'category', data: d.stages.map((s: any) => s.title), splitArea: { show: true } },
                  yAxis: { type: 'category', data: d.bottlenecks.map((b: any) => b.publication), splitArea: { show: true } },
                  visualMap: { min: 0, max: Math.max(1, ...d.bottlenecks.flatMap((b: any) => Object.values(b.cells) as number[])), calculable: true, orient: 'horizontal', left: 'center', bottom: 0, inRange: { color: ['#e0f2fe', '#f59e0b', '#dc2626'] } },
                  series: [{
                    name: 'روز',
                    type: 'heatmap',
                    label: { show: true },
                    data: d.bottlenecks.flatMap((b: any, y: number) => d.stages.map((s: any, x: number) => [x, y, b.cells[s.key] ?? '-']))
                  }]
                }}
              />
            </Card>
          )}
          <Card title="چرخهٔ تولید هر نشریه">
            {!d.cycle.length ? <Empty title="داده‌ای نیست" /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted"><tr><th className="p-2 text-right">نشریه</th><th className="p-2 text-center">شماره‌ها</th><th className="p-2 text-center">میانگین چرخه (روز)</th><th className="p-2 text-center">با تأخیر</th></tr></thead>
                  <tbody>
                    {d.cycle.map((r: any) => (
                      <tr key={r.id} className="border-t border-line">
                        <td className="p-2"><Link to={`/admin/publications/${r.id}`} className="hover:text-brand">{r.title}</Link></td>
                        <td className="p-2 text-center">{toFaDigits(r.n)}</td>
                        <td className="p-2 text-center">{toFaDigits(Math.round((r.avg_cycle_days || 0) * 10) / 10)}</td>
                        <td className="p-2 text-center">{r.late ? <Badge tone="danger">{toFaDigits(r.late)}</Badge> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </Async>
  )
}

function Gaps({ q }: { q: string }) {
  const st = useAsync(() => api.get(`/api/analytics/gaps${q}`), [q])
  return (
    <Async state={st}>
      {(d: any) => {
        const rows = [...d.rows].sort((a, b) => Number(b.overdue) - Number(a.overdue) || (b.days_since_last ?? 9999) - (a.days_since_last ?? 9999))
        return !rows.length ? <Empty title="داده‌ای نیست" /> : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr><th className="p-2 text-right">نشریه</th><th className="p-2 text-center">دوره (انتظار)</th><th className="p-2 text-center">شماره‌ها</th><th className="p-2 text-center">میانگین فاصله</th><th className="p-2 text-center">بیشترین فاصله</th><th className="p-2 text-center">روز از آخرین</th></tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.id} className={`border-t border-line ${r.overdue ? 'bg-danger/5' : ''}`}>
                    <td className="p-2"><Link to={`/admin/publications/${r.id}`} className="hover:text-brand">{r.title}</Link> {!!r.overdue && <Badge tone="danger">عقب از دوره</Badge>}
                      {r.gap_window && (
                        <div className="mt-1 text-xs text-muted">
                          فاصلهٔ غیرعادی {faDate(r.gap_window[0])} تا {faDate(r.gap_window[1])}: {r.factors?.length ? r.factors.join('، ') : 'عامل هم‌زمانی ثبت نشده'}
                        </div>
                      )}
                    </td>
                    <td className="p-2 text-center text-xs">{FREQUENCY[r.frequency]} ({toFaDigits(r.expected_days)} روز)</td>
                    <td className="p-2 text-center">{toFaDigits(r.issues)}</td>
                    <td className="p-2 text-center">{r.avg_gap != null ? toFaDigits(Math.round(r.avg_gap)) : '—'}</td>
                    <td className="p-2 text-center">{r.max_gap != null ? toFaDigits(Math.round(r.max_gap)) : '—'}</td>
                    <td className="p-2 text-center font-bold">{r.days_since_last != null ? toFaDigits(Math.round(r.days_since_last)) : 'بدون انتشار'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }}
    </Async>
  )
}

function Directors({ q }: { q: string }) {
  const st = useAsync(() => api.get(`/api/analytics/directors${q}`), [q])
  const [onlyCurrent, setOnlyCurrent] = useState(false)
  return (
    <Async state={st}>
      {(d: any) => {
        const rows = d.rows.filter((r: any) => !onlyCurrent || r.current)
        return (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyCurrent} onChange={(e) => setOnlyCurrent(e.target.checked)} /> فقط مدیران فعلی</label>
            {!rows.length ? <Empty title="داده‌ای نیست" /> : (
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-xs text-muted">
                    <tr><th className="p-2 text-right">مدیرمسئول</th><th className="p-2 text-right">نشریه</th><th className="p-2 text-center">دوره (ماه)</th><th className="p-2 text-center">شماره</th><th className="p-2 text-center">در ماه</th><th className="p-2 text-center">چرخهٔ میانگین</th><th className="p-2 text-center">بازدید</th><th className="p-2 text-center">فروش</th><th className="p-2 text-center">دنبال‌کنندهٔ جدید</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r: any, i: number) => (
                      <tr key={i} className="border-t border-line">
                        <td className="p-2 font-medium">{r.display_name} {r.current && <Badge tone="ok">فعلی</Badge>}</td>
                        <td className="p-2 text-xs"><Link to={`/admin/publications/${r.publication_id}`} className="hover:text-brand">{r.publication_title}</Link><div className="text-muted">{faDate(r.started_at)} — {r.ended_at ? faDate(r.ended_at) : 'اکنون'}</div></td>
                        <td className="p-2 text-center">{toFaDigits(r.months)}</td>
                        <td className="p-2 text-center">{toFaDigits(r.published)}</td>
                        <td className="p-2 text-center">{toFaDigits(Math.round((r.per_month || 0) * 100) / 100)}</td>
                        <td className="p-2 text-center">{r.avg_cycle_days != null ? `${toFaDigits(Math.round(r.avg_cycle_days))} روز` : '—'}</td>
                        <td className="p-2 text-center">{formatNumber(r.views)}</td>
                        <td className="p-2 text-center">{formatNumber(r.digital_sold)}</td>
                        <td className="p-2 text-center">{formatNumber(r.new_followers)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      }}
    </Async>
  )
}

function ExploreStats({ q }: { q: string }) {
  const st = useAsync(() => api.get(`/api/analytics/explore${q}`), [q])
  return (
    <Async state={st}>
      {(d: any) => (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              ['کل نظرها', d.moderation?.total], ['در انتظار', d.moderation?.pending], ['تأییدشده', d.moderation?.approved], ['ردشده', d.moderation?.rejected]
            ].map(([l, v]) => <div key={l as string} className="card p-3"><div className="text-xs text-muted">{l}</div><div className="text-xl font-extrabold">{formatNumber(Number(v || 0))}</div></div>)}
            <div className="card p-3"><div className="text-xs text-muted">میانگین زمان بررسی</div><div className="text-xl font-extrabold">{toFaDigits(Math.round(d.moderation?.avg_hours || 0))} ساعت</div></div>
          </div>
          {d.hourly && (
            <Card title="نقشهٔ حرارتی بازدید: روز هفته × ساعت (به وقت تهران)">
              <Chart
                height={300}
                csvName="weekday-hour"
                option={{
                  grid: { left: 70, bottom: 60 },
                  tooltip: { position: 'top' },
                  xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, h) => toFaDigits(h)), splitArea: { show: true } },
                  yAxis: { type: 'category', data: ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'], splitArea: { show: true } },
                  visualMap: { min: 0, max: Math.max(1, ...d.hourly.map((r: any) => r.n)), calculable: true, orient: 'horizontal', left: 'center', bottom: 0 },
                  series: [{ name: 'بازدید', type: 'heatmap', data: d.hourly.map((r: any) => [r.h, r.d, r.n]) }]
                }}
              />
            </Card>
          )}
          {d.calendar?.length > 0 && (
            <Card title="تقویم حرارتی بازدید روزانه">
              <Chart
                height={200}
                csvName="calendar"
                option={{
                  tooltip: {},
                  visualMap: { min: 0, max: Math.max(1, ...d.calendar.map((r: any) => r.n)), orient: 'horizontal', left: 'center', bottom: 0, show: false },
                  calendar: { range: [d.from, d.to], cellSize: ['auto', 14], top: 30, left: 40, right: 20, dayLabel: { firstDay: 6 } },
                  series: [{ name: 'بازدید', type: 'heatmap', coordinateSystem: 'calendar', data: d.calendar.map((r: any) => [r.day, r.n]) }]
                }}
              />
            </Card>
          )}
          {d.funnel && (
            <Card title="قیف اکسپلور ← خواندن ← خرید (بازدیدکنندهٔ یکتا)">
              <ol className="space-y-2">
                {d.funnel.map((f: any, i: number) => {
                  const top = Math.max(1, d.funnel[0].n)
                  const prev = i ? d.funnel[i - 1].n : 0
                  return (
                    <li key={f.key} className="text-sm">
                      <div className="mb-1 flex justify-between gap-2">
                        <span>{toFaDigits(i + 1)}. {f.label}</span>
                        <span className="text-muted">
                          {formatNumber(f.n)}
                          {i > 0 && prev > 0 && <> · {toFaDigits(Math.round((f.n / prev) * 100))}٪ از مرحلهٔ قبل</>}
                        </span>
                      </div>
                      <div className="h-3 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(2, (f.n / top) * 100)}%` }} />
                      </div>
                    </li>
                  )
                })}
              </ol>
            </Card>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="پست و بازدید هر نشریه">
              {!d.byPub.length ? <Empty title="داده‌ای نیست" /> : <Chart csvName="explore-by-pub" option={{ legend: {}, grid: { left: 110 }, xAxis: { type: 'value' }, yAxis: { type: 'category', inverse: true, data: d.byPub.map((x: any) => x.title) }, series: [{ name: 'بازدید', type: 'bar', data: d.byPub.map((x: any) => x.views) }, { name: 'پست', type: 'bar', data: d.byPub.map((x: any) => x.posts) }] }} height={Math.max(240, d.byPub.length * 28)} />}
            </Card>
            <Card title="پربازدیدترین پست‌ها">
              {!d.top.length ? <Empty title="داده‌ای نیست" /> : (
                <ol className="space-y-2 text-sm">
                  {d.top.map((p: any, i: number) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 border-b border-line pb-2 last:border-0">
                      <Link to={`/post/${p.id}`} className="min-w-0 hover:text-brand">
                        <span className="text-muted">{toFaDigits(i + 1)}. </span>
                        <span className="line-clamp-1">{p.caption || 'بدون متن'}</span>
                        <span className="block text-xs text-muted">{p.publication_title}</span>
                      </Link>
                      <span className="shrink-0 text-xs text-muted">{formatNumber(p.views)} بازدید · {formatNumber(p.saves)} ذخیره · {formatNumber(p.comments)} نظر</span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
        </div>
      )}
    </Async>
  )
}

function Sales({ q }: { q: string }) {
  const st = useAsync(() => api.get(`/api/analytics/sales${q}`), [q])
  return (
    <Async state={st}>
      {(d: any) => {
        const totals = sumSales(d.byIssue)
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="card p-3"><div className="text-xs text-muted">کد ساخته‌شده</div><div className="text-xl font-extrabold">{formatNumber(totals.created)}</div></div>
              <div className="card p-3"><div className="text-xs text-muted">کد استفاده‌شده</div><div className="text-xl font-extrabold">{formatNumber(totals.redeemed)}</div></div>
              <div className="card p-3"><div className="text-xs text-muted">درآمد دیجیتال</div><div className="text-xl font-extrabold">{formatToman(totals.revenue)}</div></div>
              <div className="card p-3"><div className="text-xs text-muted">فروش چاپی</div><div className="text-xl font-extrabold">{formatNumber(totals.print)}</div></div>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card title="کانال‌های پرداخت">
                {!d.channels.length ? <Empty title="داده‌ای نیست" /> : <Chart height={220} option={{ tooltip: { trigger: 'item' }, series: [{ type: 'pie', radius: ['40%', '70%'], data: d.channels.map((c: any) => ({ name: CHANNEL[c.channel] || c.channel, value: c.n })) }] }} />}
              </Card>
              <Card title="فروش به تفکیک شماره" className="lg:col-span-2" action={<button className="btn-ghost !px-2 !py-1" onClick={() => downloadCsv('sales-by-issue', csvOf(['نشریه', 'شماره', 'عنوان', 'قیمت', 'کد ساخته‌شده', 'استفاده‌شده', 'منقضی', 'درآمد', 'فروش چاپی'], d.byIssue.map((r: any) => [r.publication_title, r.number, r.title, r.price_digital, r.codes_created, r.codes_redeemed, r.codes_expired, r.revenue_digital, r.print_sold])))}><Download className="size-4" /></button>}>
                {!d.byIssue.length ? <Empty title="فروشی در این بازه ثبت نشده" /> : (
                  <div className="max-h-[28rem] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-muted"><tr><th className="p-2 text-right">شماره</th><th className="p-2 text-center">کد</th><th className="p-2 text-center">استفاده</th><th className="p-2 text-center">درآمد</th><th className="p-2 text-center">چاپی</th></tr></thead>
                      <tbody>
                        {d.byIssue.map((r: any) => (
                          <tr key={r.id} className="border-t border-line">
                            <td className="p-2"><Link to={`/admin/issues/${r.id}`} className="hover:text-brand">{r.publication_title} · {toFaDigits(r.number)}</Link></td>
                            <td className="p-2 text-center">{formatNumber(r.codes_created)}</td>
                            <td className="p-2 text-center">{formatNumber(r.codes_redeemed)}</td>
                            <td className="p-2 text-center text-xs whitespace-nowrap">{formatToman(r.revenue_digital)}</td>
                            <td className="p-2 text-center">{formatNumber(r.print_sold)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          </div>
        )
      }}
    </Async>
  )
}

function sumSales(rows: any[]) {
  return rows.reduce(
    (a, r) => ({ created: a.created + Number(r.codes_created || 0), redeemed: a.redeemed + Number(r.codes_redeemed || 0), revenue: a.revenue + Number(r.revenue_digital || 0), print: a.print + Number(r.print_sold || 0) }),
    { created: 0, redeemed: 0, revenue: 0, print: 0 }
  )
}


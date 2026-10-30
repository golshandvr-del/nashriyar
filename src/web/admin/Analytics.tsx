import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Download } from 'lucide-react'
import { api, qs } from '../lib/api'
import { FREQUENCY, faDate, faMonthLabel, formatNumber, formatToman, toFaDigits, CHANNEL } from '../lib/format'
import { Async, Badge, Card, Empty, PageHeader, Tabs, useAsync } from '../components/ui'
import { Chart, ExportButtons, downloadCsv } from '../components/Chart'
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
const FILTER_KEYS = ['faculty', 'owner_kind', 'association', 'publication', 'category', 'pricing'] as const
type FilterKey = (typeof FILTER_KEYS)[number]
const OWNER_KINDS: Record<string, string> = { scientific_association: 'انجمن علمی', cultural_club: 'کانون فرهنگی', islamic_association: 'انجمن اسلامی', other: 'سایر' }
const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']
const HEALTH_PARTS: Record<string, string> = { regularity: 'نظم انتشار', activity: 'فعالیت تولید', audience: 'مخاطب', explore: 'اکسپلور', hygiene: 'رسیدگی به نظرها' }
const DEFAULT_HEALTH_WEIGHTS: Record<string, number> = { regularity: 35, activity: 25, audience: 20, explore: 10, hygiene: 10 }

const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
const csvOf = (head: string[], rows: unknown[][]) => [head.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')

export default function AdminAnalytics() {
  const { role } = useAdminRole()
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') as Tab) || 'trends'
  // Range + global filters live in the URL (ROADMAP phase 7) so a view can be bookmarked/shared.
  const def = defaultRange('1y')
  const range = { from: sp.get('from') || def.from, to: sp.get('to') || def.to, key: sp.get('range') || def.key }
  const f = Object.fromEntries(FILTER_KEYS.map((k) => [k, sp.get(k) || ''])) as Record<FilterKey, string>
  const patch = (o: Record<string, string>) => {
    const n = new URLSearchParams(sp)
    for (const [k, v] of Object.entries(o)) v ? n.set(k, v) : n.delete(k)
    setSp(n, { replace: true })
  }
  const setRange = (r: { from: string; to: string; key: string }) => patch({ from: r.from, to: r.to, range: r.key })
  const structure = useAsync(() => (role === 'faculty_supervisor' ? Promise.resolve({ faculties: [], associations: [] }) : api.get('/api/admin/structure')), [role])
  const lists = useAsync(() => Promise.all([api.get('/api/public/categories'), api.get('/api/admin/publications')]), [])
  const q = qs({ from: range.from, to: range.to, ...f })
  const active = FILTER_KEYS.filter((k) => f[k]).length

  return (
    <div className="space-y-4">
      <PageHeader
        title="آمار و تحلیل"
        subtitle="شاخص‌ها و مقایسهٔ نشریات در بازهٔ انتخابی"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RangePicker value={range} onChange={setRange} />
          </div>
        }
      />
      <section id="analytics-filters" className="card flex flex-wrap items-center gap-2 p-3 text-sm" aria-label="فیلترهای سراسری">
        {role !== 'faculty_supervisor' && !!structure.data?.faculties?.length && (
          <select className="input !w-auto" value={f.faculty} onChange={(e) => patch({ faculty: e.target.value })} aria-label="دانشکده">
            <option value="">همهٔ دانشکده‌ها</option>
            {structure.data.faculties.map((x: any) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </select>
        )}
        <select className="input !w-auto" value={f.owner_kind} onChange={(e) => patch({ owner_kind: e.target.value })} aria-label="نوع صاحب امتیاز">
          <option value="">همهٔ صاحبان امتیاز</option>
          {Object.entries(OWNER_KINDS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        {!!structure.data?.associations?.length && (
          <select className="input !w-auto" value={f.association} onChange={(e) => patch({ association: e.target.value })} aria-label="انجمن">
            <option value="">همهٔ انجمن‌ها/کانون‌ها</option>
            {structure.data.associations.map((x: any) => (
              <option key={x.id} value={x.id}>{x.name}{x.faculty_name ? ` — ${x.faculty_name}` : ''}</option>
            ))}
          </select>
        )}
        {!!lists.data?.[1]?.publications?.length && (
          <select className="input !w-auto" value={f.publication} onChange={(e) => patch({ publication: e.target.value })} aria-label="نشریه">
            <option value="">همهٔ نشریات</option>
            {lists.data[1].publications.map((x: any) => (
              <option key={x.id} value={x.id}>{x.title}</option>
            ))}
          </select>
        )}
        {!!lists.data?.[0]?.categories?.length && (
          <select className="input !w-auto" value={f.category} onChange={(e) => patch({ category: e.target.value })} aria-label="دسته یا رشته">
            <option value="">همهٔ دسته‌ها و رشته‌ها</option>
            {lists.data[0].categories.map((x: any) => (
              <option key={x.id} value={x.id}>{x.type === 'major' ? 'رشته: ' : ''}{x.name}</option>
            ))}
          </select>
        )}
        <select className="input !w-auto" value={f.pricing} onChange={(e) => patch({ pricing: e.target.value })} aria-label="رایگان یا پولی">
          <option value="">رایگان و پولی</option>
          <option value="free">رایگان</option>
          <option value="paid">پولی</option>
        </select>
        {active > 0 && (
          <button className="text-xs text-brand" onClick={() => patch(Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])))}>
            پاک‌کردن فیلترها ({toFaDigits(active)})
          </button>
        )}
      </section>
      <Tabs<Tab> value={tab} onChange={(k) => patch({ tab: k })} tabs={TABS} />
      {tab === 'trends' && <Trends q={q} range={range} onDrill={(k, v) => patch({ [k]: v })} />}
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

/** Previous range of the same length, ending the day before `from` (default for the comparison mode). */
function prevSameLength(r: { from: string; to: string }) {
  const D = 86400000
  const len = new Date(r.to).getTime() - new Date(r.from).getTime() + D
  const to = new Date(new Date(r.from).getTime() - D).toISOString().slice(0, 10)
  const from = new Date(new Date(r.from).getTime() - len).toISOString().slice(0, 10)
  return { from, to, key: 'custom' }
}

function Trends({ q, range, onDrill }: { q: string; range: { from: string; to: string; key: string }; onDrill?: (key: FilterKey, value: string) => void }) {
  const [cmp, setCmp] = useState<{ from: string; to: string; key: string } | null>(null)
  const q2 = cmp ? `${q}${q.includes('?') ? '&' : '?'}from2=${cmp.from}&to2=${cmp.to}` : q
  const st = useAsync(() => api.get(`/api/analytics/trends${q2}`), [q2])
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3 p-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!cmp} onChange={(e) => setCmp(e.target.checked ? prevSameLength(range) : null)} />
          حالت مقایسهٔ دو بازه
        </label>
        {cmp && (
          <>
            <span className="text-muted">بازهٔ ۲:</span>
            <RangePicker value={cmp} onChange={setCmp} />
          </>
        )}
      </div>
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
              {!d.byFaculty.length ? <Empty title="داده‌ای نیست" /> : <Chart csvName="by-faculty" onClick={(p) => p?.data?.id && onDrill?.('faculty', p.data.id)} option={{ tooltip: { trigger: 'item' }, series: [{ name: 'شماره', type: 'pie', radius: ['40%', '70%'], data: d.byFaculty.map((x: any) => ({ name: x.name, value: x.n, id: x.id })) }] }} />}
            </Card>
            <Card title="انتشار به تفکیک موضوع">
              {!d.byCategory.length ? <Empty title="داده‌ای نیست" /> : <Chart csvName="by-category" option={{ grid: { left: 110 }, xAxis: { type: 'value', minInterval: 1 }, yAxis: { type: 'category', inverse: true, data: d.byCategory.map((x: any) => x.name) }, legend: {}, series: [{ name: 'شماره', type: 'bar', data: d.byCategory.map((x: any) => ({ value: x.n, id: x.id })) }, { name: 'نشریه', type: 'bar', data: d.byCategory.map((x: any) => ({ value: x.pubs ?? 0, id: x.id })) }] }} onClick={(p) => p?.data?.id && onDrill?.('category', p.data.id)} />}
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
            {d.compare && (
              <Card title="مقایسهٔ رشد دو بازه (منحنی‌های تجمعی هم‌تراز از روز اول)" className="lg:col-span-2">
                <div className="mb-2 grid grid-cols-3 gap-2 text-center text-xs">
                  {(['issues', 'pages', 'views'] as const).map((k) => (
                    <div key={k} className="rounded-xl bg-surface-2 p-2">
                      <div className="text-muted">{{ issues: 'شماره', pages: 'صفحه', views: 'بازدید' }[k]} — شیب در ۳۰ روز</div>
                      <div className="font-bold">
                        {toFaDigits(Math.round(d.compare.a.slope[k] * 10) / 10)} در برابر {toFaDigits(Math.round(d.compare.b.slope[k] * 10) / 10)}
                        {d.compare.growth[k] != null && (
                          <span className={d.compare.growth[k] >= 0 ? 'text-success' : 'text-danger'}> ({d.compare.growth[k] >= 0 ? '+' : ''}{toFaDigits(d.compare.growth[k])}٪)</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <Chart
                  height={260}
                  csvName="compare-ranges"
                  option={{
                    legend: {},
                    tooltip: { trigger: 'axis' },
                    xAxis: { type: 'category', name: 'روز', data: Array.from({ length: Math.max(d.compare.a.days, d.compare.b.days) }, (_, k) => toFaDigits(k + 1)) },
                    yAxis: [{ type: 'value', minInterval: 1 }, { type: 'value' }],
                    series: [
                      { name: `شماره — بازهٔ ۱`, type: 'line', showSymbol: false, data: d.compare.a.issues },
                      { name: `شماره — بازهٔ ۲`, type: 'line', showSymbol: false, lineStyle: { type: 'dashed' }, data: d.compare.b.issues },
                      { name: `بازدید — بازهٔ ۱`, type: 'line', yAxisIndex: 1, showSymbol: false, data: d.compare.a.views },
                      { name: `بازدید — بازهٔ ۲`, type: 'line', yAxisIndex: 1, showSymbol: false, lineStyle: { type: 'dashed' }, data: d.compare.b.views }
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
    </div>
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
  const { role } = useAdminRole()
  const [sort, setSort] = useState('health')
  return (
    <Async state={st}>
      {(d: any) => {
        const val = (r: any, k: string) => (k === 'health' ? r.health?.score ?? 0 : Number(r[k] || 0))
        const rows = [...d.rows].sort((a, b) => val(b, sort) - val(a, sort))
        const rankingCsv = () => (csvOf(['نشریه', 'دانشکده', ...RANK_COLS.map((c) => c.label), 'آخرین انتشار'], rows.map((r) => [r.title, r.faculty_name, ...RANK_COLS.map((c) => val(r, c.key)), faDate(r.last_published_at)])))
        const org = d.org
        const kindLabel = (k: string) => OWNER_KINDS[k] || 'بدون صاحب امتیاز'
        return (
          <div className="space-y-3">
            {org && (
              <section id="org-summary" className="grid gap-3 md:grid-cols-3" aria-label="خلاصهٔ سازمانی">
                <Card title="مجموع در بازه">
                  <div className="text-2xl font-bold">{formatNumber(org.totals?.pages || 0)} <span className="text-sm font-normal text-muted">صفحه</span></div>
                  <div className="text-sm text-muted">{formatNumber(org.totals?.issues || 0)} شمارهٔ منتشرشده</div>
                  <ul className="mt-2 space-y-1 text-xs">
                    {org.activeOwners.map((a: any) => (
                      <li key={a.kind} className="flex justify-between"><span>{kindLabel(a.kind)} فعال</span><b>{formatNumber(a.n)}</b></li>
                    ))}
                  </ul>
                </Card>
                <Card title="صفحات به تفکیک نوع صاحب امتیاز">
                  <table className="w-full text-xs">
                    <thead className="text-muted"><tr><th className="text-right">نوع</th><th>شماره</th><th>صفحه</th></tr></thead>
                    <tbody>
                      {org.byOwnerKind.map((r: any) => (
                        <tr key={r.kind}><td className="py-1">{kindLabel(r.kind)}</td><td className="text-center">{formatNumber(r.issues)}</td><td className="text-center">{formatNumber(r.pages)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
                <Card title="فعال‌ترین دانشکده‌ها">
                  <table className="w-full text-xs">
                    <thead className="text-muted"><tr><th className="text-right">دانشکده</th><th>نشریه</th><th>شماره</th><th>صفحه</th></tr></thead>
                    <tbody>
                      {org.byFaculty.slice(0, 8).map((r: any) => (
                        <tr key={r.id || 'none'}><td className="py-1">{r.name}</td><td className="text-center">{formatNumber(r.pubs)}</td><td className="text-center">{formatNumber(r.issues)}</td><td className="text-center">{formatNumber(r.pages)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  <ExportButtons className="mt-2" name={`faculties-${d.from}-${d.to}`} csv={() => csvOf(['دانشکده', 'نشریه', 'شماره', 'صفحه'], org.byFaculty.map((r: any) => [r.name, r.pubs, r.issues, r.pages]))} />
                </Card>
              </section>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted">این رتبه‌بندی فقط برای مسئولان قابل مشاهده است و هرگز به تیم‌ها نشان داده نمی‌شود. روی عنوان ستون بزنید تا مرتب شود.</p>
              <ExportButtons name={`ranking-${d.from}-${d.to}`} csv={rankingCsv} />
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
            <p className="text-xs text-muted">
              امتیاز سلامت (۰ تا ۱۰۰) = {Object.entries(HEALTH_PARTS).map(([k, l]) => `${l} (وزن ${toFaDigits((d.weights || DEFAULT_HEALTH_WEIGHTS)[k] ?? 0)})`).join(' + ')}، تقسیم بر مجموع وزن‌ها. برای دیدن اجزا نشانگر را روی عدد نگه دارید.
              {role === 'pub_officer' || role === 'super_admin' ? <> وزن‌ها در <Link to="/admin/settings" className="text-brand">تنظیمات</Link> قابل تغییرند.</> : null}
            </p>
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
                  {d[k].low != null && d[k].high != null && d[k].high > d[k].low && (
                    <div className="mt-1 text-xs text-muted">بازهٔ اطمینان تقریبی ۹۵٪: {formatNumber(d[k].low)} تا {formatNumber(d[k].high)}</div>
                  )}
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
          {d.output && (
            <div className="grid grid-cols-2 gap-3">
              <div className="card p-3"><div className="text-xs text-muted">منتشرشده در بازه</div><div className="text-xl font-extrabold">{formatNumber(Number(d.output.published || 0))}</div></div>
              <div className="card p-3"><div className="text-xs text-muted">در دست انتشار (اکنون)</div><div className="text-xl font-extrabold">{formatNumber(Number(d.output.in_progress || 0))}</div></div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-3"><div className="text-xs text-muted">درخواست تأیید</div><div className="text-xl font-extrabold">{formatNumber(d.approvals?.n || 0)}</div></div>
            <div className="card p-3"><div className="text-xs text-muted">میانگین زمان تأیید</div><div className="text-xl font-extrabold">{toFaDigits(Math.round((d.approvals?.avg_days || 0) * 10) / 10)} روز</div></div>
            <div className="card p-3"><div className="text-xs text-muted">درخواست اصلاح</div><div className="text-xl font-extrabold">{formatNumber(d.approvals?.changes || 0)}</div></div>
          </div>
          {!!d.timeline?.length && (() => {
            // Gantt of issues in production: transparent offset bar + duration bar (start → planned date, or today + 14d if unplanned)
            const DAY = 86400000
            const rowsG = d.timeline.map((t: any) => {
              const start = new Date(t.created_at).getTime()
              const end = t.planned_publish_at ? new Date(t.planned_publish_at + 'T23:59:59Z').getTime() : Date.now() + 14 * DAY
              return { label: `${t.publication_title} · ${toFaDigits(t.number ?? '')}`, start, end: Math.max(end, start + DAY), late: !!t.planned_publish_at && end < Date.now(), planned: !!t.planned_publish_at }
            })
            const min = Math.min(...rowsG.map((r: any) => r.start))
            return (
              <Card title="گانت شماره‌های در دست تولید (شروع ← تاریخ برنامه‌ریزی‌شده)">
                <Chart
                  height={Math.max(200, rowsG.length * 26 + 60)}
                  csvName="production-gantt"
                  option={{
                    grid: { left: 170, right: 20 },
                    tooltip: { trigger: 'item', formatter: (p: any) => (p.seriesIndex === 1 ? `${rowsG[p.dataIndex].label}<br/>${faDate(new Date(rowsG[p.dataIndex].start).toISOString())} ← ${faDate(new Date(rowsG[p.dataIndex].end).toISOString())}${rowsG[p.dataIndex].planned ? '' : ' (بدون تاریخ برنامه)'}` : '') },
                    xAxis: { type: 'value', min, axisLabel: { formatter: (v: number) => faDate(new Date(v).toISOString()) } },
                    yAxis: { type: 'category', inverse: true, data: rowsG.map((r: any) => r.label) },
                    series: [
                      { name: 'شروع', type: 'bar', stack: 'g', itemStyle: { color: 'transparent' }, data: rowsG.map((r: any) => r.start) },
                      { name: 'مدت', type: 'bar', stack: 'g', data: rowsG.map((r: any) => ({ value: r.end - r.start, itemStyle: { color: r.late ? '#dc2626' : r.planned ? '#0f766e' : '#94a3b8' } })), markLine: { symbol: 'none', data: [{ xAxis: Date.now(), name: 'امروز' }], label: { formatter: 'امروز' } } }
                    ]
                  }}
                />
                <p className="mt-1 text-xs text-muted">سبز: در برنامه · قرمز: از تاریخ برنامه گذشته · خاکستری: بدون تاریخ برنامه‌ریزی‌شده</p>
              </Card>
            )
          })()}
          {!!d.people?.length && (
            <Card title="افراد فعال و فعالیتشان" action={<button className="btn-ghost !px-2 !py-1" onClick={() => downloadCsv('active-people', csvOf(['نام', 'نشریه', 'فعالیت', 'آخرین فعالیت'], d.people.map((r: any) => [r.display_name, r.publication_title, r.actions, r.last_at])))}><Download className="size-4" /></button>}>
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted"><tr><th className="p-2 text-right">نام</th><th className="p-2 text-right">نشریه</th><th className="p-2 text-center">فعالیت</th><th className="p-2 text-right">آخرین</th></tr></thead>
                  <tbody>
                    {d.people.map((r: any) => (
                      <tr key={`${r.id}-${r.publication_title}`} className="border-t border-line">
                        <td className="p-2">{r.display_name}</td>
                        <td className="p-2 text-xs">{r.publication_title}</td>
                        <td className="p-2 text-center">{formatNumber(r.actions)}</td>
                        <td className="p-2 text-xs text-muted">{faDate(r.last_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
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
                <tr><th className="p-2 text-right">نشریه</th><th className="p-2 text-center">دوره (انتظار)</th><th className="p-2 text-center">شماره‌ها</th><th className="p-2 text-center">میانگین فاصله</th><th className="p-2 text-center">بیشترین فاصله</th><th className="p-2 text-center" title="انحراف معیار ÷ میانگین فاصله‌ها؛ بالاتر = نامنظم‌تر">ضریب تغییرات</th><th className="p-2 text-center">روز از آخرین</th></tr>
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
                      {!!r.intervals?.length && (
                        <div className="mt-1 flex flex-wrap gap-1 text-[11px]" aria-label="فاصلهٔ شماره‌های متوالی">
                          {r.intervals.map((g: any) => (
                            <span key={g.from} className={`rounded px-1 ${g.abnormal ? 'bg-red-100 font-bold text-red-700' : 'bg-surface-2 text-muted'}`} title={`شمارهٔ ${toFaDigits(g.from)} → ${toFaDigits(g.to)}`}>
                              {toFaDigits(g.from)}→{toFaDigits(g.to)}: {toFaDigits(g.days)} روز
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="p-2 text-center text-xs">{FREQUENCY[r.frequency]} ({toFaDigits(r.expected_days)} روز)</td>
                    <td className="p-2 text-center">{toFaDigits(r.issues)}</td>
                    <td className="p-2 text-center">{r.avg_gap != null ? toFaDigits(Math.round(r.avg_gap)) : '—'}</td>
                    <td className="p-2 text-center">{r.max_gap != null ? toFaDigits(Math.round(r.max_gap)) : '—'}</td>
                    <td className="p-2 text-center">{r.cv != null ? <Badge tone={r.cv > 0.6 ? 'danger' : r.cv > 0.3 ? 'warn' : 'ok'}>{toFaDigits(r.cv)}</Badge> : '—'}</td>
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
                    <tr><th className="p-2 text-right">مدیرمسئول</th><th className="p-2 text-right">نشریه</th><th className="p-2 text-center">دوره (ماه)</th><th className="p-2 text-center">شماره</th><th className="p-2 text-center">در ماه</th><th className="p-2 text-center">صفحه در ماه</th><th className="p-2 text-center">چرخهٔ میانگین</th><th className="p-2 text-center">بازدید</th><th className="p-2 text-center">فروش</th><th className="p-2 text-center">دنبال‌کنندهٔ جدید</th><th className="p-2 text-center">تأخیر</th><th className="p-2 text-center">تحقق دوره</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r: any, i: number) => (
                      <tr key={i} className="border-t border-line">
                        <td className="p-2 font-medium">{r.display_name} {r.current && <Badge tone="ok">فعلی</Badge>}</td>
                        <td className="p-2 text-xs"><Link to={`/admin/publications/${r.publication_id}`} className="hover:text-brand">{r.publication_title}</Link><div className="text-muted">{faDate(r.started_at)} — {r.ended_at ? faDate(r.ended_at) : 'اکنون'}</div></td>
                        <td className="p-2 text-center">{toFaDigits(r.months)}</td>
                        <td className="p-2 text-center">{toFaDigits(r.published)}</td>
                        <td className="p-2 text-center">{toFaDigits(Math.round((r.per_month || 0) * 100) / 100)}</td>
                        <td className="p-2 text-center">{toFaDigits(Math.round((Number(r.pages || 0) / Math.max(1, Number(r.months || 1))) * 10) / 10)}</td>
                        <td className="p-2 text-center">{r.avg_cycle_days != null ? `${toFaDigits(Math.round(r.avg_cycle_days))} روز` : '—'}</td>
                        <td className="p-2 text-center">{formatNumber(r.views)}</td>
                        <td className="p-2 text-center">{formatNumber(r.digital_sold)}</td>
                        <td className="p-2 text-center">{formatNumber(r.new_followers)}</td>
                        <td className="p-2 text-center">{r.late ? `${toFaDigits(r.late)} شماره${r.avg_late_days != null ? ` (${toFaDigits(r.avg_late_days)} روز)` : ''}` : '—'}</td>
                        <td className="p-2 text-center">{r.fulfilment != null ? <Badge tone={r.fulfilment >= 80 ? 'ok' : r.fulfilment >= 50 ? 'warn' : 'danger'}>{toFaDigits(r.fulfilment)}٪</Badge> : '—'}</td>
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
          {d.totals && (
            <section id="explore-public-space" className="grid gap-3 md:grid-cols-3" aria-label="فضای عمومی">
              <div className="card p-3">
                <div className="text-xs text-muted">بازدید کل فضای عمومی</div>
                <div className="text-2xl font-extrabold">{formatNumber(d.totals.views || 0)}</div>
                <div className="text-xs text-muted">{formatNumber(d.totals.uniq || 0)} بازدیدکنندهٔ یکتا</div>
              </div>
              <Card title="پربازدیدترین دسته‌ها">
                <ol className="space-y-1 text-xs">
                  {(d.byCategory || []).slice(0, 6).map((r: any) => (
                    <li key={r.id} className="flex justify-between"><span>{r.name}</span><span>{formatNumber(r.views)} <span className="text-muted">({formatNumber(r.uniq)} یکتا)</span></span></li>
                  ))}
                </ol>
              </Card>
              <Card title="انجمن‌ها و کانون‌های پربازدید">
                <ol className="space-y-1 text-xs">
                  {(d.byAssociation || []).slice(0, 6).map((r: any) => (
                    <li key={r.id} className="flex justify-between"><span>{r.name}</span><span>{formatNumber(r.views)} <span className="text-muted">({formatNumber(r.uniq)} یکتا)</span></span></li>
                  ))}
                </ol>
              </Card>
            </section>
          )}
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
        // server totals (ROADMAP phase 7); fall back to summing byIssue for older responses
        const fb = sumSales(d.byIssue)
        const t = d.totals || { codes_created: fb.created, codes_redeemed: fb.redeemed, revenue_digital: fb.revenue, print_sold: fb.print, codes_expired: 0, use_rate: 0, revenue_print: 0 }
        const kpi = (label: string, value: string) => (
          <div className="card p-3"><div className="text-xs text-muted">{label}</div><div className="text-xl font-extrabold">{value}</div></div>
        )
        const breakdown = (rows: any[] | undefined, name: string) =>
          !rows?.length ? <Empty title="داده‌ای نیست" /> : (
            <table className="w-full text-xs">
              <thead className="text-muted"><tr><th className="text-right">{name}</th><th>فروش</th><th>درآمد</th></tr></thead>
              <tbody>
                {rows.slice(0, 10).map((r: any) => (
                  <tr key={r.id || r.name || 'none'} className="border-t border-line"><td className="py-1">{r.title || r.name}</td><td className="text-center">{formatNumber(r.sold)}</td><td className="text-center whitespace-nowrap">{formatToman(r.revenue)}</td></tr>
                ))}
              </tbody>
            </table>
          )
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {kpi('کد ساخته‌شده', formatNumber(t.codes_created))}
              {kpi('کد استفاده‌شده', formatNumber(t.codes_redeemed))}
              {kpi('کد منقضی‌شدهٔ بدون استفاده', formatNumber(t.codes_expired))}
              {kpi('نرخ استفاده', `${toFaDigits(t.use_rate)}٪`)}
              {kpi('درآمد دیجیتال', formatToman(t.revenue_digital))}
              {kpi('فروش چاپی (نسخه)', formatNumber(t.print_sold))}
              {kpi('درآمد اعلامی چاپی', formatToman(t.revenue_print))}
              {kpi('مجموع درآمد اعلامی', formatToman(Number(t.revenue_digital || 0) + Number(t.revenue_print || 0)))}
            </div>
            {!!d.monthly?.length && (
              <Card title="روند فروش دیجیتال (ماهانه)">
                <Chart csvName="sales-trend" option={{ legend: {}, xAxis: { type: 'category', data: d.monthly.map((r: any) => faMonthLabel(r.m)) }, yAxis: [{ type: 'value', minInterval: 1 }, { type: 'value' }], series: [{ name: 'فروش', type: 'bar', data: d.monthly.map((r: any) => r.sold) }, { name: 'درآمد', type: 'line', yAxisIndex: 1, smooth: true, data: d.monthly.map((r: any) => r.revenue) }] }} />
              </Card>
            )}
            {d.byPublication && (
              <div className="grid gap-4 lg:grid-cols-3">
                <Card title="به تفکیک نشریه">{breakdown(d.byPublication, 'نشریه')}</Card>
                <Card title="به تفکیک دانشکده">{breakdown(d.byFaculty, 'دانشکده')}</Card>
                <Card title="به تفکیک دسته">{breakdown(d.byCategory, 'دسته')}</Card>
              </div>
            )}
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


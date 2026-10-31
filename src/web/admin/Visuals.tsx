// Phase 14 visual analytics: Jalali calendar heatmap, production funnel, faculty → association → publication sunburst,
// per-publication health radar, year-over-year (academic year, Mehr first), subject share and the deadlines Gantt.
// All fed by one call: GET /api/analytics/visuals (scoped + cached on the server).
import { useMemo, useState } from 'react'
import { api } from '../lib/api'
import { faDate, formatNumber, toFaDigits } from '../lib/format'
import { JALALI_MONTHS, toJalali } from '../../shared/fa'
import { Async, Card, Empty, useAsync } from '../components/ui'
import { Chart, PALETTE } from '../components/Chart'

const DAY = 86400000
const WEEK_FA = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه']
const RADAR_AXES: { key: string; label: string }[] = [
  { key: 'regularity', label: 'نظم انتشار' },
  { key: 'engagement', label: 'تعامل' },
  { key: 'sales', label: 'فروش' },
  { key: 'team', label: 'تیم' },
  { key: 'ontime', label: 'به‌موقع بودن' }
]
const STATUS_FA: Record<string, string> = { planning: 'برنامه‌ریزی', in_production: 'در تولید', changes_requested: 'نیازمند اصلاح', awaiting_approval: 'در انتظار تأیید' }
const item = { trigger: 'item' }

const jOfTs = (t: number) => {
  const d = new Date(t)
  return toJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}
const shortFa = (t: number) => {
  const j = jOfTs(t)
  return `${toFaDigits(j.jd)} ${JALALI_MONTHS[j.jm - 1]}`
}

export default function Visuals({ q }: { q: string }) {
  const st = useAsync(() => api.get<any>(`/api/analytics/visuals${q}`), [q])
  return <Async state={st}>{(d: any) => <VisualsBody d={d} />}</Async>
}

function VisualsBody({ d }: { d: any }) {
  return (
    <div id="analytics-visuals" className="space-y-4">
      <JalaliHeatmap d={d} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Funnel d={d} />
        <Sunburst d={d} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Radar d={d} />
        <Subjects d={d} />
      </div>
      <YearOverYear d={d} />
      <Gantt d={d} />
    </div>
  )
}

function JalaliHeatmap({ d }: { d: any }) {
  const [metric, setMetric] = useState<'views' | 'published'>('views')
  const opt = useMemo(() => {
    const map = new Map<string, any>((d.heat || []).map((r: any) => [r.d, r]))
    const start = new Date(d.from + 'T00:00:00Z').getTime()
    const end = new Date(d.to + 'T00:00:00Z').getTime()
    const dow = (t: number) => (new Date(t).getUTCDay() + 1) % 7 // Saturday = 0
    const first = start - dow(start) * DAY
    const weeks = Math.floor((end - first) / DAY / 7) + 1
    const labels: string[] = []
    let prevMonth = -1
    for (let w = 0; w < weeks; w++) {
      const j = jOfTs(first + w * 7 * DAY)
      labels.push(j.jm !== prevMonth ? JALALI_MONTHS[j.jm - 1] : '')
      prevMonth = j.jm
    }
    const data: [number, number, number, string][] = []
    let max = 1
    for (let t = start; t <= end; t += DAY) {
      const iso = new Date(t).toISOString().slice(0, 10)
      const v = Number(map.get(iso)?.[metric] || 0)
      max = Math.max(max, v)
      data.push([Math.floor((t - first) / DAY / 7), dow(t), v, iso])
    }
    return {
      tooltip: { ...item, formatter: (p: any) => `${faDate(p.data[3])}<br/>${metric === 'views' ? 'بازدید' : 'شمارهٔ منتشرشده'}: ${toFaDigits(p.data[2])}` },
      grid: { left: 8, right: 8, top: 8, bottom: 40, containLabel: true },
      xAxis: { type: 'category', data: labels, splitArea: { show: false }, axisTick: { show: false }, axisLabel: { interval: 0, formatter: (x: string) => x } },
      yAxis: { type: 'category', data: WEEK_FA, inverse: true, axisTick: { show: false }, axisLabel: { formatter: (x: string) => x } },
      visualMap: { min: 0, max, dimension: 2, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 120, calculable: false, inRange: { color: ['#e6f4f1', '#0f766e'] }, textStyle: { fontFamily: 'inherit' }, formatter: (v: number) => toFaDigits(Math.round(v)) },
      series: [{ type: 'heatmap', data, itemStyle: { borderColor: 'rgba(255,255,255,0.6)', borderWidth: 1 } }]
    }
  }, [d, metric])
  return (
    <Card
      title="تقویم حرارتی (شمسی)"
      action={
        <select className="input !w-auto max-w-full !py-1 text-sm" value={metric} onChange={(e) => setMetric(e.target.value as any)} aria-label="شاخص تقویم">
          <option value="views">بازدید روزانه</option>
          <option value="published">انتشار شماره</option>
        </select>
      }
    >
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <Chart option={opt} height={230} />
        </div>
      </div>
    </Card>
  )
}

function Funnel({ d }: { d: any }) {
  const c = d.funnel?.counts || {}
  const a = d.funnel?.avg_days || {}
  const days = (v: number | null) => (v == null ? '—' : `${toFaDigits(v)} روز`)
  const steps = [
    { name: 'برنامه‌ریزی', value: c.planning || 0, note: `تا شروع تولید: ${days(a.planning)}` },
    { name: 'تولید', value: c.production || 0, note: `تا درخواست تأیید: ${days(a.production)}` },
    { name: 'انتظار تأیید', value: c.awaiting || 0, note: `تا انتشار: ${days(a.awaiting)}` },
    { name: 'منتشرشده', value: c.published || 0, note: '' }
  ]
  const opt = {
    tooltip: { ...item, formatter: (p: any) => `${p.name}: ${toFaDigits(p.value)} شماره${p.data.note ? '<br/>' + p.data.note : ''}` },
    series: [
      {
        type: 'funnel',
        left: '8%',
        width: '84%',
        top: 10,
        bottom: 10,
        sort: 'none',
        gap: 3,
        minSize: '20%',
        label: { position: 'inside', fontFamily: 'inherit', formatter: (p: any) => `${p.name}\n${toFaDigits(p.value)}` },
        data: steps
      }
    ]
  }
  return (
    <Card title="قیف تولید شماره">
      {!c.planning ? (
        <Empty title="در این بازه شماره‌ای آغاز نشده" />
      ) : (
        <>
          <Chart option={opt} height={260} />
          <ul className="mt-2 grid grid-cols-1 gap-1 text-xs text-muted sm:grid-cols-3">
            <li>برنامه‌ریزی ← تولید: <b className="text-ink">{days(a.planning)}</b></li>
            <li>تولید ← انتظار تأیید: <b className="text-ink">{days(a.production)}</b></li>
            <li>انتظار تأیید ← انتشار: <b className="text-ink">{days(a.awaiting)}</b></li>
          </ul>
        </>
      )}
    </Card>
  )
}

function Sunburst({ d }: { d: any }) {
  const [metric, setMetric] = useState<'published' | 'views'>('published')
  const data = useMemo(
    () =>
      (d.sunburst || []).map((f: any, i: number) => ({
        name: f.name,
        itemStyle: { color: PALETTE[i % PALETTE.length] },
        children: f.children.map((a: any) => ({ name: a.name, children: a.children.map((p: any) => ({ name: p.name, value: Number(p[metric] || 0) })) }))
      })),
    [d, metric]
  )
  const total = data.reduce((s: number, f: any) => s + f.children.reduce((x: number, a: any) => x + a.children.reduce((y: number, p: any) => y + p.value, 0), 0), 0)
  const opt = {
    tooltip: { ...item, formatter: (p: any) => `${(p.treePathInfo || []).slice(1).map((x: any) => x.name).join(' ← ')}<br/>${toFaDigits(formatNumber(p.value || 0))}` },
    series: [
      {
        type: 'sunburst',
        data,
        radius: ['12%', '95%'],
        sort: undefined,
        emphasis: { focus: 'ancestor' },
        label: { fontFamily: 'inherit', minAngle: 12, overflow: 'truncate', width: 70 },
        levels: [{}, { r0: '12%', r: '40%', label: { rotate: 'tangential' } }, { r0: '40%', r: '68%', label: { minAngle: 18 } }, { r0: '68%', r: '95%', label: { minAngle: 22, position: 'outside', show: false } }]
      }
    ]
  }
  return (
    <Card
      title="دانشکده ← انجمن ← نشریه"
      action={
        <select className="input !w-auto max-w-full !py-1 text-sm" value={metric} onChange={(e) => setMetric(e.target.value as any)} aria-label="شاخص سان‌برست">
          <option value="published">انتشار</option>
          <option value="views">بازدید</option>
        </select>
      }
    >
      {!total ? <Empty title="در این بازه داده‌ای نیست" /> : <Chart option={opt} height={300} />}
    </Card>
  )
}

function Radar({ d }: { d: any }) {
  const list: any[] = d.radar || []
  const [id, setId] = useState<string>('')
  const pub = list.find((p) => p.id === id) || list[0]
  if (!pub) return <Card title="رادار سلامت نشریه"><Empty /></Card>
  const avg = Object.fromEntries(RADAR_AXES.map((a) => [a.key, Math.round(list.reduce((s, p) => s + (p.axes[a.key] || 0), 0) / list.length)]))
  const opt = {
    tooltip: item,
    legend: { data: [pub.title, 'میانگین نشریات'] },
    radar: { indicator: RADAR_AXES.map((a) => ({ name: a.label, max: 100 })), radius: '62%', center: ['50%', '56%'], axisName: { fontFamily: 'inherit' } },
    series: [
      {
        type: 'radar',
        data: [
          { name: pub.title, value: RADAR_AXES.map((a) => pub.axes[a.key] || 0), areaStyle: { opacity: 0.25 } },
          { name: 'میانگین نشریات', value: RADAR_AXES.map((a) => avg[a.key]), lineStyle: { type: 'dashed' }, itemStyle: { color: '#94a3b8' } }
        ]
      }
    ]
  }
  return (
    <Card
      title="رادار سلامت نشریه"
      action={
        <select className="input !w-auto max-w-full !py-1 text-sm" value={pub.id} onChange={(e) => setId(e.target.value)} aria-label="انتخاب نشریه برای رادار">
          {list.map((p) => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>
      }
    >
      <Chart option={opt} height={300} />
      <p className="mt-1 text-xs text-muted">هر محور از ۰ تا ۱۰۰ است. تعامل، فروش و تیم نسبت به بهترین نشریه سنجیده می‌شوند.</p>
    </Card>
  )
}

function Subjects({ d }: { d: any }) {
  const cats: any[] = d.categories || []
  const opt = {
    tooltip: { ...item, formatter: (p: any) => `${p.name}: ${toFaDigits(p.value)} شماره (${toFaDigits(Math.round(p.percent))}٪)` },
    legend: { type: 'scroll', bottom: 0, top: 'auto' },
    series: [{ type: 'pie', radius: ['38%', '68%'], center: ['50%', '45%'], label: { fontFamily: 'inherit', formatter: (p: any) => `${toFaDigits(Math.round(p.percent))}٪` }, data: cats.map((c) => ({ name: c.name, value: c.n })) }]
  }
  return <Card title="سهم دسته‌های موضوعی (سال تحصیلی جاری)">{!cats.length ? <Empty title="هنوز شماره‌ای در سال تحصیلی جاری منتشر نشده" /> : <Chart option={opt} height={300} csvName="subjects-share" />}</Card>
}

function YearOverYear({ d }: { d: any }) {
  const y = d.yoy || { years: [], month_labels: [] }
  const opt = {
    legend: {},
    xAxis: { type: 'category', data: y.month_labels, axisLabel: { formatter: (x: string) => x } },
    yAxis: { type: 'value', minInterval: 1 },
    series: y.years.map((r: any, i: number) => ({
      name: `سال ${toFaDigits(r.label)}`,
      type: i === y.years.length - 1 ? 'bar' : 'line',
      smooth: true,
      data: r.months,
      lineStyle: i === y.years.length - 1 ? undefined : { type: i === 0 ? 'dotted' : 'dashed' }
    }))
  }
  return (
    <Card title="مقایسهٔ سال‌به‌سال انتشار (از مهر)">
      <Chart option={opt} height={280} csvName="year-over-year" />
    </Card>
  )
}

function Gantt({ d }: { d: any }) {
  const issues: any[] = d.gantt?.issues || []
  const deadlines: any[] = d.gantt?.deadlines || []
  if (!issues.length) return <Card title="گانت برنامهٔ انتشار و مهلت‌ها"><Empty title="شماره‌ای در دست تولید نیست" /></Card>
  const now = Date.now()
  const rows = issues.map((t) => {
    const start = new Date(t.created_at).getTime()
    const planned = t.planned_publish_at ? new Date(t.planned_publish_at + 'T23:59:59Z').getTime() : null
    const end = Math.max(planned ?? now + 14 * DAY, start + DAY)
    return { label: `${t.publication_title} · ${toFaDigits(t.number ?? '')}`, start, end, late: planned != null && planned < now, planned: planned != null, status: t.status }
  })
  const color = (r: any) => (r.late ? '#dc2626' : !r.planned ? '#94a3b8' : r.status === 'awaiting_approval' ? '#d97706' : '#0f766e')
  const opt = {
    tooltip: {
      ...item,
      formatter: (p: any) => {
        if (p.componentType === 'markLine') return `مهلت: ${p.name}<br/>${faDate(new Date(p.value).toISOString())}`
        const r = rows[p.data.value[0]]
        return `${r.label}<br/>${STATUS_FA[r.status] || r.status}<br/>${shortFa(r.start)} ← ${r.planned ? shortFa(r.end) : 'بدون تاریخ برنامه'}${r.late ? '<br/><b>عقب‌تر از برنامه</b>' : ''}`
      }
    },
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    xAxis: { type: 'time', axisLabel: { formatter: (v: number) => shortFa(v) } },
    yAxis: { type: 'category', data: rows.map((r) => r.label), inverse: true, axisLabel: { formatter: (x: string) => (x.length > 26 ? x.slice(0, 25) + '…' : x) } },
    series: [
      {
        type: 'custom',
        encode: { x: [1, 2], y: 0 },
        data: rows.map((r, i) => ({ value: [i, r.start, r.end], itemStyle: { color: color(r) } })),
        renderItem: (_: any, a: any) => {
          const y = a.value(0)
          const s = a.coord([a.value(1), y])
          const e = a.coord([a.value(2), y])
          const h = a.size([0, 1])[1] * 0.55
          return { type: 'rect', shape: { x: Math.min(s[0], e[0]), y: s[1] - h / 2, width: Math.max(2, Math.abs(e[0] - s[0])), height: h, r: 3 }, style: { fill: color(rows[y]) } }
        },
        markLine: {
          symbol: 'none',
          label: { formatter: (p: any) => p.name, fontFamily: 'inherit', position: 'end' },
          lineStyle: { type: 'dashed', color: '#7c3aed' },
          data: [{ name: 'امروز', xAxis: now, lineStyle: { color: '#64748b' } }, ...deadlines.map((x) => ({ name: x.title, xAxis: new Date(x.due_at).getTime() }))]
        }
      }
    ]
  }
  return (
    <Card title="گانت برنامهٔ انتشار و مهلت‌ها">
      <div className="mb-2 flex flex-wrap gap-3 text-xs text-muted">
        <span><i className="inline-block size-2.5 rounded-sm bg-[#0f766e]" /> طبق برنامه</span>
        <span><i className="inline-block size-2.5 rounded-sm bg-[#d97706]" /> در انتظار تأیید</span>
        <span><i className="inline-block size-2.5 rounded-sm bg-[#dc2626]" /> عقب‌تر از برنامه</span>
        <span><i className="inline-block size-2.5 rounded-sm bg-[#94a3b8]" /> بدون تاریخ برنامه</span>
        <span><i className="inline-block h-0.5 w-4 bg-[#7c3aed] align-middle" /> مهلت رسمی</span>
      </div>
      <Chart option={opt} height={Math.max(220, rows.length * 28 + 60)} />
    </Card>
  )
}

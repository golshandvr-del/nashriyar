// Tree-shaken ECharts wrapper: theme-aware (reads CSS tokens, re-renders on theme change), Persian font, RTL legend,
// responsive (ResizeObserver) and with a one-click CSV export of the underlying series.
import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart, ScatterChart, HeatmapChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent, DataZoomComponent, MarkLineComponent, VisualMapComponent, CalendarComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { Download, FileSpreadsheet } from 'lucide-react'
import { toFaDigits } from '../lib/format'
import { downloadXlsxFromCsv } from '../lib/xlsx'

echarts.use([BarChart, LineChart, PieChart, ScatterChart, HeatmapChart, GridComponent, LegendComponent, TooltipComponent, DataZoomComponent, MarkLineComponent, VisualMapComponent, CalendarComponent, SVGRenderer])

export type EOption = Record<string, any>

function tokens() {
  const s = getComputedStyle(document.documentElement)
  const v = (n: string) => s.getPropertyValue(n).trim()
  return { text: v('--text'), muted: v('--muted'), line: v('--line'), brand: v('--brand'), surface: v('--surface'), danger: v('--danger'), warn: v('--warn'), ok: v('--ok') }
}

export const PALETTE = ['#0f766e', '#2563eb', '#d97706', '#db2777', '#7c3aed', '#059669', '#dc2626', '#0891b2', '#65a30d', '#9333ea']

function themed(opt: EOption): EOption {
  const t = tokens()
  const axis = (a: any) =>
    a && {
      axisLine: { lineStyle: { color: t.line } },
      splitLine: { lineStyle: { color: t.line, type: 'dashed' } },
      ...a,
      axisLabel: { color: t.muted, fontFamily: 'inherit', formatter: (x: any) => toFaDigits(String(x)), ...(a.axisLabel || {}) }
    }
  const mapAxis = (a: any) => (Array.isArray(a) ? a.map(axis) : axis(a))
  return {
    color: [t.brand, ...PALETTE.slice(1)],
    textStyle: { fontFamily: 'VazirFD, Vazirmatn, Tahoma, sans-serif', color: t.text },
    grid: { left: 12, right: 12, top: opt.legend ? 36 : 16, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: t.surface,
      borderColor: t.line,
      textStyle: { color: t.text, fontFamily: 'inherit' },
      valueFormatter: (v: any) => (typeof v === 'number' ? v.toLocaleString('fa-IR') : v),
      ...(opt.tooltip || {})
    },
    ...opt,
    legend: opt.legend ? { textStyle: { color: t.muted, fontFamily: 'inherit' }, top: 0, right: 0, ...opt.legend } : undefined,
    xAxis: mapAxis(opt.xAxis),
    yAxis: mapAxis(opt.yAxis)
  }
}

/** CSV of category axis + each series (works for the common line/bar shapes). */
function toCsv(opt: EOption): string | null {
  const x = Array.isArray(opt.xAxis) ? opt.xAxis[0] : opt.xAxis
  const series = (opt.series || []) as any[]
  if (series[0]?.type === 'pie') {
    return ['نام,مقدار', ...(series[0].data || []).map((d: any) => `"${d.name}",${d.value}`)].join('\n')
  }
  if (!x?.data) return null
  const head = ['دسته', ...series.map((s) => `"${s.name || ''}"`)].join(',')
  const rows = x.data.map((c: any, i: number) => [`"${c}"`, ...series.map((s) => (Array.isArray(s.data?.[i]) ? s.data[i][1] : (s.data?.[i]?.value ?? s.data?.[i] ?? '')))].join(','))
  return [head, ...rows].join('\n')
}

export function downloadCsv(name: string, csv: string) {
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${name}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function Chart({ option, height = 260, csvName, onClick, className }: { option: EOption; height?: number; csvName?: string; onClick?: (p: any) => void; className?: string }) {
  const el = useRef<HTMLDivElement>(null)
  const inst = useRef<echarts.ECharts | null>(null)
  const clickRef = useRef(onClick)
  clickRef.current = onClick

  useEffect(() => {
    if (!el.current) return
    const c = echarts.init(el.current, undefined, { renderer: 'svg' })
    inst.current = c
    c.on('click', (p) => clickRef.current?.(p))
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      c.dispose()
      inst.current = null
    }
  }, [])

  useEffect(() => {
    const render = () => inst.current?.setOption(themed(option), true)
    render()
    window.addEventListener('nsh:theme', render)
    return () => window.removeEventListener('nsh:theme', render)
  }, [option])

  const csv = csvName ? toCsv(option) : null
  return (
    <div className={className ? `relative ${className}` : 'relative'}>
      {csv && (
        <div className="no-print absolute top-0 left-0 z-10 flex">
        <button className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink" title="دریافت CSV" aria-label="دریافت CSV" onClick={() => downloadCsv(csvName!, csv)}>
          <Download className="size-4" />
        </button>
        <button className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink" title="دریافت Excel" aria-label="دریافت Excel" onClick={() => downloadXlsxFromCsv(csvName!, csv)}>
          <FileSpreadsheet className="size-4" />
        </button>
        </div>
      )}
      <div ref={el} style={{ height }} dir="ltr" />
    </div>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LayoutGrid, Plus, Table2 } from 'lucide-react'
import { api, mediaUrl } from '../lib/api'
import { ISSUE_STATUS, faDate, formatNumber } from '../lib/format'
import { Async, Badge, Empty, PageHeader, Progress, useAsync } from '../components/ui'
import { Cover } from '../components/cards'
import { useTeam } from './Layout'
import { DataTable, fetchAllPages } from '../components/DataTable'
import { ISSUE_COLUMNS } from '../../shared/columns'

const FILTERS = [
  { k: 'all', label: 'همه' },
  { k: 'active', label: 'در جریان' },
  { k: 'awaiting_approval', label: 'در انتظار تأیید' },
  { k: 'published', label: 'منتشرشده' }
] as const

export default function TeamIssues() {
  const { pubId, base } = useTeam()
  const [f, setF] = useState<(typeof FILTERS)[number]['k']>('all')
  // ROADMAP phase 18: every keyset page is loaded so the table view (DataTable) holds the whole list
  const st = useAsync(async () => ({ issues: (await fetchAllPages(`/api/team/${pubId}/issues`, 'issues')).rows }), [pubId])
  const [view, setView] = useState<'cards' | 'table'>(() => (localStorage.getItem('issues-view') === 'table' ? 'table' : 'cards'))
  const pickView = (v: 'cards' | 'table') => (setView(v), localStorage.setItem('issues-view', v))
  return (
    <div>
      <PageHeader
        title="شماره‌ها"
        actions={
          <Link to={`${base}/issues/new`} className="btn-primary">
            <Plus className="size-4" /> شمارهٔ جدید
          </Link>
        }
      />
      <div className="no-scrollbar mb-4 flex items-center gap-2 overflow-x-auto">
        <span className="inline-flex shrink-0 rounded-xl border border-line p-0.5" role="group" aria-label="نوع نمایش">
          <button type="button" className={`rounded-lg p-1.5 ${view === 'cards' ? 'bg-brand-soft text-brand' : 'text-muted'}`} aria-pressed={view === 'cards'} aria-label="نمایش کارتی" title="نمایش کارتی" onClick={() => pickView('cards')}>
            <LayoutGrid className="size-4" />
          </button>
          <button type="button" className={`rounded-lg p-1.5 ${view === 'table' ? 'bg-brand-soft text-brand' : 'text-muted'}`} aria-pressed={view === 'table'} aria-label="نمایش جدولی" title="نمایش جدولی" onClick={() => pickView('table')}>
            <Table2 className="size-4" />
          </button>
        </span>
        {view === 'cards' && FILTERS.map((x) => (
          <button key={x.k} onClick={() => setF(x.k)} className={x.k === f ? 'chip border-brand bg-brand-soft font-bold text-brand' : 'chip'}>
            {x.label}
          </button>
        ))}
      </div>
      <Async state={st}>
        {(d: any) => {
          if (view === 'table')
            return (
              <DataTable
                id="team-issues"
                title="شماره‌ها"
                columns={ISSUE_COLUMNS}
                rows={d.issues}
                rowKey={(i) => String(i.id)}
                exportUrl={`/api/team/${pubId}/issues/export`}
                empty={<Empty title="هنوز شماره‌ای ساخته نشده" action={<Link to={`${base}/issues/new`} className="btn-primary">شمارهٔ جدید</Link>} />}
                render={{
                  number: (i: any) => (
                    <Link to={`${base}/issues/${i.id}`} className="font-bold hover:text-brand">
                      {formatNumber(i.number)}
                    </Link>
                  ),
                  title: (i: any) => (
                    <Link to={`${base}/issues/${i.id}`} className="hover:text-brand">
                      {i.title}
                    </Link>
                  ),
                  status: (i: any) => {
                    const s = ISSUE_STATUS[i.status] || { label: i.status, tone: 'muted' as const }
                    return <Badge tone={s.tone}>{s.label}</Badge>
                  }
                }}
              />
            )
          const rows = d.issues.filter((i: any) =>
            f === 'all' ? true : f === 'active' ? ['planning', 'in_production', 'changes_requested'].includes(i.status) : i.status === f
          )
          if (!rows.length) return <Empty title="شماره‌ای در این فهرست نیست" action={<Link to={`${base}/issues/new`} className="btn-primary">شمارهٔ جدید</Link>} />
          return (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((i: any) => {
                const s = ISSUE_STATUS[i.status] || { label: i.status, tone: 'muted' as const }
                return (
                  <Link key={i.id} to={`${base}/issues/${i.id}`} className="card flex gap-3 p-3 hover:border-brand">
                    <Cover src={mediaUrl(i.cover_key)} title={i.title} className="w-16 shrink-0" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold">شمارهٔ {formatNumber(i.number)}</span>
                        <Badge tone={s.tone}>{s.label}</Badge>
                      </div>
                      <p className="truncate text-sm">{i.title}</p>
                      <div className="text-[11px] text-muted">
                        {i.status === 'published'
                          ? `منتشرشده ${faDate(i.published_at)} · ${formatNumber(i.page_count || 0)} صفحه · ${i.pricing === 'paid' ? 'پولی' : 'رایگان'}`
                          : i.planned_publish_at
                            ? `برنامهٔ انتشار: ${faDate(i.planned_publish_at)}`
                            : 'بدون تاریخ انتشار'}
                      </div>
                      {i.status !== 'published' && (
                        <div className="text-[11px] text-muted">
                          فهرست مطالب {formatNumber(i.toc_done)}/{formatNumber(i.toc_total)}
                          <Progress value={i.toc_total ? (i.toc_done / i.toc_total) * 100 : 0} className="mt-1" />
                        </div>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          )
        }}
      </Async>
    </div>
  )
}

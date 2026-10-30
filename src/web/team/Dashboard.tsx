import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarClock, MessageCircle, Pin, Plus, Users } from 'lucide-react'
import { api, mediaUrl } from '../lib/api'
import { ISSUE_STATUS, faDate, formatNumber, relativeFa } from '../lib/format'
import { Async, Badge, Card, Empty, PageHeader, Progress, Stat, useAsync } from '../components/ui'
import { Cover } from '../components/cards'
import { useTeam } from './Layout'

export default function TeamDashboard() {
  const { pubId, base } = useTeam()
  const st = useAsync(() => api.get(`/api/team/${pubId}/dashboard`), [pubId])
  return (
    <Async state={st}>
      {(d: any) => {
        const active = d.issues.filter((i: any) => !['published', 'archived'].includes(i.status))
        const published = d.issues.filter((i: any) => i.status === 'published')
        const overdue = [...d.overdue.map((o: any) => ({ ...o, kind: 'بخش' })), ...d.overdueStages.map((o: any) => ({ ...o, kind: 'مرحله' }))]
        return (
          <div className="space-y-5">
            <PageHeader
              title={d.publication.title}
              subtitle={d.publication.tagline}
              actions={
                <Link to={`${base}/issues/new`} className="btn-primary">
                  <Plus className="size-4" /> شمارهٔ جدید
                </Link>
              }
            />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="شماره‌های در جریان" value={formatNumber(active.length)} />
              <Stat label="شماره‌های منتشرشده" value={formatNumber(published.length)} />
              <Stat label="اعضای فعال" value={formatNumber(d.members)} />
              <Stat label="نظرهای در انتظار" value={formatNumber(d.pendingComments)} tone={d.pendingComments ? 'danger' : 'muted'} sub={d.pendingComments ? 'نیاز به بررسی' : 'همه بررسی شده'} />
            </div>

            {overdue.length > 0 && (
              <Card title={<span className="flex items-center gap-2 text-danger"><AlertTriangle className="size-5" /> عقب‌افتاده‌ها</span>}>
                <ul className="divide-y divide-line text-sm">
                  {overdue.map((o: any) => (
                    <li key={o.kind + o.id} className="flex items-center justify-between gap-2 py-2">
                      <Link to={`${base}/issues/${o.issue_id}`} className="min-w-0 truncate hover:text-brand">
                        <Badge tone="danger">{o.kind}</Badge> {o.title} <span className="text-muted">— {o.issue_title}</span>
                      </Link>
                      <span className="shrink-0 text-xs text-danger">موعد: {faDate(o.due_at)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <Card title="شماره‌های در جریان" action={<Link to={`${base}/issues`} className="text-sm text-brand">همه</Link>}>
              {active.length ? (
                <ul className="space-y-3">
                  {active.map((i: any) => {
                    const s = ISSUE_STATUS[i.status] || { label: i.status, tone: 'muted' as const }
                    const pct = i.toc_total ? (i.toc_done / i.toc_total) * 100 : 0
                    const spct = i.stage_total ? (i.stage_done / i.stage_total) * 100 : 0
                    return (
                      <li key={i.id}>
                        <Link to={`${base}/issues/${i.id}`} className="flex items-center gap-3 rounded-xl p-2 hover:bg-surface-2">
                          <Cover src={mediaUrl(i.cover_key)} title={i.title} className="w-12 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-bold">شمارهٔ {formatNumber(i.number)}</span>
                              <span className="truncate text-sm text-muted">{i.title}</span>
                              <Badge tone={s.tone}>{s.label}</Badge>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-3 text-[11px] text-muted">
                              <div>
                                فهرست مطالب {formatNumber(i.toc_done)}/{formatNumber(i.toc_total)}
                                <Progress value={pct} className="mt-1" />
                              </div>
                              <div>
                                مراحل {formatNumber(i.stage_done)}/{formatNumber(i.stage_total)}
                                <Progress value={spct} className="mt-1" />
                              </div>
                            </div>
                            {i.planned_publish_at && <div className="mt-1 text-[11px] text-muted">انتشار برنامه‌ریزی‌شده: {faDate(i.planned_publish_at)}</div>}
                          </div>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <Empty title="شمارهٔ در جریانی ندارید" action={<Link to={`${base}/issues/new`} className="btn-primary">شروع شمارهٔ جدید</Link>} />
              )}
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
              <Card title={<span className="flex items-center gap-2"><CalendarClock className="size-5" /> مهلت‌های پیش رو</span>}>
                {d.deadlines.length ? (
                  <ul className="space-y-2 text-sm">
                    {d.deadlines.map((x: any) => (
                      <li key={x.id}>
                        <div className="flex justify-between gap-2">
                          <span className="font-medium">{x.title}</span>
                          <span className="text-xs text-muted">{faDate(x.due_at)}</span>
                        </div>
                        {x.description && <p className="text-xs text-muted">{x.description}</p>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">مهلتی ثبت نشده است.</p>
                )}
              </Card>
              <Card title="اطلاعیه‌های مسئول نشریات">
                {d.announcements.length ? (
                  <ul className="space-y-3 text-sm">
                    {d.announcements.map((a: any) => (
                      <li key={a.id}>
                        <div className="flex items-center gap-1 font-medium">
                          {!!a.pinned && <Pin className="size-3.5 text-brand" />} {a.title}
                        </div>
                        <p className="line-clamp-3 whitespace-pre-line text-xs leading-6 text-muted">{a.body}</p>
                        <p className="text-[11px] text-muted">{relativeFa(a.created_at)}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">اطلاعیه‌ای وجود ندارد.</p>
                )}
              </Card>
            </div>

            <div className="flex flex-wrap gap-2 text-sm">
              <Link to={`${base}/comments`} className="btn-ghost"><MessageCircle className="size-4" /> بررسی نظرها</Link>
              <Link to={`${base}/members`} className="btn-ghost"><Users className="size-4" /> مدیریت اعضا</Link>
            </div>
          </div>
        )
      }}
    </Async>
  )
}

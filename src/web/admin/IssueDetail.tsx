import { Link, useParams } from 'react-router-dom'
import { Archive, BookOpen } from 'lucide-react'
import { api } from '../lib/api'
import { ISSUE_STATUS, MEDIA_ROLE, STAGE_STATUS, TOC_STATUS, faDate, fileSize, formatNumber, formatToman, toFaDigits } from '../lib/format'
import { Async, Badge, Button, Card, Empty, PageHeader, Progress, Stat, useAction, useAsync, useToast } from '../components/ui'
import { useAdminRole } from './Layout'

const DAY = 86400000
const days = (a?: string | null, b?: string | null) => (a ? Math.max(0, Math.round(((b ? new Date(b).getTime() : Date.now()) - new Date(a).getTime()) / DAY)) : null)

export default function AdminIssueDetail() {
  const { id = '' } = useParams()
  const { admin } = useAdminRole()
  const st = useAsync(() => api.get(`/api/admin/issues/${id}`), [id])
  const { run, busy } = useAction()
  const { confirm } = useToast()

  return (
    <Async state={st}>
      {(d: any) => {
        const i = d.issue
        const s = ISSUE_STATUS[i.status]
        const done = d.toc.filter((t: any) => t.status === 'done').length
        const pct = d.toc.length ? Math.round((done / d.toc.length) * 100) : 0
        const assign: Record<string, any[]> = {}
        for (const a of d.assignments) (assign[a.toc_item_id] ||= []).push(a)
        const toggleArchive = async () => {
          const archived = i.status !== 'archived'
          if (!(await confirm(archived ? 'این شماره بایگانی شود؟ از پیشخوان عمومی پنهان می‌شود.' : 'این شماره از بایگانی خارج شود؟'))) return
          if (await run(() => api.post(`/api/admin/issues/${i.id}/archive`, { archived }), 'انجام شد')) st.reload()
        }
        return (
          <div className="space-y-4">
            <PageHeader
              back={<Link to={`/admin/publications/${i.publication_id}`} className="text-sm text-muted">← {i.publication_title}</Link>}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  شمارهٔ {toFaDigits(i.number)} — {i.title}
                  {s && <Badge tone={s.tone}>{s.label}</Badge>}
                </span>
              }
              subtitle={i.summary}
              actions={
                <div className="flex flex-wrap gap-2">
                  {(i.status === 'published' || i.status === 'awaiting_approval') && (
                    <Link to={`/read/${i.id}`} className="btn-ghost"><BookOpen className="size-4" /> خواندن</Link>
                  )}
                  {admin && (i.status === 'published' || i.status === 'archived') && (
                    <Button variant="ghost" icon={<Archive className="size-4" />} loading={busy} onClick={toggleArchive}>
                      {i.status === 'archived' ? 'خروج از بایگانی' : 'بایگانی'}
                    </Button>
                  )}
                  {i.status === 'awaiting_approval' && <Link to="/admin/approvals" className="btn-primary">رفتن به صف تأیید</Link>}
                </div>
              }
            />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="صفحات" value={toFaDigits(i.page_count || 0)} />
              <Stat label="قیمت" value={i.pricing === 'free' ? 'رایگان' : formatToman(i.price_digital)} />
              <Stat label="کد فروخته‌شده" value={`${formatNumber(d.sales.codes_redeemed)} از ${formatNumber(d.sales.codes_created)}`} sub={formatToman(d.sales.revenue_digital)} />
              <Stat label="فروش چاپی" value={formatNumber(d.sales.print_sold)} sub={i.print_run ? `تیراژ ${toFaDigits(i.print_run)}` : undefined} />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card title="مراحل تولید" className="lg:col-span-1">
                {!d.stages.length ? (
                  <Empty title="مرحله‌ای تعریف نشده" />
                ) : (
                  <ol className="space-y-2 text-sm">
                    {d.stages.map((x: any) => {
                      const dur = days(x.started_at, x.completed_at)
                      return (
                        <li key={x.id} className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2">
                            <span className={`size-2.5 rounded-full ${x.status === 'done' ? 'bg-ok' : x.status === 'in_progress' ? 'bg-brand' : x.status === 'skipped' ? 'bg-line' : 'bg-surface-2 ring-1 ring-line'}`} />
                            {x.title}
                          </span>
                          <span className="text-xs text-muted">
                            {STAGE_STATUS[x.status]}
                            {dur !== null && x.status !== 'pending' ? ` · ${toFaDigits(dur)} روز` : ''}
                          </span>
                        </li>
                      )
                    })}
                  </ol>
                )}
                <div className="mt-4 space-y-1 border-t border-line pt-3 text-xs text-muted">
                  <div>آغاز: {faDate(i.created_at)}</div>
                  {i.planned_publish_at && <div>انتشار برنامه‌ریزی‌شده: {faDate(i.planned_publish_at)}</div>}
                  {i.published_at && <div>انتشار: {faDate(i.published_at)} ({toFaDigits(days(i.created_at, i.published_at) ?? 0)} روز چرخهٔ تولید)</div>}
                </div>
              </Card>

              <Card title={`فهرست مطالب (${toFaDigits(done)} از ${toFaDigits(d.toc.length)})`} className="lg:col-span-2">
                <Progress value={pct} className="mb-3" />
                {!d.toc.length ? (
                  <Empty title="فهرست مطالب خالی است" />
                ) : (
                  <ul className="divide-y divide-line text-sm">
                    {d.toc.map((t: any) => (
                      <li key={t.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 ${t.parent_id ? 'pr-5' : ''}`}>
                        <div className="min-w-0">
                          <div className="font-medium">{t.title}</div>
                          <div className="text-xs text-muted">
                            {(assign[t.id] || []).map((a) => `${a.full_name}${a.role ? ` (${a.role})` : ''}`).join('، ') || 'تخصیص‌نیافته'}
                            {t.page_start ? ` · ص ${toFaDigits(t.page_start)}${t.page_end ? '–' + toFaDigits(t.page_end) : ''}` : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          {t.due_at && t.status !== 'done' && new Date(t.due_at) < new Date() && <Badge tone="danger">دیرکرد</Badge>}
                          <Badge tone={t.status === 'done' ? 'ok' : t.status === 'todo' ? 'muted' : 'brand'}>{TOC_STATUS[t.status] || t.status}</Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card title="اعضای این شماره">
                {!d.members.length ? (
                  <Empty title="عضوی ثبت نشده" />
                ) : (
                  <ul className="space-y-1 text-sm">
                    {d.members.map((m: any) => (
                      <li key={m.member_id + m.production_role} className="flex justify-between gap-2">
                        <span>{m.full_name}</span>
                        <span className="text-xs text-muted">{m.production_role || '—'}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="فایل‌ها">
                {!d.media.length ? (
                  <Empty title="فایلی بارگذاری نشده" />
                ) : (
                  <ul className="space-y-1 text-sm">
                    {d.media.map((m: any) => (
                      <li key={m.id} className="flex justify-between gap-2">
                        <span className="truncate">{m.title || MEDIA_ROLE[m.role] || m.role}</span>
                        <span className="shrink-0 text-xs text-muted">{fileSize(m.size_bytes)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="سابقهٔ تأیید">
                {!d.approvals.length ? (
                  <Empty title="درخواستی ثبت نشده" />
                ) : (
                  <ul className="space-y-2 text-sm">
                    {d.approvals.map((a: any) => (
                      <li key={a.id} className="rounded-lg bg-surface-2 p-2">
                        <div className="flex justify-between gap-2 text-xs">
                          <span>درخواست: {faDate(a.requested_at, true)}</span>
                          {a.decision ? <Badge tone={a.decision === 'approved' ? 'ok' : 'warn'}>{a.decision === 'approved' ? 'تأیید' : 'اصلاح'}</Badge> : <Badge tone="warn">در انتظار</Badge>}
                        </div>
                        {a.note && <p className="mt-1 text-xs">{a.note}</p>}
                        {a.decided_by_name && <div className="mt-1 text-[11px] text-muted">{a.decided_by_name} · {faDate(a.decided_at, true)}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <Card title="رویدادهای پیشرفت">
              {!d.events.length ? (
                <Empty title="رویدادی ثبت نشده" />
              ) : (
                <ol className="max-h-96 space-y-1 overflow-y-auto text-xs">
                  {[...d.events].reverse().map((e: any) => (
                    <li key={e.id} className="flex flex-wrap justify-between gap-2 border-b border-line py-1.5 last:border-0">
                      <span>
                        {e.stage_title || e.toc_title || 'شماره'}: {STAGE_STATUS[e.from_status] || TOC_STATUS[e.from_status] || ISSUE_STATUS[e.from_status]?.label || e.from_status || '—'} ←{' '}
                        <b>{STAGE_STATUS[e.to_status] || TOC_STATUS[e.to_status] || ISSUE_STATUS[e.to_status]?.label || e.to_status}</b>
                        {e.note ? ` — ${e.note}` : ''}
                      </span>
                      <span className="text-muted">
                        {e.actor_name || ''} · {faDate(e.created_at, true)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
        )
      }}
    </Async>
  )
}

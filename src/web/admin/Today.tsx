// «کارهای امروز» — the publications officer's daily desk (ROADMAP phase 14).
// One prioritised action queue fed by GET /api/admin/today; safe actions (approve an issue, approve/reject a
// comment, close a report) are done right here with one click, everything else opens the relevant page.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlarmClock, CheckCircle2, CheckSquare, ExternalLink, FileText, FileWarning, MessageSquare, PauseCircle, RefreshCw, ShieldAlert, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { api } from '../lib/api'
import { cx, faDate, relativeFa, toFaDigits } from '../lib/format'
import { Async, Badge, Button, Card, Empty, PageHeader, useAction, useAsync } from '../components/ui'

interface Item { kind: string; id: string; priority: number; title: string; detail: string; at: string | null; link: string; actions: string[] }
interface TodayData { items: Item[]; counts: Record<string, number>; generated_at: string }

export const TODAY_KINDS: Record<string, { label: string; icon: LucideIcon }> = {
  approval: { label: 'تأیید انتشار', icon: CheckSquare },
  license: { label: 'مجوزها', icon: FileWarning },
  report: { label: 'گزارش تخلف', icon: ShieldAlert },
  comment: { label: 'نظرها', icon: MessageSquare },
  deadline: { label: 'مهلت‌ها', icon: AlarmClock },
  stalled: { label: 'شماره‌های متوقف', icon: PauseCircle }
}
const PRIORITY: Record<number, { label: string; tone: 'danger' | 'warn' | 'muted' }> = {
  1: { label: 'فوری', tone: 'danger' },
  2: { label: 'مهم', tone: 'warn' },
  3: { label: 'عادی', tone: 'muted' }
}

export default function AdminToday() {
  const state = useAsync(() => api.get<TodayData>('/api/admin/today'), [])
  const [kind, setKind] = useState<string>('all')
  const [done, setDone] = useState<Set<string>>(new Set())
  const { run, busy } = useAction()

  const act = async (it: Item, action: string) => {
    const call =
      it.kind === 'approval' ? () => api.post(`/api/admin/approvals/${it.id}`, { decision: 'approved' })
      : it.kind === 'comment' ? () => api.post(`/api/admin/comments/${it.id}`, { action })
      : it.kind === 'report' ? () => api.post(`/api/admin/reports/${it.id}`, { status: action === 'resolve' ? 'resolved' : 'dismissed' })
      : null
    if (!call) return
    const msg = it.kind === 'approval' ? 'شماره تأیید و منتشر شد' : 'انجام شد'
    if ((await run(call, msg)) !== undefined) setDone((s) => new Set(s).add(`${it.kind}:${it.id}`))
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="کارهای امروز"
        subtitle="همهٔ کارهایی که منتظر شماست، به ترتیب اولویت"
        actions={
          <>
            {/* ROADMAP phase 14: one-click printable report for the cultural deputy */}
            <Link className="btn-ghost" to="/admin/report?period=prevMonth&print=1"><FileText className="size-4" /> گزارش ماه گذشته</Link>
            <Link className="btn-ghost" to="/admin/report?period=term&print=1"><FileText className="size-4" /> گزارش ترم</Link>
            <Button variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => (setDone(new Set()), state.reload())}>به‌روزرسانی</Button>
          </>
        }
      />
      <Async state={state}>
        {(d) => <Queue data={d} kind={kind} setKind={setKind} done={done} act={act} busy={busy} />}
      </Async>
    </div>
  )
}

function Queue({ data, kind, setKind, done, act, busy }: { data: TodayData; kind: string; setKind: (k: string) => void; done: Set<string>; act: (it: Item, a: string) => void; busy: boolean }) {
  const open = useMemo(() => data.items.filter((it) => !done.has(`${it.kind}:${it.id}`)), [data, done])
  const shown = kind === 'all' ? open : open.filter((it) => it.kind === kind)
  const urgent = open.filter((it) => it.priority === 1).length
  const count = (k: string) => open.filter((it) => it.kind === k).length

  return (
    <>
      <section id="today-summary" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="خلاصهٔ صف کار">
        {Object.entries(TODAY_KINDS).map(([k, v]) => (
          <button
            key={k}
            onClick={() => setKind(kind === k ? 'all' : k)}
            className={cx('card flex items-center gap-3 p-3 text-start transition-colors hover:border-brand', kind === k && 'border-brand bg-brand-soft')}
            aria-pressed={kind === k}
          >
            <v.icon className="size-5 shrink-0 text-brand" />
            <span className="min-w-0">
              <span className="block text-xl font-extrabold leading-6">{toFaDigits(count(k))}</span>
              <span className="block truncate text-xs text-muted">{v.label}</span>
            </span>
          </button>
        ))}
      </section>

      <Card
        title={
          <span className="flex flex-wrap items-center gap-2">
            {kind === 'all' ? 'صف اقدام' : TODAY_KINDS[kind]?.label}
            {urgent > 0 && <Badge tone="danger">{toFaDigits(urgent)} مورد فوری</Badge>}
          </span>
        }
        action={kind !== 'all' && <button className="text-sm text-brand" onClick={() => setKind('all')}>نمایش همه</button>}
      >
        {!shown.length ? (
          <Empty icon={<CheckCircle2 className="size-10 text-ok" />} title="کاری در صف نیست" hint="همه چیز مرتب است. موارد تازه به‌محض رسیدن اینجا دیده می‌شوند." />
        ) : (
          <ul id="today-queue" className="divide-y divide-line">
            {shown.map((it) => {
              const K = TODAY_KINDS[it.kind]
              const P = PRIORITY[it.priority] || PRIORITY[3]
              return (
                <li key={`${it.kind}:${it.id}`} className="today-item flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    {K && <K.icon className="mt-0.5 size-5 shrink-0 text-muted" />}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold">{it.title}</span>
                        <Badge tone={P.tone}>{P.label}</Badge>
                      </div>
                      {it.detail && <p className="mt-0.5 line-clamp-2 break-words text-sm text-muted">{it.detail}</p>}
                      {it.at && (
                        <p className="mt-0.5 text-xs text-muted">
                          {it.kind === 'license' || it.kind === 'deadline' ? `تاریخ: ${faDate(it.at)}` : relativeFa(it.at)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                    {it.actions.includes('approve') && (
                      <Button className="!py-1.5 text-sm" disabled={busy} icon={<CheckCircle2 className="size-4" />} onClick={() => act(it, 'approve')}>
                        {it.kind === 'approval' ? 'تأیید و انتشار' : 'تأیید'}
                      </Button>
                    )}
                    {it.actions.includes('reject') && (
                      <Button variant="ghost" className="!py-1.5 text-sm" disabled={busy} icon={<X className="size-4" />} onClick={() => act(it, 'reject')}>رد</Button>
                    )}
                    {it.actions.includes('resolve') && (
                      <Button className="!py-1.5 text-sm" disabled={busy} onClick={() => act(it, 'resolve')}>رسیدگی شد</Button>
                    )}
                    {it.actions.includes('dismiss') && (
                      <Button variant="ghost" className="!py-1.5 text-sm" disabled={busy} onClick={() => act(it, 'dismiss')}>بی‌اساس</Button>
                    )}
                    <Link to={it.link} className="btn-ghost !py-1.5 text-sm">
                      <ExternalLink className="size-4" /> {it.actions.includes('open') && it.actions.length === 1 ? 'بررسی' : 'جزئیات'}
                    </Link>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      <p className="text-xs text-muted">آخرین به‌روزرسانی: {relativeFa(data.generated_at)}</p>
    </>
  )
}

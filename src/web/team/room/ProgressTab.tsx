import { CheckCircle2, Circle, CircleDot, SkipForward } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../lib/api'
import { STAGE_STATUS, TOC_STATUS, cx, faDate, formatNumber, relativeFa } from '../../lib/format'
import { Badge, Card, Input, Progress, Select, useAction } from '../../components/ui'
import type { RoomProps } from './TocTab'

const STAGE_OPTS = Object.entries(STAGE_STATUS).map(([value, label]) => ({ value, label }))
/** Stage-specific wording for "in progress" (e.g. «در حال طراحی» starts the graphics stage). */
const IN_PROGRESS_FA: Record<string, string> = { writing: 'در حال نگارش', editing: 'در حال ویرایش', graphics: 'در حال طراحی', layout: 'در حال صفحه‌آرایی', review: 'در حال بازبینی' }
const stageOpts = (key: string) => STAGE_OPTS.map((o) => (o.value === 'in_progress' && IN_PROGRESS_FA[key] ? { ...o, label: IN_PROGRESS_FA[key] } : o))
const ICON: Record<string, any> = { pending: Circle, in_progress: CircleDot, done: CheckCircle2, skipped: SkipForward }

function Kanban({ toc }: { toc: any[] }) {
  const cols = Object.keys(TOC_STATUS)
  return (
    <div className="no-scrollbar flex gap-3 overflow-x-auto pb-2">
      {cols.map((k) => {
        const items = toc.filter((t) => t.status === k)
        return (
          <div key={k} className="w-48 shrink-0 rounded-xl bg-surface-2 p-2">
            <div className="mb-2 flex justify-between text-xs font-bold">
              {TOC_STATUS[k]} <span className="text-muted">{formatNumber(items.length)}</span>
            </div>
            <div className="space-y-2">
              {items.map((t) => (
                <div key={t.id} className="card p-2 text-xs">{t.title}</div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Checklist view: same stages + TOC data as the timeline; unticking is a real status change and is logged in stage_events too. */
function Checklist({ stages, toc, disabled, onStage, onToc }: { stages: any[]; toc: any[]; disabled: boolean; onStage: (s: any, status: string) => void; onToc: (t: any, status: string) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <ul className="space-y-2 text-sm">
        {stages.map((s) => (
          <li key={s.id}>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.status === 'done'} disabled={disabled || s.key === 'publish'} onChange={(e) => onStage(s, e.target.checked ? 'done' : 'in_progress')} />
              <span className={cx(s.status === 'done' && 'text-muted line-through')}>{s.title}</span>
            </label>
          </li>
        ))}
      </ul>
      <ul className="space-y-2 text-sm">
        {toc.map((t) => (
          <li key={t.id} className={cx(t.parent_id && 'ps-5')}>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={t.status === 'done'} disabled={disabled} onChange={(e) => onToc(t, e.target.checked ? 'done' : 'edited')} />
              <span className={cx(t.status === 'done' && 'text-muted line-through')}>{t.title}</span>
            </label>
          </li>
        ))}
        {!toc.length && <li className="text-muted">فهرست مطالب خالی است.</li>}
      </ul>
    </div>
  )
}

export default function ProgressTab({ d, reload, pubId }: RoomProps) {
  const issueId = d.issue.id
  const { busy, run } = useAction()
  const stages: any[] = d.stages
  const doneStages = stages.filter((s) => ['done', 'skipped'].includes(s.status)).length
  const tocDone = d.toc.filter((t: any) => t.status === 'done').length
  const locked = ['awaiting_approval', 'published', 'archived'].includes(d.issue.status)

  const [note, setNote] = useState('')
  const setStage = (s: any, status: string) =>
    run(() => api.post(`/api/team/${pubId}/issues/${issueId}/stages/${s.id}`, { status, note: note.trim() || undefined })).then((r) => {
      if (r) {
        setNote('')
        reload()
      }
    })
  const setToc = (t: any, status: string) => run(() => api.post(`/api/team/${pubId}/issues/${issueId}/toc/${t.id}/status`, { status, note: note.trim() || undefined })).then((r) => r && reload())
  const setDue = (s: any, due_at: string) => run(() => api.post(`/api/team/${pubId}/issues/${issueId}/stages/${s.id}`, { due_at: due_at || null })).then((r) => r && reload())

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <div className="text-xs text-muted">مراحل تولید</div>
          <div className="mt-1 text-xl font-extrabold">{formatNumber(doneStages)} / {formatNumber(stages.length)}</div>
          <Progress value={stages.length ? (doneStages / stages.length) * 100 : 0} className="mt-2" />
        </Card>
        <Card>
          <div className="text-xs text-muted">بخش‌های نهایی‌شده</div>
          <div className="mt-1 text-xl font-extrabold">{formatNumber(tocDone)} / {formatNumber(d.toc.length)}</div>
          <Progress value={d.toc.length ? (tocDone / d.toc.length) * 100 : 0} className="mt-2" />
        </Card>
      </div>

      <Card title="مراحل">
        <Input className="mb-4" value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} disabled={locked} placeholder="یادداشت کوتاه برای تغییر وضعیت بعدی (اختیاری)" aria-label="یادداشت تغییر وضعیت" />
        <ol className="relative space-y-4 border-s-2 border-line ps-5">
          {stages.map((s) => {
            const Icon = ICON[s.status] || Circle
            const late = s.due_at && !['done', 'skipped'].includes(s.status) && s.due_at < new Date().toISOString()
            return (
              <li key={s.id} className="relative">
                <Icon className={cx('absolute -start-[1.95rem] top-1 size-5 bg-surface', s.status === 'done' ? 'text-ok' : s.status === 'in_progress' ? 'text-brand' : 'text-muted')} />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-28 flex-1 font-medium">{s.title}</span>
                  {s.key === 'publish' ? (
                    <Badge tone={s.status === 'done' ? 'ok' : 'muted'}>{s.status === 'done' ? 'منتشر شد' : 'پس از تأیید مسئول نشریات'}</Badge>
                  ) : (
                    <Select className="w-32" value={s.status} disabled={busy || locked} onChange={(e) => setStage(s, e.target.value)} options={stageOpts(s.key)} aria-label="وضعیت مرحله" />
                  )}
                  <Input type="date" dir="ltr" className="w-40" defaultValue={(s.due_at || '').slice(0, 10)} disabled={locked} onBlur={(e) => e.target.value !== (s.due_at || '').slice(0, 10) && setDue(s, e.target.value)} aria-label="موعد" />
                </div>
                <div className="mt-1 text-[11px] text-muted">
                  {s.started_at && <>شروع {faDate(s.started_at)} · </>}
                  {s.completed_at && <>پایان {faDate(s.completed_at)} · </>}
                  {late && <span className="text-danger">عقب‌افتاده</span>}
                </div>
              </li>
            )
          })}
        </ol>
      </Card>

      {d.issue.progress_view === 'checklist' && (
        <Card title="چک‌لیست">
          <Checklist stages={stages} toc={d.toc} disabled={busy || locked} onStage={setStage} onToc={setToc} />
        </Card>
      )}

      {d.issue.progress_view === 'kanban' && (
        <Card title="کانبان فهرست مطالب">
          <Kanban toc={d.toc} />
        </Card>
      )}

      <Card title="تاریخچهٔ تغییرات">
        {d.events.length ? (
          <ul className="max-h-96 space-y-2 overflow-y-auto text-sm">
            {d.events.map((e: any) => (
              <li key={e.id} className="flex items-start justify-between gap-2">
                <span>
                  <b>{e.actor_name || 'سیستم'}</b> — {e.stage_title || e.toc_title}:{' '}
                  <span className="text-muted">{STAGE_STATUS[e.from_status] || TOC_STATUS[e.from_status] || e.from_status || '—'}</span> ←{' '}
                  <span className="font-medium">{STAGE_STATUS[e.to_status] || TOC_STATUS[e.to_status] || e.to_status}</span>
                  {e.note && <span className="block text-xs text-muted">{e.note}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted">{relativeFa(e.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">هنوز تغییری ثبت نشده است.</p>
        )}
      </Card>
    </div>
  )
}

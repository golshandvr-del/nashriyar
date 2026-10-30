import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, IndentDecrease, IndentIncrease, Pencil, Plus, Trash2, UserPlus } from 'lucide-react'
import { api } from '../../lib/api'
import { TOC_STATUS, cx, faDate, formatNumber } from '../../lib/format'
import { Badge, Button, Card, Field, Input, Modal, Select, Textarea, useAction, useToast } from '../../components/ui'

export interface RoomProps {
  d: any
  reload: () => void
  pubId: string
}

const STATUS_OPTS = Object.entries(TOC_STATUS).map(([value, label]) => ({ value, label }))
const ROLE_FA: Record<string, string> = { author: 'نویسنده', editor: 'ویراستار', translator: 'مترجم', illustrator: 'تصویرگر', photographer: 'عکاس' }
const ROLE_OPTS = Object.entries(ROLE_FA).map(([value, label]) => ({ value, label }))
export const EDITABLE = ['planning', 'in_production', 'changes_requested']

function AssignModal({ item, members, current, onClose, onSaved, pubId, issueId }: any) {
  const [rows, setRows] = useState<{ member_id: string; role: string }[]>(current.map((a: any) => ({ member_id: a.team_member_id, role: a.role })))
  const { busy, run } = useAction()
  return (
    <Modal
      open
      onClose={onClose}
      title={`واگذاری: ${item.title}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>انصراف</Button>
          <Button
            loading={busy}
            onClick={async () => {
              const r = await run(() => api.put(`/api/team/${pubId}/issues/${issueId}/toc/${item.id}/assignments`, { assignments: rows.filter((x) => x.member_id) }), 'واگذاری ذخیره شد')
              if (r) onSaved()
            }}
          >
            ذخیره
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {rows.map((a, i) => (
          <div key={i} className="flex gap-2">
            <Select value={a.member_id} placeholder="عضو…" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, member_id: e.target.value } : x)))} options={members.map((m: any) => ({ value: m.id, label: m.full_name }))} />
            <Select value={a.role} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} options={ROLE_OPTS} />
            <button className="p-1 text-danger" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="حذف"><Trash2 className="size-4" /></button>
          </div>
        ))}
        <button className="text-sm text-brand" onClick={() => setRows([...rows, { member_id: '', role: 'author' }])}>+ افزودن</button>
      </div>
    </Modal>
  )
}

function EditModal({ item, onClose, onSaved, pubId, issueId, structural }: any) {
  const [f, setF] = useState({ title: item.title, kind: item.kind || 'article', due_at: (item.due_at || '').slice(0, 10), page_start: item.page_start ?? '', page_end: item.page_end ?? '' })
  const { busy, run } = useAction()
  return (
    <Modal
      open
      onClose={onClose}
      title="ویرایش بخش"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>انصراف</Button>
          <Button
            loading={busy}
            onClick={async () => {
              const body: any = { due_at: f.due_at || null, page_start: f.page_start === '' ? null : Number(f.page_start), page_end: f.page_end === '' ? null : Number(f.page_end), kind: f.kind }
              if (structural) body.title = f.title
              const r = await run(() => api.put(`/api/team/${pubId}/issues/${issueId}/toc/${item.id}`, body), 'ذخیره شد')
              if (r) onSaved()
            }}
          >
            ذخیره
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="عنوان" hint={!structural ? 'عنوان شمارهٔ منتشرشده تغییر نمی‌کند' : undefined}>
            <Input value={f.title} disabled={!structural} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
        </div>
        <Field label="نوع">
          <Input value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} />
        </Field>
        <Field label="موعد">
          <Input type="date" dir="ltr" value={f.due_at} onChange={(e) => setF({ ...f, due_at: e.target.value })} />
        </Field>
        <Field label="صفحهٔ شروع" hint="برای پرش مستقیم در کتاب‌خوان">
          <Input type="number" min={1} dir="ltr" value={f.page_start} onChange={(e) => setF({ ...f, page_start: e.target.value })} />
        </Field>
        <Field label="صفحهٔ پایان">
          <Input type="number" min={1} dir="ltr" value={f.page_end} onChange={(e) => setF({ ...f, page_end: e.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}

export default function TocTab({ d, reload, pubId }: RoomProps) {
  const issueId = d.issue.id
  const structural = EDITABLE.includes(d.issue.status)
  const [members, setMembers] = useState<any[]>([])
  const [lines, setLines] = useState('')
  const [assignFor, setAssignFor] = useState<any>(null)
  const [editFor, setEditFor] = useState<any>(null)
  const { busy, run } = useAction()
  const { confirm } = useToast()
  useEffect(() => {
    api.get(`/api/team/${pubId}/members`).then((r) => setMembers(r.members.filter((m: any) => m.is_active))).catch(() => {})
  }, [pubId])

  const toc: any[] = d.toc
  const byItem = (id: string) => d.assignments.filter((a: any) => a.toc_item_id === id)
  const done = toc.filter((t) => t.status === 'done').length

  const setStatus = (t: any, status: string) => run(() => api.post(`/api/team/${pubId}/issues/${issueId}/toc/${t.id}/status`, { status })).then((r) => r && reload())
  const move = async (idx: number, dir: -1 | 1) => {
    const j = idx + dir
    if (j < 0 || j >= toc.length) return
    const a = [...toc]
    ;[a[idx], a[j]] = [a[j], a[idx]]
    const r = await run(() => api.post(`/api/team/${pubId}/issues/${issueId}/toc-order`, { order: a.map((x) => ({ id: x.id, parent_id: x.parent_id })) }))
    if (r) reload()
  }
  /** Suggest page_start/page_end from the PDF's extracted text, show them, and apply on confirmation. */
  const suggestPages = async () => {
    const r = await run(() => api.get<any>(`/api/team/${pubId}/issues/${issueId}/toc/page-suggestions`))
    if (!r) return
    const hits = (r.suggestions as any[]).filter((x) => x.page_start != null && (x.page_start !== x.current_start || x.page_end !== x.current_end))
    if (!r.with_text) return void (await confirm('متن صفحات هنوز استخراج نشده است؛ ابتدا PDF را در تب «رسانه» پردازش کنید.', { okLabel: 'باشه' }))
    if (!hits.length) return void (await confirm('پیشنهاد تازه‌ای پیدا نشد (عنوان بخش‌ها در متن صفحات یافت نشد یا شماره‌ها از قبل درست است).', { okLabel: 'باشه' }))
    const list = (
      <div>
        <p className="mb-2">این شماره صفحه‌ها اعمال شود؟</p>
        <ul className="max-h-64 list-disc space-y-1 overflow-y-auto ps-5 text-sm">
          {hits.map((x) => (
            <li key={x.id}>{x.title}: ص {formatNumber(x.page_start)}{x.page_end ? '–' + formatNumber(x.page_end) : ''}</li>
          ))}
        </ul>
      </div>
    )
    if (!(await confirm(list, { okLabel: 'اعمال' }))) return
    for (const x of hits) await api.put(`/api/team/${pubId}/issues/${issueId}/toc/${x.id}`, { page_start: x.page_start, page_end: x.page_end })
    reload()
  }
  /** Drag-and-drop reorder (HTML5); the up/down buttons remain as the keyboard-accessible alternative. */
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const dropAt = async (to: number) => {
    const from = dragIdx
    setDragIdx(null)
    if (from == null || from === to) return
    const a = [...toc]
    const [it] = a.splice(from, 1)
    a.splice(to, 0, it)
    const r = await run(() => api.post(`/api/team/${pubId}/issues/${issueId}/toc-order`, { order: a.map((x) => ({ id: x.id, parent_id: x.parent_id })) }))
    if (r) reload()
  }
  /** Tree: indent makes the item a child of the nearest top-level item above it; outdent makes it top-level again. */
  const setParent = async (idx: number, indent: boolean) => {
    let parent: string | null = null
    if (indent) {
      for (let j = idx - 1; j >= 0; j--) if (!toc[j].parent_id) { parent = toc[j].id; break }
      if (!parent) return
    }
    const order = toc.map((x, j) => ({ id: x.id, parent_id: j === idx ? parent : x.parent_id === toc[idx].id && indent ? parent : x.parent_id }))
    const r = await run(() => api.post(`/api/team/${pubId}/issues/${issueId}/toc-order`, { order }))
    if (r) reload()
  }

  return (
    <div className="space-y-4">
      <Card
        title="فهرست مطالب"
        action={
          <span className="flex items-center gap-2">
            {d.pages_uploaded > 0 && toc.length > 0 && (
              <button className="text-xs text-brand hover:underline disabled:opacity-50" disabled={busy} onClick={suggestPages}>پیشنهاد شمارهٔ صفحات</button>
            )}
            <Badge tone={done === toc.length && toc.length ? 'ok' : 'muted'}>{formatNumber(done)} از {formatNumber(toc.length)} نهایی</Badge>
          </span>
        }
      >
        {toc.length ? (
          <ol className="divide-y divide-line">
            {toc.map((t, idx) => {
              const as = byItem(t.id)
              const late = t.due_at && t.status !== 'done' && t.due_at < new Date().toISOString()
              return (
                <li
                  key={t.id}
                  className={cx('py-3', t.parent_id && 'ps-6', structural && 'cursor-grab', dragIdx === idx && 'opacity-50')}
                  draggable={structural}
                  onDragStart={(e) => { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move' }}
                  onDragOver={(e) => dragIdx != null && e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); dropAt(idx) }}
                  onDragEnd={() => setDragIdx(null)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-6 text-center text-xs text-muted">{formatNumber(idx + 1)}</span>
                    <span className="min-w-0 flex-1 font-medium">{t.title}</span>
                    <Select className="w-36" value={t.status} onChange={(e) => setStatus(t, e.target.value)} options={STATUS_OPTS} aria-label="وضعیت" disabled={busy} />
                    <div className="flex">
                      {structural && (
                        <>
                          <button className="rounded p-1 hover:bg-surface-2" onClick={() => move(idx, -1)} aria-label="بالا"><ArrowUp className="size-4" /></button>
                          <button className="rounded p-1 hover:bg-surface-2" onClick={() => move(idx, 1)} aria-label="پایین"><ArrowDown className="size-4" /></button>
                          {t.parent_id ? (
                            <button className="rounded p-1 hover:bg-surface-2" onClick={() => setParent(idx, false)} aria-label="خروج از زیربخش" title="خروج از زیربخش"><IndentDecrease className="size-4" /></button>
                          ) : (
                            idx > 0 && <button className="rounded p-1 hover:bg-surface-2" onClick={() => setParent(idx, true)} aria-label="زیربخشِ بخش بالا" title="زیربخشِ بخش بالا"><IndentIncrease className="size-4" /></button>
                          )}
                        </>
                      )}
                      <button className="rounded p-1 hover:bg-surface-2" onClick={() => setAssignFor(t)} aria-label="واگذاری"><UserPlus className="size-4" /></button>
                      <button className="rounded p-1 hover:bg-surface-2" onClick={() => setEditFor(t)} aria-label="ویرایش"><Pencil className="size-4" /></button>
                      {structural && (
                        <button
                          className="rounded p-1 text-danger hover:bg-surface-2"
                          aria-label="حذف"
                          onClick={async () => {
                            if (!(await confirm(`بخش «${t.title}» حذف شود؟`, { danger: true, okLabel: 'حذف' }))) return
                            const r = await run(() => api.del(`/api/team/${pubId}/issues/${issueId}/toc/${t.id}`), 'حذف شد')
                            if (r) reload()
                          }}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 ps-8 text-xs text-muted">
                    {as.map((a: any) => (
                      <Badge key={a.id}>{ROLE_FA[a.role] || a.role}: {a.full_name}</Badge>
                    ))}
                    {!as.length && <span>بدون مسئول</span>}
                    {t.due_at && <span className={late ? 'text-danger' : ''}>موعد {faDate(t.due_at)}</span>}
                    {t.page_start && <span>ص {formatNumber(t.page_start)}{t.page_end ? `–${formatNumber(t.page_end)}` : ''}</span>}
                  </div>
                </li>
              )
            })}
          </ol>
        ) : (
          <p className="text-sm text-muted">فهرست مطالب خالی است.</p>
        )}
      </Card>
      {structural && (
        <Card title="افزودن بخش">
          <Textarea rows={3} value={lines} onChange={(e) => setLines(e.target.value)} placeholder="هر خط یک بخش" />
          <Button
            className="mt-2"
            variant="ghost"
            icon={<Plus className="size-4" />}
            loading={busy}
            disabled={!lines.trim()}
            onClick={async () => {
              const r = await run(() => api.post(`/api/team/${pubId}/issues/${issueId}/toc`, { lines }), 'افزوده شد')
              if (r) {
                setLines('')
                reload()
              }
            }}
          >
            افزودن
          </Button>
        </Card>
      )}
      {assignFor && <AssignModal item={assignFor} members={members} current={byItem(assignFor.id)} pubId={pubId} issueId={issueId} onClose={() => setAssignFor(null)} onSaved={() => { setAssignFor(null); reload() }} />}
      {editFor && <EditModal item={editFor} pubId={pubId} issueId={issueId} structural={structural} onClose={() => setEditFor(null)} onSaved={() => { setEditFor(null); reload() }} />}
    </div>
  )
}

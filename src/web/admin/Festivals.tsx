// Publications festival — admin side (ROADMAP phase 14, proposed module).
// draft → open (call for entries) → judging (score form) → announced (public ranked results).
import { useState } from 'react'
import { Award, Gavel, Plus, Trash2, Trophy, Users } from 'lucide-react'
import { api } from '../lib/api'
import { faDate, toFaDigits } from '../lib/format'
import { Async, Badge, Button, Card, Empty, Input, Modal, PageHeader, Textarea, useAction, useAsync, useToast } from '../components/ui'
import { useAdminRole } from './Layout'

export const FEST_STATUS: Record<string, { label: string; tone: 'muted' | 'brand' | 'warn' | 'ok' }> = {
  draft: { label: 'پیش‌نویس', tone: 'muted' },
  open: { label: 'فراخوان باز', tone: 'brand' },
  judging: { label: 'در حال داوری', tone: 'warn' },
  announced: { label: 'نتایج اعلام شد', tone: 'ok' }
}
const NEXT: Record<string, { status: string; label: string }> = {
  draft: { status: 'open', label: 'انتشار فراخوان' },
  open: { status: 'judging', label: 'بستن فراخوان و شروع داوری' },
  judging: { status: 'announced', label: 'اعلام نتایج' }
}
type Criterion = { key?: string; label: string; max: number }
const DEFAULT_CRITERIA: Criterion[] = [
  { label: 'محتوا و عمق مطالب', max: 10 },
  { label: 'نگارش و ویرایش', max: 10 },
  { label: 'طراحی و صفحه‌آرایی', max: 10 },
  { label: 'خلاقیت و نوآوری', max: 10 }
]

export default function AdminFestivals() {
  const st = useAsync(() => api.get<{ festivals: any[] }>('/api/festivals'), [])
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const { role } = useAdminRole()
  const canEdit = role === 'super_admin' || role === 'pub_officer'
  return (
    <div className="space-y-4">
      <PageHeader
        title="جشنوارهٔ نشریات"
        subtitle="فراخوان، داوری با فرم امتیاز و اعلام نتایج"
        actions={canEdit ? <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>جشنوارهٔ جدید</Button> : undefined}
      />
      <Async state={st}>
        {(d) =>
          d.festivals.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {d.festivals.map((f) => (
                <button key={f.id} onClick={() => setSel(f.id)} className="card p-4 text-start transition hover:border-brand">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-bold">{f.title}</h2>
                    <Badge tone={FEST_STATUS[f.status]?.tone}>{FEST_STATUS[f.status]?.label}</Badge>
                  </div>
                  {f.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{f.description}</p>}
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
                    <span><Trophy className="inline size-3.5" /> {toFaDigits(f.entry_count)} اثر</span>
                    <span><Gavel className="inline size-3.5" /> {toFaDigits(f.judge_count)} داور</span>
                    {f.submit_until && <span>مهلت ارسال: {faDate(f.submit_until)}</span>}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <Empty icon={<Award className="size-10 opacity-60" />} title="هنوز جشنواره‌ای تعریف نشده" hint="با «جشنوارهٔ جدید» فراخوان اول را بسازید." />
          )
        }
      </Async>
      {open && <NewFestival onClose={() => setOpen(false)} onDone={() => (setOpen(false), st.reload())} />}
      {sel && <FestivalDetail id={sel} canEdit={canEdit} onClose={() => setSel(null)} onChanged={st.reload} />}
    </div>
  )
}

function NewFestival({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: '', description: '', submit_until: '' })
  const [crit, setCrit] = useState<Criterion[]>(DEFAULT_CRITERIA)
  const { run, busy } = useAction()
  const save = async () => {
    if (await run(() => api.post('/api/festivals', { ...f, criteria: crit }), 'جشنواره ساخته شد')) onDone()
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="جشنوارهٔ جدید"
      wide
      footer={<Button loading={busy} disabled={!f.title.trim() || !crit.length} onClick={save}>ساخت (پیش‌نویس)</Button>}
    >
      <div className="space-y-3">
        <Input value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="عنوان جشنواره" aria-label="عنوان جشنواره" />
        <Textarea value={f.description} maxLength={2000} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="توضیح و شرایط شرکت" />
        <label className="block text-sm">
          مهلت ارسال اثر
          <Input type="date" value={f.submit_until} onChange={(e) => setF({ ...f, submit_until: e.target.value })} />
          {f.submit_until && <span className="mt-1 block text-xs text-muted">{faDate(f.submit_until)}</span>}
        </label>
        <div>
          <h3 className="mb-2 text-sm font-bold">معیارهای داوری</h3>
          <div className="space-y-2">
            {crit.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input className="flex-1" value={c.label} maxLength={60} aria-label="عنوان معیار" onChange={(e) => setCrit(crit.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <Input className="w-20" type="number" min={1} max={100} value={c.max} aria-label="بیشینهٔ امتیاز" onChange={(e) => setCrit(crit.map((x, j) => (j === i ? { ...x, max: Number(e.target.value) } : x)))} />
                <button className="rounded-lg p-2 text-danger hover:bg-surface-2" aria-label="حذف معیار" onClick={() => setCrit(crit.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
          {crit.length < 12 && (
            <Button variant="ghost" className="mt-2" icon={<Plus className="size-4" />} onClick={() => setCrit([...crit, { label: '', max: 10 }])}>معیار جدید</Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function FestivalDetail({ id, canEdit, onClose, onChanged }: { id: string; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const st = useAsync(() => api.get<any>(`/api/festivals/${id}`), [id])
  const { run, busy } = useAction()
  const { confirm } = useToast()
  const [judgeOpen, setJudgeOpen] = useState(false)
  const advance = async (f: any) => {
    const n = NEXT[f.status]
    if (!n || !(await confirm(`«${n.label}» برای «${f.title}»؟ این مرحله برگشت‌پذیر نیست.`, { okLabel: n.label }))) return
    if (await run(() => api.patch(`/api/festivals/${id}`, { status: n.status }), 'انجام شد')) (st.reload(), onChanged())
  }
  const remove = async (f: any) => {
    if (!(await confirm(`جشنوارهٔ «${f.title}» حذف شود؟`, { danger: true, okLabel: 'حذف' }))) return
    if (await run(() => api.del(`/api/festivals/${id}`), 'حذف شد')) (onChanged(), onClose())
  }
  return (
    <Modal open onClose={onClose} title={st.data?.festival?.title || 'جشنواره'} wide>
      <Async state={st}>
        {(d) => {
          const f = d.festival
          const n = NEXT[f.status]
          const totalMax = f.criteria.reduce((s: number, c: Criterion) => s + c.max, 0)
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={FEST_STATUS[f.status]?.tone}>{FEST_STATUS[f.status]?.label}</Badge>
                {f.submit_until && <Badge>مهلت ارسال: {faDate(f.submit_until)}</Badge>}
                {f.announced_at && <Badge tone="ok">اعلام: {faDate(f.announced_at)}</Badge>}
              </div>
              {f.description && <p className="whitespace-pre-line text-sm text-muted">{f.description}</p>}
              <Card title="معیارهای داوری">
                <ul className="flex flex-wrap gap-2 text-sm">
                  {f.criteria.map((c: Criterion) => (
                    <li key={c.key} className="rounded-lg bg-surface-2 px-2 py-1">{c.label} <span className="text-muted">(از {toFaDigits(c.max)})</span></li>
                  ))}
                  <li className="rounded-lg px-2 py-1 font-bold">جمع: {toFaDigits(totalMax)}</li>
                </ul>
              </Card>
              <Card
                title={<span className="inline-flex items-center gap-1"><Users className="size-4" /> داوران</span>}
                action={canEdit && f.status !== 'announced' ? <Button variant="ghost" onClick={() => setJudgeOpen(true)}>تعیین داوران</Button> : undefined}
              >
                {d.judges.length ? (
                  <ul className="space-y-1 text-sm">
                    {d.judges.map((j: any) => (
                      <li key={j.id} className="flex justify-between gap-2">
                        <span>{j.display_name}</span>
                        <span className="text-muted">{toFaDigits(j.scored)} از {toFaDigits(d.entries.length)} اثر داوری شده</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">هنوز داوری تعیین نشده است.</p>
                )}
              </Card>
              <Card title={<span className="inline-flex items-center gap-1"><Trophy className="size-4" /> آثار و رتبه‌بندی</span>}>
                {d.entries.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-muted">
                        <tr><th className="p-1 text-start">رتبه</th><th className="p-1 text-start">نشریه</th><th className="p-1 text-start">شماره</th><th className="p-1 text-start">میانگین</th><th className="p-1 text-start">داوری</th></tr>
                      </thead>
                      <tbody>
                        {d.entries.map((e: any) => (
                          <tr key={e.id} className="border-t border-line">
                            <td className="p-1 font-bold">{e.rank ? toFaDigits(e.rank) : '—'}</td>
                            <td className="p-1">{e.publication_title}</td>
                            <td className="p-1">{toFaDigits(e.issue_number)} · {e.issue_title}</td>
                            <td className="p-1">{e.avg_total != null ? `${toFaDigits(e.avg_total)} از ${toFaDigits(totalMax)}` : '—'}</td>
                            <td className="p-1 text-muted">{toFaDigits(e.score_count)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-muted">هنوز اثری ارسال نشده است.</p>
                )}
              </Card>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  {n && <Button loading={busy} onClick={() => advance(f)}>{n.label}</Button>}
                  {f.status === 'draft' && <Button variant="danger" loading={busy} icon={<Trash2 className="size-4" />} onClick={() => remove(f)}>حذف</Button>}
                </div>
              )}
              {judgeOpen && <JudgePicker id={id} current={d.judges.map((j: any) => j.id)} onClose={() => setJudgeOpen(false)} onDone={() => (setJudgeOpen(false), st.reload(), onChanged())} />}
            </div>
          )
        }}
      </Async>
    </Modal>
  )
}

function JudgePicker({ id, current, onClose, onDone }: { id: string; current: string[]; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState('')
  const st = useAsync(() => api.get<{ users: any[] }>('/api/admin/users?q=' + encodeURIComponent(q)), [q])
  const [picked, setPicked] = useState<Set<string>>(new Set(current))
  const { run, busy } = useAction()
  const toggle = (uid: string) => setPicked((s) => { const n = new Set(s); n.has(uid) ? n.delete(uid) : n.add(uid); return n })
  const save = async () => {
    if (await run(() => api.put(`/api/festivals/${id}/judges`, { user_ids: [...picked] }), 'داوران ذخیره شدند')) onDone()
  }
  return (
    <Modal open onClose={onClose} title="تعیین داوران" footer={<Button loading={busy} onClick={save}>ذخیره ({toFaDigits(picked.size)} داور)</Button>}>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجوی نام یا نام کاربری…" aria-label="جست‌وجوی داور" />
      <Async state={st}>
        {(d) => (
          <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto">
            {d.users.filter((u) => u.status === 'active').map((u) => (
              <li key={u.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg p-2 hover:bg-surface-2">
                  <input type="checkbox" checked={picked.has(u.id)} onChange={() => toggle(u.id)} />
                  <span className="flex-1">{u.display_name}</span>
                  <span className="text-xs text-muted" dir="ltr">{u.username}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Async>
    </Modal>
  )
}

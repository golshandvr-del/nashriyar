import { useState } from 'react'
import { CalendarClock, Megaphone, Pin, Plus, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { faDate, relativeFa, toFaDigits } from '../lib/format'
import { Async, Badge, Button, Card, Empty, Input, Modal, PageHeader, Select, Tabs, Textarea, useAction, useAsync, useToast } from '../components/ui'

type TabKey = 'announcements' | 'deadlines'
const AUDIENCE: Record<string, string> = { all: 'همهٔ نشریات', faculty: 'نشریات یک دانشکده', publication: 'یک نشریه' }

export default function AdminAnnouncements() {
  const [tab, setTab] = useState<TabKey>('announcements')
  return (
    <div className="space-y-4">
      <PageHeader title="اطلاعیه و مهلت" subtitle="ارسال اطلاعیه به تیم نشریات و تعریف مهلت‌های عمومی" />
      <Tabs<TabKey>
        tabs={[
          { key: 'announcements', label: 'اطلاعیه‌ها' },
          { key: 'deadlines', label: 'مهلت‌ها' }
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'announcements' ? <Announcements /> : <Deadlines />}
    </div>
  )
}

function Announcements() {
  const st = useAsync(() => api.get('/api/admin/announcements'), [])
  const [open, setOpen] = useState(false)
  const { run, busy } = useAction()
  const { confirm } = useToast()
  const remove = async (a: any) => {
    if (!(await confirm(`اطلاعیهٔ «${a.title}» حذف شود؟`, { danger: true, okLabel: 'حذف' }))) return
    if (await run(() => api.del(`/api/admin/announcements/${a.id}`), 'حذف شد')) st.reload()
  }
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" /> اطلاعیهٔ جدید
        </Button>
      </div>
      <Async state={st}>
        {(d: any) =>
          !d.announcements.length ? (
            <Empty icon={<Megaphone className="size-10 opacity-60" />} title="هنوز اطلاعیه‌ای ارسال نشده" />
          ) : (
            <ul className="space-y-2">
              {d.announcements.map((a: any) => (
                <li key={a.id}>
                  <Card className="p-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {a.pinned ? <Pin className="size-4 text-brand" aria-label="سنجاق‌شده" /> : null}
                          <h3 className="font-bold">{a.title}</h3>
                          <Badge>{AUDIENCE[a.audience] || a.audience}</Badge>
                        </div>
                        <p className="mt-2 text-sm whitespace-pre-wrap text-muted">{a.body}</p>
                        <div className="mt-2 text-xs text-muted">
                          {a.author_name || '—'} · {relativeFa(a.created_at)} · {toFaDigits(a.read_count || 0)} بار خوانده‌شده
                        </div>
                      </div>
                      <Button variant="danger" disabled={busy} onClick={() => remove(a)} aria-label="حذف">
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )
        }
      </Async>
      {open && <AnnouncementModal onClose={() => setOpen(false)} onDone={() => (setOpen(false), st.reload())} />}
    </div>
  )
}

function AnnouncementModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: '', body: '', audience: 'all', target_id: '', pinned: false })
  const structure = useAsync(() => (f.audience === 'faculty' ? api.get('/api/admin/structure') : Promise.resolve(null)), [f.audience])
  const pubs = useAsync(() => (f.audience === 'publication' ? api.get('/api/admin/publications') : Promise.resolve(null)), [f.audience])
  const { run, busy } = useAction()
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }))
  const targets: { value: string; label: string }[] =
    f.audience === 'faculty'
      ? ((structure.data as any)?.faculties || []).map((x: any) => ({ value: x.id, label: x.name }))
      : f.audience === 'publication'
        ? ((pubs.data as any)?.publications || []).map((x: any) => ({ value: x.id, label: x.title }))
        : []
  const valid = f.title.trim() && f.body.trim() && (f.audience === 'all' || f.target_id)
  const submit = async () => {
    const payload = { ...f, title: f.title.trim(), body: f.body.trim(), target_id: f.audience === 'all' ? null : f.target_id }
    if (await run(() => api.post('/api/admin/announcements', payload), 'اطلاعیه ارسال شد')) onDone()
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="اطلاعیهٔ جدید"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>انصراف</Button>
          <Button disabled={busy || !valid} onClick={submit}>
            <Megaphone className="size-4" /> ارسال
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="label">عنوان</span>
          <Input value={f.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">متن</span>
          <Textarea rows={6} value={f.body} maxLength={5000} onChange={(e) => set({ body: e.target.value })} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">مخاطب</span>
            <Select value={f.audience} onChange={(e) => set({ audience: e.target.value, target_id: '' })} options={Object.entries(AUDIENCE).map(([value, label]) => ({ value, label }))} />
          </label>
          {f.audience !== 'all' && (
            <label className="block">
              <span className="label">{f.audience === 'faculty' ? 'دانشکده' : 'نشریه'}</span>
              <Select value={f.target_id} onChange={(e) => set({ target_id: e.target.value })} placeholder="انتخاب کنید" options={targets} />
            </label>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.pinned} onChange={(e) => set({ pinned: e.target.checked })} />
          سنجاق در بالای پنل تیم‌ها
        </label>
        <p className="text-xs text-muted">صاحبان نقش نشریه‌های مخاطب، اعلان دریافت می‌کنند.</p>
      </div>
    </Modal>
  )
}

function Deadlines() {
  const st = useAsync(() => api.get('/api/admin/deadlines'), [])
  const [f, setF] = useState({ title: '', due_at: '', description: '' })
  const { run, busy } = useAction()
  const { confirm } = useToast()
  const today = new Date().toISOString().slice(0, 10)
  const add = async () => {
    if (await run(() => api.post('/api/admin/deadlines', { title: f.title.trim(), due_at: f.due_at, description: f.description.trim() }), 'مهلت ثبت شد')) {
      setF({ title: '', due_at: '', description: '' })
      st.reload()
    }
  }
  const remove = async (d: any) => {
    if (!(await confirm(`مهلت «${d.title}» حذف شود؟`, { danger: true, okLabel: 'حذف' }))) return
    if (await run(() => api.del(`/api/admin/deadlines/${d.id}`), 'حذف شد')) st.reload()
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <Card className="h-fit space-y-3 p-4">
        <h2 className="font-bold">مهلت جدید</h2>
        <Input value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="عنوان (مثلاً: ارسال شماره‌های جشنواره)" />
        <label className="block">
          <span className="label">تاریخ مهلت</span>
          <Input type="date" value={f.due_at} onChange={(e) => setF({ ...f, due_at: e.target.value })} />
          {f.due_at && <span className="mt-1 block text-xs text-muted">{faDate(f.due_at)}</span>}
        </label>
        <Textarea rows={3} value={f.description} maxLength={1000} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="توضیح (اختیاری)" />
        <Button disabled={busy || !f.title.trim() || !f.due_at} onClick={add}>
          <Plus className="size-4" /> افزودن
        </Button>
      </Card>
      <Async state={st}>
        {(d: any) =>
          !d.deadlines.length ? (
            <Empty icon={<CalendarClock className="size-10 opacity-60" />} title="مهلتی تعریف نشده" />
          ) : (
            <ul className="space-y-2">
              {d.deadlines.map((x: any) => {
                const past = x.due_at < today
                return (
                  <li key={x.id} className="card flex items-start gap-3 p-4">
                    <CalendarClock className={past ? 'size-5 shrink-0 text-muted' : 'size-5 shrink-0 text-brand'} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold">{x.title}</span>
                        <Badge tone={past ? 'muted' : 'warn'}>{faDate(x.due_at)}</Badge>
                        {past && <Badge>گذشته</Badge>}
                      </div>
                      {x.description && <p className="mt-1 text-sm text-muted">{x.description}</p>}
                    </div>
                    <Button variant="danger" disabled={busy} onClick={() => remove(x)} aria-label="حذف">
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )
        }
      </Async>
    </div>
  )
}

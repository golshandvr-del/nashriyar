import { useState } from 'react'
import { Megaphone, Plus, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { faDate } from '../lib/format'
import { Async, Badge, Button, Empty, Field, Input, Modal, PageHeader, Textarea, useAction, useAsync, useToast } from '../components/ui'
import { useTeam } from './Layout'

export default function TeamRecruit() {
  const { pubId } = useTeam()
  const st = useAsync(() => api.get(`/api/team/${pubId}/recruitment`), [pubId])
  const [open, setOpen] = useState(false)
  const { confirm } = useToast()
  const { run } = useAction()
  const del = async (c: any) => {
    if (!(await confirm(`فراخوان «${c.title}» حذف شود؟`, { danger: true, okLabel: 'حذف' }))) return
    run(async () => {
      await api.del(`/api/team/${pubId}/recruitment/${c.id}`)
      st.reload()
    }, 'حذف شد')
  }
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div>
      <PageHeader
        title="فراخوان جذب همکار"
        subtitle="فراخوان‌های باز در صفحهٔ عمومی «فراخوان‌ها» و صفحهٔ نشریه نمایش داده می‌شوند."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
            فراخوان جدید
          </Button>
        }
      />
      <Async state={st}>
        {(d: any) =>
          !d.calls.length ? (
            <Empty icon={<Megaphone className="size-8" />} title="فراخوانی ندارید" hint="مثلاً «به ویراستار و گرافیست نیازمندیم»." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {d.calls.map((c: any) => {
                const open = !c.open_until || c.open_until >= today
                return (
                  <article key={c.id} className="card space-y-2 p-4">
                    <header className="flex items-start justify-between gap-2">
                      <h2 className="font-bold">{c.title}</h2>
                      <div className="flex items-center gap-1">
                        <Badge tone={open ? 'ok' : 'muted'}>{open ? 'باز' : 'بسته'}</Badge>
                        <button className="rounded-lg p-1.5 text-danger hover:bg-surface-2" onClick={() => del(c)} aria-label="حذف">
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </header>
                    {c.roles_needed && <p className="text-sm">نقش‌ها: {c.roles_needed}</p>}
                    {c.body && <p className="text-sm leading-7 whitespace-pre-wrap text-muted">{c.body}</p>}
                    <footer className="flex flex-wrap gap-3 text-xs text-muted">
                      {c.contact && <span>ارتباط: {c.contact}</span>}
                      <span>{c.open_until ? `مهلت: ${faDate(c.open_until)}` : 'بدون مهلت'}</span>
                    </footer>
                  </article>
                )
              })}
            </div>
          )
        }
      </Async>
      {open && (
        <NewCall
          pubId={pubId}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false)
            st.reload()
          }}
        />
      )}
    </div>
  )
}

function NewCall({ pubId, onClose, onDone }: { pubId: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: '', roles_needed: '', body: '', contact: '', open_until: '' })
  const { busy, run } = useAction()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))
  return (
    <Modal
      open
      onClose={onClose}
      title="فراخوان جدید"
      footer={
        <Button
          loading={busy}
          disabled={f.title.trim().length < 3}
          onClick={() =>
            run(async () => {
              await api.post(`/api/team/${pubId}/recruitment`, f)
              onDone()
            }, 'فراخوان منتشر شد')
          }
        >
          انتشار
        </Button>
      }
    >
      <div className="space-y-3">
        <Field label="عنوان *">
          <Input value={f.title} onChange={set('title')} maxLength={120} autoFocus />
        </Field>
        <Field label="نقش‌های مورد نیاز">
          <Input value={f.roles_needed} onChange={set('roles_needed')} maxLength={300} placeholder="نویسنده، ویراستار، گرافیست" />
        </Field>
        <Field label="توضیحات">
          <Textarea value={f.body} onChange={set('body')} maxLength={3000} rows={5} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="راه ارتباط">
            <Input value={f.contact} onChange={set('contact')} maxLength={120} placeholder="@nashriye" />
          </Field>
          <Field label="مهلت (اختیاری)">
            <Input type="date" value={f.open_until} onChange={set('open_until')} dir="ltr" />
          </Field>
        </div>
      </div>
    </Modal>
  )
}

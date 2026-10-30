import { useState } from 'react'
import { ArrowDown, ArrowUp, GitMerge, Pencil, Plus } from 'lucide-react'
import { api } from '../lib/api'
import { toFaDigits } from '../lib/format'
import { Async, Badge, Button, Empty, Field, Input, Modal, PageHeader, Select, Tabs, useAction, useAsync } from '../components/ui'
import { useAdminRole } from './Layout'

const TYPES = { subject: 'موضوعی', major: 'رشته‌ای', format: 'قالب', custom: 'سفارشی' } as Record<string, string>
type T = 'subject' | 'major' | 'format' | 'custom'

export default function AdminCategories() {
  const { admin } = useAdminRole()
  const st = useAsync(() => api.get('/api/admin/categories'), [])
  const [type, setType] = useState<T>('subject')
  const [edit, setEdit] = useState<any | null>(null)
  const [merge, setMerge] = useState(false)
  const { run } = useAction()

  return (
    <div className="space-y-4">
      <PageHeader
        title="دسته‌بندی‌ها"
        subtitle="دسته‌های موضوعی، رشته‌ای، قالب و سفارشی برای مرور پیشخوان"
        actions={
          admin && (
            <div className="flex gap-2">
              <Button icon={<Plus className="size-4" />} onClick={() => setEdit({ type })}>دستهٔ جدید</Button>
              <Button variant="ghost" icon={<GitMerge className="size-4" />} onClick={() => setMerge(true)}>ادغام</Button>
            </div>
          )
        }
      />
      <Tabs<T> value={type} onChange={setType} tabs={(Object.keys(TYPES) as T[]).map((k) => ({ key: k, label: TYPES[k] }))} />
      <Async state={st}>
        {(d: any) => {
          const all: any[] = d.categories
          const roots = all.filter((c) => c.type === type && !c.parent_id)
          const kids = (id: string) => all.filter((c) => c.parent_id === id)
          // move a root within its siblings and persist full order of this type
          const move = async (id: string, dir: -1 | 1) => {
            const list = [...roots]
            const i = list.findIndex((c) => c.id === id)
            const j = i + dir
            if (j < 0 || j >= list.length) return
            ;[list[i], list[j]] = [list[j], list[i]]
            const order = list.flatMap((c) => [{ id: c.id, parent_id: null }, ...kids(c.id).map((k) => ({ id: k.id, parent_id: c.id }))])
            if (await run(() => api.post('/api/admin/categories/order', { order }))) st.reload()
          }
          const Row = ({ c, child, idx }: { c: any; child?: boolean; idx?: number }) => (
            <div className={`flex items-center justify-between gap-2 border-t border-line p-3 first:border-0 ${child ? 'pr-8' : ''} ${c.is_active ? '' : 'opacity-50'}`}>
              <div className="flex min-w-0 items-center gap-2">
                <span className="size-3 shrink-0 rounded-full border border-line" style={{ background: c.color || 'transparent' }} />
                <span className="truncate font-medium">{c.name}</span>
                <span className="font-mono text-xs text-muted" dir="ltr">/{c.slug}</span>
                {!c.is_active && <Badge>غیرفعال</Badge>}
              </div>
              <div className="flex shrink-0 items-center gap-1 text-xs text-muted">
                <span>{toFaDigits(c.publication_count)} نشریه · {toFaDigits(c.issue_count)} شماره</span>
                {admin && !child && idx !== undefined && (
                  <>
                    <button className="rounded p-1 hover:bg-surface-2 disabled:opacity-30" disabled={idx === 0} onClick={() => move(c.id, -1)} aria-label="بالا"><ArrowUp className="size-4" /></button>
                    <button className="rounded p-1 hover:bg-surface-2 disabled:opacity-30" disabled={idx === roots.length - 1} onClick={() => move(c.id, 1)} aria-label="پایین"><ArrowDown className="size-4" /></button>
                  </>
                )}
                {admin && <button className="rounded p-1 hover:bg-surface-2" onClick={() => setEdit(c)} aria-label="ویرایش"><Pencil className="size-4" /></button>}
              </div>
            </div>
          )
          return (
            <>
              {!roots.length ? (
                <Empty title="دسته‌ای در این گروه نیست" />
              ) : (
                <div className="card">
                  {roots.map((c, idx) => (
                    <div key={c.id}>
                      <Row c={c} idx={idx} />
                      {kids(c.id).map((k) => <Row key={k.id} c={k} child />)}
                    </div>
                  ))}
                </div>
              )}
              {edit && <CategoryModal cat={edit} all={all} onClose={() => setEdit(null)} onDone={() => (setEdit(null), st.reload())} />}
              {merge && <MergeModal all={all} onClose={() => setMerge(false)} onDone={() => (setMerge(false), st.reload())} />}
            </>
          )
        }}
      </Async>
    </div>
  )
}

function CategoryModal({ cat, all, onClose, onDone }: { cat: any; all: any[]; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction()
  const [f, setF] = useState({ name: cat.name || '', slug: cat.slug || '', type: cat.type || 'subject', parent_id: cat.parent_id || '', icon: cat.icon || '', color: cat.color || '#0f766e', is_active: cat.is_active === undefined ? true : !!cat.is_active })
  const parents = all.filter((c) => c.type === f.type && !c.parent_id && c.id !== cat.id)
  const submit = async () => {
    if (await run(() => api.post('/api/admin/categories', { id: cat.id, ...f, parent_id: f.parent_id || null, slug: cat.id ? undefined : f.slug || undefined }), 'ذخیره شد')) onDone()
  }
  return (
    <Modal open onClose={onClose} title={cat.id ? 'ویرایش دسته' : 'دستهٔ جدید'} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={busy} onClick={submit}>ذخیره</Button></>}>
      <div className="space-y-3">
        <Field label="نام"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} /></Field>
        {!cat.id && <Field label="نامک" hint="خالی = خودکار"><Input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} dir="ltr" /></Field>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="نوع"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, parent_id: '' })} options={Object.entries(TYPES).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="والد"><Select value={f.parent_id} onChange={(e) => setF({ ...f, parent_id: e.target.value })} placeholder="بدون والد" options={parents.map((p) => ({ value: p.id, label: p.name }))} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="آیکن (نام Lucide)"><Input value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })} dir="ltr" placeholder="book-open" /></Field>
          <Field label="رنگ"><input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="h-10 w-20 rounded-lg border border-line" /></Field>
        </div>
        {cat.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> فعال</label>}
      </div>
    </Modal>
  )
}

function MergeModal({ all, onClose, onDone }: { all: any[]; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction()
  const [from, setFrom] = useState('')
  const [into, setInto] = useState('')
  const opts = all.filter((c) => c.is_active).map((c) => ({ value: c.id, label: `${c.name} (${TYPES[c.type]})` }))
  const submit = async () => {
    if (await run(() => api.post('/api/admin/categories/merge', { from, into }), 'ادغام شد')) onDone()
  }
  return (
    <Modal open onClose={onClose} title="ادغام دو دسته" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button variant="danger" loading={busy} disabled={!from || !into || from === into} onClick={submit}>ادغام</Button></>}>
      <p className="mb-3 text-xs text-muted">همهٔ نشریات، شماره‌ها و زیردسته‌های دستهٔ مبدأ به دستهٔ مقصد منتقل و دستهٔ مبدأ غیرفعال می‌شود.</p>
      <div className="space-y-3">
        <Field label="دستهٔ مبدأ"><Select value={from} onChange={(e) => setFrom(e.target.value)} placeholder="انتخاب کنید" options={opts} /></Field>
        <Field label="ادغام در"><Select value={into} onChange={(e) => setInto(e.target.value)} placeholder="انتخاب کنید" options={opts.filter((o) => o.value !== from)} /></Field>
      </div>
    </Modal>
  )
}

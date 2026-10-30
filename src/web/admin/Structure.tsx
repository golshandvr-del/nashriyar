import { useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { ASSOC_KIND, toFaDigits } from '../lib/format'
import { Async, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Tabs, Textarea, useAction, useAsync, useToast } from '../components/ui'
import { useAdminRole } from './Layout'

type Tab = 'faculties' | 'associations' | 'roles'

export default function AdminStructure() {
  const { admin } = useAdminRole()
  const st = useAsync(() => api.get('/api/admin/structure'), [])
  const [tab, setTab] = useState<Tab>('faculties')
  return (
    <div className="space-y-4">
      <PageHeader title="ساختار دانشگاه" subtitle="دانشکده‌ها، رشته‌ها، انجمن‌ها/کانون‌ها و نقش‌های تولید" />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ key: 'faculties', label: 'دانشکده‌ها و رشته‌ها' }, { key: 'associations', label: 'انجمن‌ها و کانون‌ها' }, { key: 'roles', label: 'نقش‌های تولید' }]} />
      <Async state={st}>
        {(d: any) => (
          <>
            {tab === 'faculties' && <Faculties d={d} admin={admin} reload={st.reload} />}
            {tab === 'associations' && <Associations d={d} admin={admin} reload={st.reload} />}
            {tab === 'roles' && <ProductionRoles roles={d.production_roles} admin={admin} reload={st.reload} />}
          </>
        )}
      </Async>
    </div>
  )
}

function Faculties({ d, admin, reload }: { d: any; admin: boolean; reload: () => void }) {
  const [fac, setFac] = useState<any | null>(null)
  const [major, setMajor] = useState<any | null>(null)
  const { run } = useAction()
  const { confirm } = useToast()
  const delMajor = async (m: any) => {
    if (!(await confirm(`رشتهٔ «${m.name}» حذف شود؟`))) return
    if (await run(() => api.del(`/api/admin/majors/${m.id}`), 'حذف شد')) reload()
  }
  return (
    <div className="space-y-3">
      {admin && (
        <div className="flex gap-2">
          <Button icon={<Plus className="size-4" />} onClick={() => setFac({})}>دانشکدهٔ جدید</Button>
          <Button variant="ghost" icon={<Plus className="size-4" />} onClick={() => setMajor({})} disabled={!d.faculties.length}>رشتهٔ جدید</Button>
        </div>
      )}
      {!d.faculties.length ? (
        <Empty title="دانشکده‌ای تعریف نشده" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {d.faculties.map((f: any) => {
            const majors = d.majors.filter((m: any) => m.faculty_id === f.id)
            return (
              <Card
                key={f.id}
                title={
                  <span className="flex items-center gap-2">
                    {f.name}
                    {f.code && <span className="font-mono text-xs text-muted" dir="ltr">{f.code}</span>}
                    {!f.is_active && <Badge>غیرفعال</Badge>}
                  </span>
                }
                action={admin && <button className="rounded-lg p-1.5 text-muted hover:bg-surface-2" aria-label="ویرایش" onClick={() => setFac(f)}><Pencil className="size-4" /></button>}
              >
                <div className="mb-2 text-xs text-muted">{toFaDigits(f.publication_count)} نشریه · {toFaDigits(majors.length)} رشته</div>
                <div className="flex flex-wrap gap-1.5">
                  {majors.map((m: any) => (
                    <span key={m.id} className="chip">
                      {admin ? <button onClick={() => setMajor(m)} className="hover:text-brand">{m.name}</button> : m.name}
                      {admin && <button onClick={() => delMajor(m)} className="text-muted hover:text-danger" aria-label={`حذف ${m.name}`}><Trash2 className="size-3" /></button>}
                    </span>
                  ))}
                </div>
              </Card>
            )
          })}
        </div>
      )}
      {fac && <FacultyModal fac={fac} onClose={() => setFac(null)} onDone={() => (setFac(null), reload())} />}
      {major && <MajorModal major={major} faculties={d.faculties} onClose={() => setMajor(null)} onDone={() => (setMajor(null), reload())} />}
    </div>
  )
}

function FacultyModal({ fac, onClose, onDone }: { fac: any; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction()
  const [f, setF] = useState({ name: fac.name || '', code: fac.code || '', sort_order: String(fac.sort_order ?? 0), is_active: fac.is_active === undefined ? true : !!fac.is_active })
  const submit = async () => {
    if (await run(() => api.post('/api/admin/faculties', { id: fac.id, name: f.name, code: f.code || null, sort_order: Number(f.sort_order) || 0, is_active: f.is_active }), 'ذخیره شد')) onDone()
  }
  return (
    <Modal open onClose={onClose} title={fac.id ? 'ویرایش دانشکده' : 'دانشکدهٔ جدید'} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={busy} onClick={submit}>ذخیره</Button></>}>
      <div className="space-y-3">
        <Field label="نام"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="کد"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} dir="ltr" /></Field>
          <Field label="ترتیب"><Input type="number" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: e.target.value })} dir="ltr" /></Field>
        </div>
        {fac.id && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> فعال</label>
        )}
      </div>
    </Modal>
  )
}

function MajorModal({ major, faculties, onClose, onDone }: { major: any; faculties: any[]; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction()
  const [f, setF] = useState({ name: major.name || '', faculty_id: major.faculty_id || faculties[0]?.id || '' })
  const submit = async () => {
    if (await run(() => api.post('/api/admin/majors', { id: major.id, ...f }), 'ذخیره شد')) onDone()
  }
  return (
    <Modal open onClose={onClose} title={major.id ? 'ویرایش رشته' : 'رشتهٔ جدید'} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={busy} onClick={submit}>ذخیره</Button></>}>
      <div className="space-y-3">
        <Field label="نام رشته"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="دانشکده"><Select value={f.faculty_id} onChange={(e) => setF({ ...f, faculty_id: e.target.value })} options={faculties.map((x) => ({ value: x.id, label: x.name }))} /></Field>
      </div>
    </Modal>
  )
}

function Associations({ d, admin, reload }: { d: any; admin: boolean; reload: () => void }) {
  const [edit, setEdit] = useState<any | null>(null)
  return (
    <div className="space-y-3">
      {admin && <Button icon={<Plus className="size-4" />} onClick={() => setEdit({})}>انجمن/کانون جدید</Button>}
      {!d.associations.length ? (
        <Empty title="انجمنی تعریف نشده" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className="p-3 text-right">نام</th>
                <th className="p-3 text-right">نوع</th>
                <th className="hidden p-3 text-right sm:table-cell">دانشکده</th>
                <th className="p-3 text-center">نشریات</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {d.associations.map((a: any) => (
                <tr key={a.id} className={`border-t border-line ${a.is_active ? '' : 'opacity-50'}`}>
                  <td className="p-3 font-medium">{a.name}</td>
                  <td className="p-3 text-xs">{ASSOC_KIND[a.kind] || a.kind}</td>
                  <td className="hidden p-3 text-xs sm:table-cell">{a.faculty_name || 'دانشگاهی'}</td>
                  <td className="p-3 text-center">{toFaDigits(a.publication_count)}</td>
                  <td className="p-3 text-left">
                    {admin && <button className="rounded-lg p-1.5 text-muted hover:bg-surface-2" aria-label="ویرایش" onClick={() => setEdit(a)}><Pencil className="size-4" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <AssociationModal a={edit} faculties={d.faculties} onClose={() => setEdit(null)} onDone={() => (setEdit(null), reload())} />}
    </div>
  )
}

function AssociationModal({ a, faculties, onClose, onDone }: { a: any; faculties: any[]; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction()
  const [f, setF] = useState({ name: a.name || '', kind: a.kind || 'scientific_association', faculty_id: a.faculty_id || '', is_active: a.is_active === undefined ? true : !!a.is_active })
  const submit = async () => {
    if (await run(() => api.post('/api/admin/associations', { id: a.id, ...f, faculty_id: f.faculty_id || null }), 'ذخیره شد')) onDone()
  }
  return (
    <Modal open onClose={onClose} title={a.id ? 'ویرایش انجمن/کانون' : 'انجمن/کانون جدید'} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={busy} onClick={submit}>ذخیره</Button></>}>
      <div className="space-y-3">
        <Field label="نام"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="نوع"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={Object.entries(ASSOC_KIND).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="دانشکده"><Select value={f.faculty_id} onChange={(e) => setF({ ...f, faculty_id: e.target.value })} placeholder="دانشگاهی (بدون دانشکده)" options={faculties.map((x) => ({ value: x.id, label: x.name }))} /></Field>
        {a.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> فعال</label>}
      </div>
    </Modal>
  )
}

function ProductionRoles({ roles, admin, reload }: { roles: any[]; admin: boolean; reload: () => void }) {
  const [text, setText] = useState('')
  const { busy, run } = useAction()
  useEffect(() => setText(roles.map((r) => r.name).join('\n')), [roles])
  const save = async () => {
    if (await run(() => api.post('/api/admin/production-roles', { roles: text.split('\n').map((s) => s.trim()).filter(Boolean) }), 'ذخیره شد')) reload()
  }
  return (
    <Card title="نقش‌های تولید" action={<span className="text-xs text-muted">در فرم اعضا و تخصیص بخش‌ها استفاده می‌شوند</span>}>
      {admin ? (
        <div className="space-y-3">
          <Field label="هر نقش در یک خط" hint="ترتیب خطوط = ترتیب نمایش"><Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} /></Field>
          <Button loading={busy} onClick={save}>ذخیره</Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">{roles.map((r) => <span key={r.id} className="chip">{r.name}</span>)}</div>
      )}
    </Card>
  )
}

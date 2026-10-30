import { useState } from 'react'
import { KeyRound, Plus, Search, UserCheck, UserX } from 'lucide-react'
import { api, qs } from '../lib/api'
import { ROLE_LABEL } from '../lib/auth'
import { relativeFa, toFaDigits } from '../lib/format'
import { Async, Badge, Button, Empty, Input, Modal, PageHeader, Select, useAction, useAsync, useToast } from '../components/ui'
import { CredentialsSheet, type Credential } from './PublicationNew'
import { useAdminRole } from './Layout'

const ROLE_FILTERS = ['', 'super_admin', 'pub_officer', 'faculty_supervisor', 'analyst', 'team', 'student'] as const

export default function AdminUsers() {
  const { isSuper, user } = useAdminRole()
  const [role, setRole] = useState('')
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const st = useAsync(() => api.get('/api/admin/users' + qs({ role, q: term })), [role, term])
  const [creating, setCreating] = useState(false)
  const [creds, setCreds] = useState<Credential[] | null>(null)
  const { run, busy } = useAction()
  const { confirm } = useToast()

  // Mirrors server-side guards: officers cannot touch super admins / other officers.
  const canManage = (u: any) => u.id !== user?.id && (isSuper || !['super_admin', 'pub_officer'].includes(u.system_role))

  const reset = async (u: any) => {
    if (!(await confirm(`رمز «${u.display_name}» بازنشانی شود؟ همهٔ نشست‌های فعال او بسته می‌شود.`, { danger: true, okLabel: 'بازنشانی' }))) return
    const r: any = await run(() => api.post(`/api/admin/users/${u.id}/reset-password`))
    if (r) setCreds([{ ...r.credentials, role_fa: ROLE_LABEL[u.system_role as keyof typeof ROLE_LABEL] }])
  }
  const toggle = async (u: any) => {
    const next = u.status === 'suspended' ? 'active' : 'suspended'
    if (next === 'suspended' && !(await confirm(`حساب «${u.display_name}» تعلیق شود؟`, { danger: true, okLabel: 'تعلیق' }))) return
    if (await run(() => api.post(`/api/admin/users/${u.id}/status`, { status: next }), next === 'active' ? 'فعال شد' : 'تعلیق شد')) st.reload()
  }

  if (creds) return <CredentialsSheet title="برگهٔ ورود" items={creds} onDone={() => (setCreds(null), st.reload())} />

  return (
    <div className="space-y-4">
      <PageHeader
        title="کاربران"
        subtitle="کارکنان سامانه، حساب‌های تیم و دانشجویان"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> کاربر کارمندی جدید
          </Button>
        }
      />
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setTerm(q.trim())
        }}
      >
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />
          <Input className="pr-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="نام، نام کاربری یا شمارهٔ دانشجویی…" />
        </div>
        <Button type="submit" variant="ghost">جست‌وجو</Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {ROLE_FILTERS.map((r) => (
          <button key={r} className={role === r ? 'chip border-brand bg-brand-soft text-brand' : 'chip'} onClick={() => setRole(r)}>
            {r ? ROLE_LABEL[r] : 'همه'}
          </button>
        ))}
      </div>
      <Async state={st}>
        {(d: any) =>
          !d.users.length ? (
            <Empty title="کاربری یافت نشد" />
          ) : (
            <div className="card overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>نام</th>
                    <th>نام کاربری</th>
                    <th>نقش</th>
                    <th>دانشکده / نشریه</th>
                    <th>آخرین ورود</th>
                    <th>وضعیت</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d.users.map((u: any) => (
                    <tr key={u.id}>
                      <td className="font-medium">
                        {u.display_name}
                        {u.must_change_password ? <Badge tone="warn" className="ms-2">رمز موقت</Badge> : null}
                      </td>
                      <td dir="ltr" className="text-start text-muted">{u.username || (u.student_number && toFaDigits(u.student_number)) || '—'}</td>
                      <td><Badge tone={['super_admin', 'pub_officer'].includes(u.system_role) ? 'brand' : 'muted'}>{ROLE_LABEL[u.system_role as keyof typeof ROLE_LABEL] || u.system_role}</Badge></td>
                      <td className="max-w-56 truncate text-xs text-muted">{u.publications || u.faculty_name || '—'}</td>
                      <td className="text-xs text-muted">{u.last_login_at ? relativeFa(u.last_login_at) : 'هرگز'}</td>
                      <td>{u.status === 'suspended' ? <Badge tone="danger">تعلیق</Badge> : <Badge tone="ok">فعال</Badge>}</td>
                      <td>
                        {canManage(u) && (
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" disabled={busy} onClick={() => reset(u)} aria-label="بازنشانی رمز" title="بازنشانی رمز">
                              <KeyRound className="size-4" />
                            </Button>
                            <Button variant={u.status === 'suspended' ? 'ghost' : 'danger'} disabled={busy} onClick={() => toggle(u)} aria-label={u.status === 'suspended' ? 'فعال‌سازی' : 'تعلیق'} title={u.status === 'suspended' ? 'فعال‌سازی' : 'تعلیق'}>
                              {u.status === 'suspended' ? <UserCheck className="size-4" /> : <UserX className="size-4" />}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Async>
      {creating && (
        <CreateModal
          isSuper={isSuper}
          onClose={() => setCreating(false)}
          onDone={(c) => {
            setCreating(false)
            setCreds([c])
          }}
        />
      )}
    </div>
  )
}

function CreateModal({ isSuper, onClose, onDone }: { isSuper: boolean; onClose: () => void; onDone: (c: Credential) => void }) {
  const roles = (isSuper ? ['pub_officer', 'faculty_supervisor', 'analyst'] : ['faculty_supervisor', 'analyst']) as (keyof typeof ROLE_LABEL)[]
  const [f, setF] = useState({ display_name: '', username: '', system_role: roles[0] as string, scope_faculty_id: '' })
  const structure = useAsync(() => api.get('/api/admin/structure'), [])
  const { run, busy } = useAction()
  const valid = f.display_name.trim().length >= 2 && /^[a-z0-9._-]{3,40}$/.test(f.username) && (f.system_role !== 'faculty_supervisor' || f.scope_faculty_id)
  const submit = async () => {
    const r: any = await run(() => api.post('/api/admin/users', { ...f, display_name: f.display_name.trim() }), 'کاربر ساخته شد')
    if (r) onDone({ ...r.credentials, role_fa: ROLE_LABEL[f.system_role as keyof typeof ROLE_LABEL] })
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="کاربر کارمندی جدید"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>انصراف</Button>
          <Button disabled={busy || !valid} onClick={submit}><Plus className="size-4" /> ساخت و صدور رمز موقت</Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="label">نام و نام خانوادگی</span>
          <Input value={f.display_name} maxLength={80} onChange={(e) => setF({ ...f, display_name: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">نام کاربری (لاتین)</span>
          <Input dir="ltr" value={f.username} maxLength={40} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') })} />
        </label>
        <label className="block">
          <span className="label">نقش</span>
          <Select value={f.system_role} onChange={(e) => setF({ ...f, system_role: e.target.value })} options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
        </label>
        {f.system_role === 'faculty_supervisor' && (
          <label className="block">
            <span className="label">دانشکدهٔ تحت نظارت</span>
            <Select
              value={f.scope_faculty_id}
              onChange={(e) => setF({ ...f, scope_faculty_id: e.target.value })}
              placeholder="انتخاب کنید"
              options={((structure.data as any)?.faculties || []).map((x: any) => ({ value: x.id, label: x.name }))}
            />
          </label>
        )}
        <p className="text-xs text-muted">رمز موقت یک‌بار نمایش داده می‌شود و کاربر باید در اولین ورود آن را تغییر دهد.</p>
      </div>
    </Modal>
  )
}

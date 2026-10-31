import { useState } from 'react'
import { KeyRound, Plus, Search, ShieldOff, UserCheck, UserX } from 'lucide-react'
import { api, qs } from '../lib/api'
import { ROLE_LABEL } from '../lib/auth'
import { relativeFa, toFaDigits } from '../lib/format'
import { Async, Badge, Button, Empty, Input, Modal, PageHeader, Select, useAction, useAsync, useToast } from '../components/ui'
import { CredentialsSheet, type Credential } from './PublicationNew'
import { useAdminRole } from './Layout'

const ROLE_FILTERS = ['', 'super_admin', 'pub_officer', 'faculty_supervisor', 'analyst', 'team', 'student'] as const
const PUB_ROLE_FA: Record<string, string> = { managing_director: 'مدیرمسئول', editor_in_chief: 'سردبیر', license_holder: 'صاحب امتیاز' }
const DEGREE_FA: Record<string, string> = { associate: 'کاردانی', bachelor: 'کارشناسی', master: 'کارشناسی ارشد', phd: 'دکتری' }
type Filters = { category: string; pub_role: string; production_role: string; publication_id: string; faculty_id: string; gender: string; degree: string; entry_year: string }
const EMPTY_FILTERS: Filters = { category: '', pub_role: '', production_role: '', publication_id: '', faculty_id: '', gender: '', degree: '', entry_year: '' }

export default function AdminUsers() {
  const { isSuper, user } = useAdminRole()
  const [role, setRole] = useState('')
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  // ROADMAP phase 15: «تیم نشریه» category + filters by publication role, production role, publication, faculty, gender, degree, entry year
  const [fl, setFl] = useState<Filters>(EMPTY_FILTERS)
  const setF = (k: keyof Filters, v: string) => setFl((x) => ({ ...x, [k]: v }))
  const opts = useAsync(() => Promise.all([api.get<any>('/api/membership/options'), api.get<any>('/api/public/categories')]), [])
  const st = useAsync(() => api.get('/api/admin/users' + qs({ role, q: term, ...fl })), [role, term, JSON.stringify(fl)])
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
  const resetTotp = async (u: any) => {
    if (!(await confirm(`رمز دومرحله‌ای «${u.display_name}» غیرفعال شود؟ (برای وقتی که گوشی خود را گم کرده است؛ پس از ورود باید دوباره راه‌اندازی کند)`, { danger: true, okLabel: 'غیرفعال کن' }))) return
    if (await run(() => api.post(`/api/admin/users/${u.id}/reset-totp`), 'رمز دومرحله‌ای غیرفعال شد')) st.reload()
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
      <div id="user-filters" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select aria-label="دسته" value={fl.category} onChange={(e) => setF('category', e.target.value)} placeholder="همهٔ دسته‌ها" options={[{ value: 'team', label: 'تیم نشریه (سمت یا عضویت)' }]} />
        <Select aria-label="سمت نشریه" value={fl.pub_role} onChange={(e) => setF('pub_role', e.target.value)} placeholder="سمت نشریه" options={Object.entries(PUB_ROLE_FA).map(([value, label]) => ({ value, label }))} />
        <Select aria-label="نقش تولید" value={fl.production_role} onChange={(e) => setF('production_role', e.target.value)} placeholder="نقش تولید" options={(opts.data?.[0]?.roles || []).map((r: any) => ({ value: r.name, label: r.name }))} />
        <Select aria-label="نشریه" value={fl.publication_id} onChange={(e) => setF('publication_id', e.target.value)} placeholder="همهٔ نشریات" options={(opts.data?.[0]?.publications || []).map((p: any) => ({ value: p.id, label: p.title }))} />
        <Select aria-label="دانشکده" value={fl.faculty_id} onChange={(e) => setF('faculty_id', e.target.value)} placeholder="همهٔ دانشکده‌ها" options={(opts.data?.[1]?.faculties || []).map((f: any) => ({ value: f.id, label: f.name }))} />
        <Select aria-label="جنسیت" value={fl.gender} onChange={(e) => setF('gender', e.target.value)} placeholder="جنسیت (با رضایت)" options={[{ value: 'male', label: 'مرد' }, { value: 'female', label: 'زن' }]} />
        <Select aria-label="مقطع" value={fl.degree} onChange={(e) => setF('degree', e.target.value)} placeholder="مقطع" options={Object.entries(DEGREE_FA).map(([value, label]) => ({ value, label }))} />
        <Input aria-label="سال ورود" inputMode="numeric" value={fl.entry_year} onChange={(e) => setF('entry_year', e.target.value.replace(/[^0-9۰-۹]/g, '').replace(/[۰-۹]/g, (x) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(x))).slice(0, 4))} placeholder="سال ورود (مثلاً ۱۴۰۲)" />
      </div>
      {Object.values(fl).some(Boolean) && (
        <button type="button" className="text-xs text-brand underline" onClick={() => setFl(EMPTY_FILTERS)}>پاک کردن فیلترها</button>
      )}
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
                        {u.totp_enabled ? <Badge tone="ok" className="ms-2">2FA</Badge> : null}
                      </td>
                      <td dir="ltr" className="text-start text-muted">{u.username || (u.student_number && toFaDigits(u.student_number)) || '—'}</td>
                      <td><Badge tone={['super_admin', 'pub_officer'].includes(u.system_role) ? 'brand' : 'muted'}>{ROLE_LABEL[u.system_role as keyof typeof ROLE_LABEL] || u.system_role}</Badge></td>
                      <td className="max-w-64 text-xs text-muted">
                        <span className="block truncate">{u.publications || u.faculty_name || '—'}</span>
                        {u.pub_roles && <span className="block truncate">{String(u.pub_roles).split(',').map((r: string) => PUB_ROLE_FA[r] || r).join('، ')}</span>}
                        {u.memberships && <span className="block truncate">عضو: {u.memberships}</span>}
                        {(u.degree || u.entry_year) && <span className="block truncate">{[DEGREE_FA[u.degree], u.entry_year ? `ورودی ${toFaDigits(u.entry_year)}` : null].filter(Boolean).join(' · ')}</span>}
                      </td>
                      <td className="text-xs text-muted">{u.last_login_at ? relativeFa(u.last_login_at) : 'هرگز'}</td>
                      <td>{u.status === 'suspended' ? <Badge tone="danger">تعلیق</Badge> : <Badge tone="ok">فعال</Badge>}</td>
                      <td>
                        {canManage(u) && (
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" disabled={busy} onClick={() => reset(u)} aria-label="بازنشانی رمز" title="بازنشانی رمز">
                              <KeyRound className="size-4" />
                            </Button>
                            {!!u.totp_enabled && (
                              <Button variant="ghost" disabled={busy} onClick={() => resetTotp(u)} aria-label="بازنشانی رمز دومرحله‌ای" title="بازنشانی رمز دومرحله‌ای">
                                <ShieldOff className="size-4" />
                              </Button>
                            )}
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

// /system/staff — senior staff accounts (super admin & publication officer) are managed ONLY here (ROADMAP phase 13).
// Every write needs sudo; new/reset passwords are shown once and must be changed on first login.
import { useState } from 'react'
import { KeyRound, ShieldOff, UserPlus } from 'lucide-react'
import { api } from '../lib/api'
import { ROLE_LABEL } from '../lib/auth'
import type { SystemRole } from '../lib/auth'
import { Async, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, useAsync, useToast } from '../components/ui'
import { faDate, relativeFa } from '../../shared/fa'
import { useSudo } from './lib'

type U = { id: string; username: string; display_name: string; system_role: SystemRole; status: string; totp_enabled: number; must_change_password: number; last_login_at: string | null; created_at: string }
type Cred = { name: string; username: string; password: string }

export default function SystemStaff() {
  const st = useAsync(() => api.get<{ staff: U[] }>('/api/system/staff'), [])
  const { guard } = useSudo()
  const { confirm } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [cred, setCred] = useState<Cred | null>(null)
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ display_name: '', username: '', system_role: 'pub_officer' })
  const act = async <T,>(key: string, fn: () => Promise<T>, ok?: string) => {
    setBusy(key)
    const r = await guard(fn, ok)
    setBusy(null)
    if (r) st.reload()
    return r
  }
  const create = async () => {
    const r = await act('new', () => api.post<{ credentials: Cred }>('/api/system/staff', f), 'حساب ساخته شد')
    if (r) {
      setOpen(false)
      setF({ display_name: '', username: '', system_role: 'pub_officer' })
      setCred(r.credentials)
    }
  }
  return (
    <div className="space-y-4">
      <PageHeader
        title="کارکنان ارشد"
        subtitle="حساب‌های مدیر کل و مسئول نشریات فقط از این بخش ساخته و مدیریت می‌شوند"
        actions={
          <Button icon={<UserPlus className="size-4" />} onClick={() => setOpen(true)}>
            حساب جدید
          </Button>
        }
      />
      <Async state={st}>
        {(d) => (
          <Card>
            <ul className="divide-y divide-line text-sm">
              {d.staff.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {u.display_name} <span dir="ltr" className="text-xs text-muted">@{u.username}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1 text-xs">
                      <Badge tone="brand">{ROLE_LABEL[u.system_role]}</Badge>
                      {u.status !== 'active' && <Badge tone="danger">غیرفعال</Badge>}
                      {u.totp_enabled ? <Badge tone="ok">۲FA فعال</Badge> : <Badge tone="warn">بدون ۲FA</Badge>}
                      {!!u.must_change_password && <Badge tone="warn">رمز موقت</Badge>}
                      <span className="text-muted">آخرین ورود: {u.last_login_at ? relativeFa(u.last_login_at) : '—'} · ساخت {faDate(u.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      variant="ghost"
                      loading={busy === 'pw:' + u.id}
                      icon={<KeyRound className="size-4" />}
                      onClick={async () => {
                        if (!(await confirm(`رمز «${u.display_name}» بازنشانی شود؟ همهٔ نشست‌هایش بسته می‌شود.`, { okLabel: 'بازنشانی' }))) return
                        const r = await act('pw:' + u.id, () => api.post<{ credentials: Cred }>(`/api/system/staff/${u.id}/reset-password`, {}))
                        if (r) setCred(r.credentials)
                      }}
                    >
                      بازنشانی رمز
                    </Button>
                    {!!u.totp_enabled && (
                      <Button
                        variant="ghost"
                        loading={busy === 'totp:' + u.id}
                        icon={<ShieldOff className="size-4" />}
                        onClick={async () => {
                          if (await confirm(`رمز دومرحله‌ای «${u.display_name}» حذف شود؟ (برای گوشی گم‌شده)`, { danger: true, okLabel: 'حذف ۲FA' }))
                            act('totp:' + u.id, () => api.post(`/api/system/staff/${u.id}/reset-totp`, {}), 'رمز دومرحله‌ای حذف شد')
                        }}
                      >
                        حذف ۲FA
                      </Button>
                    )}
                    <Button
                      variant={u.status === 'active' ? 'danger' : 'ghost'}
                      loading={busy === 'st:' + u.id}
                      onClick={async () => {
                        const next = u.status === 'active' ? 'suspended' : 'active'
                        if (next === 'suspended' && !(await confirm(`حساب «${u.display_name}» غیرفعال شود؟`, { danger: true, okLabel: 'غیرفعال' }))) return
                        act('st:' + u.id, () => api.post(`/api/system/staff/${u.id}/status`, { status: next }), next === 'active' ? 'حساب فعال شد' : 'حساب غیرفعال شد')
                      }}
                    >
                      {u.status === 'active' ? 'غیرفعال' : 'فعال‌سازی'}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Async>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="حساب کارمند ارشد جدید"
        footer={
          <Button loading={busy === 'new'} disabled={f.display_name.trim().length < 2 || f.username.trim().length < 3} onClick={create}>
            ساخت حساب
          </Button>
        }
      >
        <div className="space-y-3">
          <Field label="نام و نام خانوادگی">
            <Input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} />
          </Field>
          <Field label="نام کاربری" hint="حروف لاتین، عدد و . _ -">
            <Input dir="ltr" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
          </Field>
          <Field label="نقش">
            <Select
              value={f.system_role}
              onChange={(e) => setF({ ...f, system_role: e.target.value })}
              options={[
                { value: 'pub_officer', label: ROLE_LABEL.pub_officer },
                { value: 'super_admin', label: ROLE_LABEL.super_admin }
              ]}
            />
          </Field>
        </div>
      </Modal>

      <Modal open={!!cred} onClose={() => setCred(null)} title="اطلاعات ورود (فقط یک بار نمایش داده می‌شود)" footer={<Button onClick={() => setCred(null)}>یادداشت کردم</Button>}>
        {cred && (
          <div className="space-y-2 text-sm">
            <p>{cred.name}</p>
            <div dir="ltr" className="select-all rounded-xl bg-surface-2 p-3 font-mono">
              username: {cred.username}
              <br />
              password: {cred.password}
            </div>
            <p className="text-xs text-muted">این رمز موقت است و در اولین ورود باید تغییر کند. آن را از راهی امن تحویل دهید.</p>
          </div>
        )}
      </Modal>
    </div>
  )
}

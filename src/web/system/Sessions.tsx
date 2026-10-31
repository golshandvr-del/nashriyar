// /system/sessions — active sessions of all users and login locks (ROADMAP phase 13).
// Session ids are never sent to the browser: rows carry a 12-char `ref` used only for revocation.
import { useState } from 'react'
import { LockOpen, LogOut, RefreshCw } from 'lucide-react'
import { api } from '../lib/api'
import { ROLE_LABEL } from '../lib/auth'
import type { SystemRole } from '../lib/auth'
import { Async, Badge, Button, Card, Empty, Input, PageHeader, useAsync, useToast } from '../components/ui'
import { faDate, relativeFa, toFaDigits } from '../../shared/fa'
import { useSudo } from './lib'

type S = { ref: string; user_id: string; created_at: string; expires_at: string; user_agent: string | null; username: string; display_name: string; system_role: SystemRole; current: boolean }
type L = { key: string; count: number; window_start: string; locked_until: string | null; locked: boolean }

function device(ua: string | null) {
  if (!ua) return 'نامشخص'
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : ''
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl|node|undici/i.test(ua) ? 'اسکریپت' : 'مرورگر'
  return [br, os].filter(Boolean).join(' / ')
}

export default function SystemSessions() {
  const st = useAsync(() => api.get<{ sessions: S[]; locks: L[] }>('/api/system/sessions'), [])
  const { guard } = useSudo()
  const { confirm } = useToast()
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const act = async (key: string, fn: () => Promise<any>, ok: string) => {
    setBusy(key)
    const r = await guard(fn, ok)
    setBusy(null)
    if (r) st.reload()
  }
  return (
    <div className="space-y-4">
      <PageHeader
        title="نشست‌ها و قفل‌های ورود"
        subtitle="خروج اجباری کاربران و رفع قفل ورود — هر اقدام در گزارش فنی ثبت می‌شود"
        actions={
          <Button variant="ghost" icon={<RefreshCw className="size-4" />} onClick={st.reload}>
            به‌روزرسانی
          </Button>
        }
      />
      <Async state={st}>
        {(d) => {
          const needle = q.trim().toLowerCase()
          const list = needle ? d.sessions.filter((s) => s.username.toLowerCase().includes(needle) || s.display_name.includes(q.trim())) : d.sessions
          const locked = d.locks.filter((l) => l.locked || l.count > 0)
          return (
            <>
              <Card title={`قفل‌ها و تلاش‌های ناموفق (${toFaDigits(locked.length)})`}>
                {locked.length === 0 ? (
                  <p className="text-sm text-ok">هیچ حساب یا نشانی‌ای قفل نیست.</p>
                ) : (
                  <ul className="divide-y divide-line text-sm">
                    {locked.map((l) => (
                      <li key={l.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <div className="min-w-0">
                          <div dir="ltr" className="truncate text-start font-mono text-xs">
                            {l.key}
                          </div>
                          <div className="text-xs text-muted">
                            {l.locked ? <Badge tone="danger">قفل تا {faDate(l.locked_until, true)}</Badge> : <Badge tone="warn">{toFaDigits(l.count)} تلاش ناموفق</Badge>}
                          </div>
                        </div>
                        <Button variant="ghost" loading={busy === 'lock:' + l.key} icon={<LockOpen className="size-4" />} onClick={() => act('lock:' + l.key, () => api.post('/api/system/locks/clear', { key: l.key }), 'قفل برداشته شد')}>
                          رفع قفل
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title={`نشست‌های فعال (${toFaDigits(d.sessions.length)})`} action={<Input className="max-w-48" placeholder="جستجوی کاربر…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="جستجوی کاربر" />}>
                {list.length === 0 ? (
                  <Empty title="نشستی یافت نشد" />
                ) : (
                  <ul className="divide-y divide-line text-sm">
                    {list.map((s) => (
                      <li key={s.ref} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <div className="min-w-0">
                          <div className="font-medium">
                            {s.display_name} <span dir="ltr" className="text-xs text-muted">@{s.username}</span> <Badge>{ROLE_LABEL[s.system_role] || s.system_role}</Badge> {s.current && <Badge tone="ok">نشست فعلی شما</Badge>}
                          </div>
                          <div className="text-xs text-muted">
                            {device(s.user_agent)} · ورود {relativeFa(s.created_at)} · انقضا {faDate(s.expires_at)}
                          </div>
                        </div>
                        {!s.current && (
                          <div className="flex gap-1">
                            <Button variant="ghost" loading={busy === 's:' + s.ref} onClick={() => act('s:' + s.ref, () => api.post(`/api/system/sessions/${s.ref}/revoke`, {}), 'نشست بسته شد')}>
                              بستن نشست
                            </Button>
                            <Button
                              variant="ghost"
                              loading={busy === 'u:' + s.user_id}
                              icon={<LogOut className="size-4" />}
                              onClick={async () => {
                                if (await confirm(`همهٔ نشست‌های «${s.display_name}» بسته شود؟`, { danger: true, okLabel: 'خروج از همه' })) act('u:' + s.user_id, () => api.post(`/api/system/users/${s.user_id}/logout-all`, {}), 'کاربر از همهٔ دستگاه‌ها خارج شد')
                              }}
                            >
                              خروج از همه
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          )
        }}
      </Async>
    </div>
  )
}

// Team membership request queue (ROADMAP phase 15): the managing director / editor-in-chief approves or rejects
// students who asked to join. Approval links the account to a team member record and notifies the requester.
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, Inbox, X } from 'lucide-react'
import { api } from '../lib/api'
import { faDate, formatNumber } from '../lib/format'
import { Badge, Button, Card, Field, Input, Modal, Select, useAction, useAsync } from '../components/ui'
import { DEGREE_LABEL } from '../public/ProfileForm'
import { REQUEST_STATUS } from '../public/MembershipCard'

export default function MembershipRequests({ pubId, roles, onApproved }: { pubId: string; roles: { id: string; name: string }[]; onApproved?: () => void }) {
  const [sp] = useSearchParams()
  const [status, setStatus] = useState<'pending' | 'all'>('pending')
  const st = useAsync(() => api.get<{ requests: any[] }>(`/api/membership/queue?publication_id=${pubId}&status=${status}`), [pubId, status])
  const [decide, setDecide] = useState<{ r: any; decision: 'approve' | 'reject' } | null>(null)
  const [note, setNote] = useState('')
  const [role, setRole] = useState('')
  const { busy, run } = useAction()

  // license holders (and everyone else who cannot decide) get a 403: the panel simply stays hidden
  if (st.error) return null
  const rows = st.data?.requests || []
  const pending = rows.filter((r) => r.status === 'pending').length
  if (!st.loading && status === 'pending' && !pending && sp.get('tab') !== 'requests') return null

  const submit = async () => {
    if (!decide) return
    const ok = await run(
      () => api.post(`/api/membership/requests/${decide.r.id}/decide`, { decision: decide.decision, note: note.trim() || undefined, role_name: role || undefined }),
      decide.decision === 'approve' ? 'به تیم اضافه شد و اعلان ارسال شد' : 'درخواست رد شد'
    )
    if (ok) {
      setDecide(null)
      st.reload()
      if (decide.decision === 'approve') onApproved?.()
    }
  }

  return (
    <Card
      className="mb-4 border-brand/40"
      title={
        <span id="membership-requests" className="flex items-center gap-1">
          <Inbox className="size-4" /> درخواست‌های عضویت {pending > 0 && <Badge tone="warn">{formatNumber(pending)} در انتظار</Badge>}
        </span>
      }
      action={
        <Select
          aria-label="وضعیت درخواست‌ها"
          value={status}
          onChange={(e) => setStatus(e.target.value as 'pending' | 'all')}
          options={[
            { value: 'pending', label: 'در انتظار' },
            { value: 'all', label: 'همه' }
          ]}
        />
      }
    >
      {!rows.length ? (
        <p className="text-sm text-muted">درخواستی وجود ندارد.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="font-bold">
                  {r.display_name} <span className="font-normal text-muted" dir="ltr">{r.student_number || r.username}</span>
                </div>
                <div className="text-xs text-muted">
                  {[r.role_name && `سمت درخواستی: ${r.role_name}`, r.faculty_name, r.major_name, r.degree && DEGREE_LABEL[r.degree], r.entry_year && `ورودی ${formatNumber(r.entry_year)}`, faDate(r.created_at)]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {r.message && <p className="mt-1 rounded-lg bg-surface-2 p-2 text-xs">{r.message}</p>}
                {!r.profile_completed_at && <Badge tone="warn" className="mt-1">پروفایل ناقص</Badge>}
                {r.status !== 'pending' && r.decided_by_name && <div className="mt-1 text-xs text-muted">بررسی: {r.decided_by_name}{r.decision_note ? ` — ${r.decision_note}` : ''}</div>}
              </div>
              {r.status === 'pending' ? (
                <div className="flex gap-1">
                  <Button icon={<Check className="size-4" />} onClick={() => (setDecide({ r, decision: 'approve' }), setNote(''), setRole(r.role_name || ''))}>
                    تأیید
                  </Button>
                  <Button variant="ghost" icon={<X className="size-4" />} onClick={() => (setDecide({ r, decision: 'reject' }), setNote(''), setRole(''))}>
                    رد
                  </Button>
                </div>
              ) : (
                <Badge tone={REQUEST_STATUS[r.status]?.tone}>{REQUEST_STATUS[r.status]?.label || r.status}</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={!!decide}
        onClose={() => setDecide(null)}
        title={decide?.decision === 'approve' ? `تأیید عضویت ${decide?.r.display_name}` : `رد درخواست ${decide?.r.display_name}`}
        footer={
          <Button loading={busy} onClick={submit}>
            {decide?.decision === 'approve' ? 'تأیید و افزودن به تیم' : 'رد درخواست'}
          </Button>
        }
      >
        <div className="space-y-3">
          {decide?.decision === 'approve' && (
            <Field label="سمت در تیم" hint="می‌توانید سمت درخواستی را تغییر دهید">
              <Select value={role} onChange={(e) => setRole(e.target.value)} placeholder="بدون سمت" options={roles.map((x) => ({ value: x.name, label: x.name }))} />
            </Field>
          )}
          <Field label="یادداشت برای درخواست‌دهنده (اختیاری)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </Field>
        </div>
      </Modal>
    </Card>
  )
}

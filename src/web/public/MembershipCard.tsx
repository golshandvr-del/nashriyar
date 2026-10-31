// «درخواست‌های عضویت من» (ROADMAP phase 15): status of team membership requests, cancel, and file a new one.
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { UsersRound, X } from 'lucide-react'
import { api } from '../lib/api'
import { faDate } from '../lib/format'
import { Async, Badge, Button, Card, ErrorBox, Modal, useAction, useAsync } from '../components/ui'
import JoinPicker, { EMPTY_JOIN } from './JoinPicker'
import type { JoinValue } from './JoinPicker'

export const REQUEST_STATUS: Record<string, { label: string; tone: 'warn' | 'ok' | 'danger' | 'muted' }> = {
  pending: { label: 'در انتظار بررسی', tone: 'warn' },
  approved: { label: 'تأییدشده', tone: 'ok' },
  rejected: { label: 'ردشده', tone: 'danger' },
  cancelled: { label: 'لغوشده', tone: 'muted' }
}

export default function MembershipCard() {
  const [sp, setSp] = useSearchParams()
  const st = useAsync(() => api.get<{ requests: any[] }>('/api/membership/mine'), [])
  const [open, setOpen] = useState(false)
  const [join, setJoin] = useState<JoinValue>(EMPTY_JOIN)
  const { busy, run } = useAction()
  const joinError = sp.get('join_error')
  const focused = sp.get('tab') === 'membership'

  const send = async () => {
    const r = await run(
      () => api.post('/api/membership/requests', { publication_id: join.publication_id, role_name: join.role_name || undefined, message: join.message.trim() || undefined }),
      'درخواست عضویت ارسال شد'
    )
    if (r) {
      setOpen(false)
      setJoin(EMPTY_JOIN)
      if (joinError) (sp.delete('join_error'), setSp(sp, { replace: true }))
      st.reload()
    }
  }
  const cancel = async (id: string) => {
    if (await run(() => api.del(`/api/membership/requests/${id}`), 'درخواست لغو شد')) st.reload()
  }

  return (
    <Card
      title={<span id="membership" className="flex items-center gap-1"><UsersRound className="size-4" /> عضویت در تیم نشریه</span>}
      className={focused ? 'border-brand' : undefined}
      action={<Button variant="ghost" onClick={() => setOpen(true)}>درخواست تازه</Button>}
    >
      {joinError && (
        <div className="mb-3">
          <ErrorBox error={`حساب شما ساخته شد، اما درخواست عضویت ثبت نشد: ${joinError}`} />
        </div>
      )}
      <Async state={st}>
        {(d) =>
          d.requests.length ? (
            <ul className="divide-y divide-line text-sm">
              {d.requests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <b>{r.title}</b>
                    {r.role_name && <span className="text-muted"> · {r.role_name}</span>}
                    <span className="block text-xs text-muted">
                      {faDate(r.created_at)}
                      {r.decision_note ? ` · ${r.decision_note}` : ''}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Badge tone={REQUEST_STATUS[r.status]?.tone}>{REQUEST_STATUS[r.status]?.label || r.status}</Badge>
                    {r.status === 'pending' && (
                      <button type="button" onClick={() => cancel(r.id)} className="rounded-lg p-1 text-muted hover:bg-surface-2" aria-label="لغو درخواست" title="لغو درخواست">
                        <X className="size-4" />
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">هنوز درخواستی نداده‌اید. با «درخواست تازه» به تیم یک نشریه بپیوندید.</p>
          )
        }
      </Async>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="درخواست عضویت در تیم نشریه"
        footer={
          <Button loading={busy} disabled={!join.publication_id} onClick={send}>
            ارسال درخواست
          </Button>
        }
      >
        <JoinPicker value={join} onChange={setJoin} exclude={(st.data?.requests || []).filter((r) => r.status === 'pending').map((r) => r.publication_id)} />
      </Modal>
    </Card>
  )
}

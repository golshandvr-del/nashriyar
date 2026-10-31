import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Ban, Check, Flag, Reply, Sparkles, X } from 'lucide-react'
import { api, mediaUrl, qs } from '../lib/api'
import { COMMENT_STATUS, relativeFa } from '../lib/format'
import { Async, Badge, Button, Empty, Modal, PageHeader, Tabs, Textarea, useAction, useAsync } from '../components/ui'
import { useTeam } from './Layout'

type St = 'pending' | 'approved' | 'rejected' | 'spam'
const HINT_LABEL: Record<string, string> = { spam: 'احتمال هرزنامه', abusive: 'احتمال توهین‌آمیز', ok: 'عادی' }

export default function TeamComments() {
  const { pubId } = useTeam()
  const [status, setStatus] = useState<St>('pending')
  const st = useAsync(() => api.get(`/api/team/${pubId}/comments${qs({ status })}`), [pubId, status])
  const { busy, run } = useAction()
  const [replyTo, setReplyTo] = useState<any | null>(null)
  const [rejectFor, setRejectFor] = useState<any | null>(null)
  // Optional AI labels (ROADMAP phase 10): on demand only; the decision always stays with the team.
  const [aiLabels, setAiLabels] = useState<Record<string, string> | null>(null)
  const askAi = () =>
    run(async () => {
      const r = await api.post<{ enabled: boolean; labels: Record<string, string> }>(`/api/team/${pubId}/comments/ai-hints`)
      if (!r.enabled) throw new Error('لایهٔ هوش مصنوعی غیرفعال است')
      setAiLabels(r.labels)
    })

  const act = (c: any, action: 'approve' | 'reject' | 'spam', extra: Record<string, string> = {}) =>
    run(async () => {
      await api.post(`/api/team/${pubId}/comments/${c.id}`, { action, ...extra })
      st.setData((d: any) => (d ? { ...d, comments: d.comments.filter((x: any) => x.id !== c.id) } : d))
    }, action === 'approve' ? 'نظر تأیید و منتشر شد' : action === 'reject' ? 'نظر رد شد' : 'به‌عنوان هرزنامه علامت خورد')

  return (
    <div>
      <PageHeader
        title="نظرها"
        subtitle="نظرهای کاربران فقط پس از تأیید تیم برای دیگران نمایش داده می‌شوند."
        actions={
          status === 'pending' ? (
            <Button variant="ghost" className="text-xs" icon={<Sparkles className="size-4" />} disabled={busy} onClick={askAi}>
              برچسب پیشنهادی هوش مصنوعی
            </Button>
          ) : undefined
        }
      />
      <Tabs
        value={status}
        onChange={setStatus}
        tabs={(['pending', 'approved', 'rejected', 'spam'] as St[]).map((k) => ({ key: k, label: COMMENT_STATUS[k] }))}
      />
      <div className="mt-4">
        <Async state={st}>
          {(d: any) =>
            !d.comments.length ? (
              <Empty title={status === 'pending' ? 'نظری در انتظار بررسی نیست' : 'موردی نیست'} />
            ) : (
              <ul className="space-y-3">
                {d.comments.map((c: any) => (
                  <li key={c.id} className="card flex gap-3 p-3">
                    <Link to={`/post/${c.post_id}`} className="size-16 shrink-0 overflow-hidden rounded-lg bg-surface-2" title="مشاهدهٔ پست">
                      {c.image && <img src={mediaUrl(c.image)} alt="" className="size-full object-cover" loading="lazy" />}
                    </Link>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span className="font-bold text-ink">{c.is_team_reply ? 'پاسخ تیم' : c.author || 'کاربر'}</span>
                        <span>{relativeFa(c.created_at)}</span>
                        {!!c.flagged && (
                          <Badge tone="warn">
                            <Flag className="ml-1 inline size-3" />
                            پیش‌علامت: واژهٔ نامناسب
                          </Badge>
                        )}
                        {c.parent_id && <Badge>پاسخ به نظر دیگر</Badge>}
                        {c.hint && <Badge tone="warn">پیشنهاد قاعده: {HINT_LABEL[c.hint.label] || c.hint.label}</Badge>}
                        {aiLabels?.[c.id] && aiLabels[c.id] !== 'ok' && <Badge tone="warn">پیشنهاد هوش مصنوعی: {HINT_LABEL[aiLabels[c.id]] || aiLabels[c.id]}</Badge>}
                      </div>
                      <p className="text-sm leading-7 whitespace-pre-wrap">{c.body}</p>
                      {c.caption && <p className="truncate text-[11px] text-muted">روی پست: {c.caption}</p>}
                      {!c.is_team_reply && (
                        <div className="flex flex-wrap gap-2">
                          {status !== 'approved' && (
                            <Button className="!px-3 !py-1.5 text-xs" icon={<Check className="size-4" />} disabled={busy} onClick={() => act(c, 'approve')}>
                              تأیید
                            </Button>
                          )}
                          <Button variant="ghost" className="!px-3 !py-1.5 text-xs" icon={<Reply className="size-4" />} disabled={busy} onClick={() => setReplyTo(c)}>
                            پاسخ
                          </Button>
                          {status !== 'rejected' && (
                            <Button variant="ghost" className="!px-3 !py-1.5 text-xs" icon={<X className="size-4" />} disabled={busy} onClick={() => setRejectFor(c)}>
                              رد
                            </Button>
                          )}
                          {status !== 'spam' && (
                            <Button variant="ghost" className="!px-3 !py-1.5 text-xs text-danger" icon={<Ban className="size-4" />} disabled={busy} onClick={() => act(c, 'spam')}>
                              هرزنامه
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )
          }
        </Async>
      </div>
      {replyTo && (
        <TextModal
          title="پاسخ تیم"
          hint="پاسخ تیم بلافاصله منتشر می‌شود و نظر اصلی (اگر در انتظار باشد) هم تأیید می‌شود."
          okLabel="ارسال پاسخ"
          min={2}
          onClose={() => setReplyTo(null)}
          onOk={(text) =>
            run(async () => {
              await api.post(`/api/team/${pubId}/comments/${replyTo.id}`, { action: 'reply', reply: text })
              setReplyTo(null)
              st.reload()
            }, 'پاسخ منتشر شد')
          }
        />
      )}
      {rejectFor && (
        <TextModal
          title="رد نظر"
          hint="دلیل (اختیاری) فقط برای ثبت داخلی است؛ به نویسنده فقط «تأیید نشد» اعلام می‌شود."
          okLabel="رد نظر"
          min={0}
          danger
          onClose={() => setRejectFor(null)}
          onOk={async (text) => {
            await act(rejectFor, 'reject', { reason: text })
            setRejectFor(null)
          }}
        />
      )}
    </div>
  )
}

function TextModal({ title, hint, okLabel, min, danger, onClose, onOk }: { title: string; hint: string; okLabel: string; min: number; danger?: boolean; onClose: () => void; onOk: (t: string) => unknown }) {
  const [t, setT] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <Button
          variant={danger ? 'danger' : 'primary'}
          loading={busy}
          disabled={t.trim().length < min}
          onClick={async () => {
            setBusy(true)
            try {
              await onOk(t.trim())
            } finally {
              setBusy(false)
            }
          }}
        >
          {okLabel}
        </Button>
      }
    >
      <Textarea value={t} onChange={(e) => setT(e.target.value)} rows={4} maxLength={1000} autoFocus />
      <p className="mt-2 text-xs text-muted">{hint}</p>
    </Modal>
  )
}

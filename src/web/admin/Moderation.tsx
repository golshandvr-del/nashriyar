import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Ban, Check, Eye, EyeOff, Flag, RotateCcw, X } from 'lucide-react'
import { api, mediaUrl, qs } from '../lib/api'
import { COMMENT_STATUS, faDate, relativeFa, toFaDigits } from '../lib/format'
import { Async, Badge, Button, Empty, Modal, PageHeader, Tabs, Textarea, useAction, useAsync, useToast } from '../components/ui'

type TabKey = 'reports' | 'posts' | 'comments'

const REPORT_STATUS: Record<string, { label: string; tone: 'warn' | 'ok' | 'muted' }> = {
  open: { label: 'باز', tone: 'warn' },
  resolved: { label: 'رسیدگی‌شده', tone: 'ok' },
  dismissed: { label: 'ردشده', tone: 'muted' }
}
const ENTITY_LABEL: Record<string, string> = { post: 'پست', comment: 'نظر', issue: 'شماره', publication: 'نشریه', user: 'کاربر' }
const POST_STATUS: Record<string, { label: string; tone: 'ok' | 'danger' | 'muted' | 'warn' }> = {
  published: { label: 'منتشرشده', tone: 'ok' },
  hidden_by_admin: { label: 'پنهان توسط مدیر', tone: 'danger' },
  draft: { label: 'پیش‌نویس', tone: 'muted' },
  scheduled: { label: 'زمان‌بندی‌شده', tone: 'warn' }
}

function entityLink(type: string, id: string): string | null {
  if (type === 'post') return `/post/${id}`
  if (type === 'issue') return `/issue/${id}`
  if (type === 'publication') return `/admin/publications/${id}`
  return null
}

export default function AdminModeration() {
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') as TabKey) || 'reports'
  return (
    <div className="space-y-4">
      <PageHeader title="نظارت محتوا" subtitle="رسیدگی به گزارش‌ها، پنهان‌سازی پست‌ها و بررسی نظرها" />
      <Tabs<TabKey>
        tabs={[
          { key: 'reports', label: 'گزارش‌ها' },
          { key: 'posts', label: 'پست‌ها' },
          { key: 'comments', label: 'نظرها' }
        ]}
        value={tab}
        onChange={(k) => setSp({ tab: k }, { replace: true })}
      />
      {tab === 'reports' && <Reports />}
      {tab === 'posts' && <Posts />}
      {tab === 'comments' && <Comments />}
    </div>
  )
}

function Reports() {
  const st = useAsync(() => api.get('/api/admin/reports'), [])
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const { run, busy } = useAction()
  const setStatus = async (id: string, status: string, msg: string) => {
    if (await run(() => api.post(`/api/admin/reports/${id}`, { status }), msg)) st.reload()
  }
  return (
    <Async state={st}>
      {(d: any) => {
        const rows = d.reports.filter((r: any) => filter === 'all' || r.status === 'open')
        const openCount = d.reports.filter((r: any) => r.status === 'open').length
        return (
          <div className="space-y-3">
            <div className="flex gap-2">
              <button className={filter === 'open' ? 'chip border-brand bg-brand-soft text-brand' : 'chip'} onClick={() => setFilter('open')}>
                باز ({toFaDigits(openCount)})
              </button>
              <button className={filter === 'all' ? 'chip border-brand bg-brand-soft text-brand' : 'chip'} onClick={() => setFilter('all')}>
                همه ({toFaDigits(d.reports.length)})
              </button>
            </div>
            {!rows.length ? (
              <Empty icon={<Flag className="size-10 opacity-60" />} title="گزارشی برای رسیدگی نیست" />
            ) : (
              <ul className="space-y-2">
                {rows.map((r: any) => {
                  const link = entityLink(r.entity_type, r.entity_id)
                  const s = REPORT_STATUS[r.status] || REPORT_STATUS.open
                  return (
                    <li key={r.id} className="card flex flex-wrap items-start gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <Badge tone={s.tone}>{s.label}</Badge>
                          <Badge>{ENTITY_LABEL[r.entity_type] || r.entity_type}</Badge>
                          <span className="text-muted">{r.reporter_name || 'کاربر ناشناس'} · {relativeFa(r.created_at)}</span>
                        </div>
                        <p className="mt-2 text-sm whitespace-pre-wrap">{r.reason || <span className="text-muted">بدون توضیح</span>}</p>
                        {link && (
                          <Link to={link} target="_blank" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-brand">
                            <Eye className="size-3" /> مشاهدهٔ محتوا
                          </Link>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {r.status === 'open' ? (
                          <>
                            <Button disabled={busy} onClick={() => setStatus(r.id, 'resolved', 'رسیدگی شد')}>
                              <Check className="size-4" /> رسیدگی شد
                            </Button>
                            <Button variant="ghost" disabled={busy} onClick={() => setStatus(r.id, 'dismissed', 'گزارش رد شد')}>
                              <X className="size-4" /> رد گزارش
                            </Button>
                          </>
                        ) : (
                          <Button variant="ghost" disabled={busy} onClick={() => setStatus(r.id, 'open', 'دوباره باز شد')}>
                            <RotateCcw className="size-4" /> بازگشایی
                          </Button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      }}
    </Async>
  )
}

function Posts() {
  const [status, setStatus] = useState('')
  const st = useAsync(() => api.get('/api/admin/posts' + qs({ status })), [status])
  const [hideFor, setHideFor] = useState<any>(null)
  const { run, busy } = useAction()
  const unhide = async (id: string) => {
    if (await run(() => api.post(`/api/admin/posts/${id}/visibility`, { hidden: false }), 'پست دوباره نمایش داده شد')) st.reload()
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {[
          ['', 'همه'],
          ['published', 'منتشرشده'],
          ['hidden_by_admin', 'پنهان‌شده']
        ].map(([k, l]) => (
          <button key={k} className={status === k ? 'chip border-brand bg-brand-soft text-brand' : 'chip'} onClick={() => setStatus(k)}>
            {l}
          </button>
        ))}
      </div>
      <Async state={st}>
        {(d: any) =>
          !d.posts.length ? (
            <Empty title="پستی یافت نشد" />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {d.posts.map((p: any) => {
                const s = POST_STATUS[p.status] || { label: p.status, tone: 'muted' as const }
                return (
                  <li key={p.id} className="card overflow-hidden">
                    <div className="relative aspect-square bg-surface-2">
                      {p.images?.[0] && <img src={mediaUrl(p.images[0])} alt="" loading="lazy" className="size-full object-cover" />}
                      {p.open_reports > 0 && (
                        <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                          <Flag className="size-3" /> {toFaDigits(p.open_reports)} گزارش
                        </span>
                      )}
                    </div>
                    <div className="space-y-2 p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={s.tone}>{s.label}</Badge>
                        {p.is_story ? <Badge tone="brand">استوری</Badge> : null}
                      </div>
                      <div className="font-bold">{p.publication_title}</div>
                      <div className="text-xs text-muted">
                        از شمارهٔ {toFaDigits(p.source_issue_number)} — {p.source_issue_title} · {faDate(p.published_at)}
                      </div>
                      {p.caption && <p className="line-clamp-3 text-muted">{p.caption}</p>}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Link to={`/post/${p.id}`} target="_blank" className="btn-ghost text-xs">
                          <Eye className="size-4" /> مشاهده
                        </Link>
                        {p.status === 'hidden_by_admin' ? (
                          <Button variant="ghost" disabled={busy} onClick={() => unhide(p.id)}>
                            <Eye className="size-4" /> نمایش دوباره
                          </Button>
                        ) : (
                          <Button variant="danger" disabled={busy} onClick={() => setHideFor(p)}>
                            <EyeOff className="size-4" /> پنهان کردن
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )
        }
      </Async>
      {hideFor && <HideModal post={hideFor} onClose={() => setHideFor(null)} onDone={() => (setHideFor(null), st.reload())} />}
    </div>
  )
}

function HideModal({ post, onClose, onDone }: { post: any; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const { run, busy } = useAction()
  const submit = async () => {
    if (await run(() => api.post(`/api/admin/posts/${post.id}/visibility`, { hidden: true, reason: reason.trim() }), 'پست پنهان شد و به تیم اطلاع داده شد')) onDone()
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="پنهان کردن پست"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>انصراف</Button>
          <Button variant="danger" disabled={busy} onClick={submit}>
            <EyeOff className="size-4" /> پنهان کن
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">
        پست نشریهٔ «{post.publication_title}» از دید عموم پنهان می‌شود و صاحبان نقش نشریه اعلان دریافت می‌کنند.
      </p>
      <label className="block">
        <span className="label">دلیل (برای تیم نمایش داده می‌شود)</span>
        <Textarea rows={3} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً: نقض حق نشر تصویر" />
      </label>
    </Modal>
  )
}

function Comments() {
  const [status, setStatus] = useState('pending')
  const st = useAsync(() => api.get('/api/admin/comments' + qs({ status })), [status])
  const { run, busy } = useAction()
  const { confirm } = useToast()
  const act = async (id: string, action: 'approve' | 'reject' | 'spam') => {
    if (action === 'spam' && !(await confirm('این نظر به‌عنوان هرزنامه علامت بخورد؟', { danger: true, okLabel: 'هرزنامه' }))) return
    const msg = action === 'approve' ? 'تأیید شد' : action === 'reject' ? 'رد شد' : 'به‌عنوان هرزنامه علامت خورد'
    if (await run(() => api.post(`/api/admin/comments/${id}`, { action }), msg)) st.reload()
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {Object.entries(COMMENT_STATUS).map(([k, l]) => (
          <button key={k} className={status === k ? 'chip border-brand bg-brand-soft text-brand' : 'chip'} onClick={() => setStatus(k)}>
            {l}
          </button>
        ))}
      </div>
      <Async state={st}>
        {(d: any) =>
          !d.comments.length ? (
            <Empty title="نظری در این وضعیت نیست" />
          ) : (
            <ul className="space-y-2">
              {d.comments.map((cm: any) => (
                <li key={cm.id} className="card flex flex-wrap items-start gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span className="font-bold text-ink">{cm.author || 'کاربر حذف‌شده'}</span>
                      {cm.student_number && <span>({toFaDigits(cm.student_number)})</span>}
                      <span>· {cm.publication_title}</span>
                      <span>· {relativeFa(cm.created_at)}</span>
                      {cm.flagged ? <Badge tone="warn">مشکوک</Badge> : null}
                    </div>
                    <p className="mt-2 text-sm whitespace-pre-wrap">{cm.body}</p>
                    <Link to={`/post/${cm.post_id}`} target="_blank" className="mt-1 inline-flex items-center gap-1 text-xs text-brand">
                      <Eye className="size-3" /> پست مربوط
                    </Link>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {cm.status !== 'approved' && (
                      <Button disabled={busy} onClick={() => act(cm.id, 'approve')}>
                        <Check className="size-4" /> تأیید
                      </Button>
                    )}
                    {cm.status !== 'rejected' && (
                      <Button variant="ghost" disabled={busy} onClick={() => act(cm.id, 'reject')}>
                        <X className="size-4" /> رد
                      </Button>
                    )}
                    {cm.status !== 'spam' && (
                      <Button variant="danger" disabled={busy} onClick={() => act(cm.id, 'spam')}>
                        <Ban className="size-4" /> هرزنامه
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </Async>
    </div>
  )
}

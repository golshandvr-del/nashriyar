import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Eye, Undo2 } from 'lucide-react'
import { api, mediaUrl } from '../lib/api'
import { faDate, formatToman, relativeFa, toFaDigits } from '../lib/format'
import { Async, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Textarea, useAction, useAsync } from '../components/ui'
import { Cover } from '../components/cards'

export default function AdminApprovals() {
  const st = useAsync(() => api.get('/api/admin/approvals'), [])
  const [target, setTarget] = useState<{ issue: any; decision: 'approved' | 'changes_requested' } | null>(null)

  return (
    <div className="space-y-6">
      <PageHeader title="تأیید انتشار" subtitle="هیچ شماره‌ای بدون تأیید مسئول نشریات منتشر نمی‌شود." />
      <Async state={st}>
        {(d: any) => (
          <>
            {!d.can_decide && <div className="card p-3 text-sm text-muted">شما فقط مشاهده‌گر صف تأیید هستید؛ تصمیم‌گیری با مسئول نشریات است.</div>}
            {!d.pending.length ? (
              <Empty title="صف تأیید خالی است" hint="شماره‌هایی که تیم‌ها برای انتشار ارسال کنند این‌جا نمایش داده می‌شوند." />
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {d.pending.map((i: any) => (
                  <div key={i.id} className="card flex gap-3 p-4">
                    <Cover src={mediaUrl(i.cover_key)} title={i.title} className="w-20 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs text-muted">{i.publication_title}</div>
                      <div className="font-bold">
                        شمارهٔ {toFaDigits(i.number)} — {i.title}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1 text-xs">
                        <Badge>{toFaDigits(i.page_count || 0)} صفحه</Badge>
                        <Badge tone={i.pricing === 'free' ? 'ok' : 'brand'}>{i.pricing === 'free' ? 'رایگان' : formatToman(i.price_digital)}</Badge>
                      </div>
                      <div className="mt-2 text-xs text-muted">
                        درخواست: {i.requested_by_name || '—'} · {relativeFa(i.requested_at)}
                      </div>
                      {i.request_note && <p className="mt-1 rounded-lg bg-surface-2 p-2 text-xs">{i.request_note}</p>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link to={`/admin/issues/${i.id}`} className="btn-ghost !px-3 !py-1.5">
                          <Eye className="size-4" /> بررسی
                        </Link>
                        <Link to={`/read/${i.id}`} className="btn-ghost !px-3 !py-1.5">پیش‌نمایش</Link>
                        {d.can_decide && (
                          <>
                            <Button className="!px-3 !py-1.5" icon={<Check className="size-4" />} onClick={() => setTarget({ issue: i, decision: 'approved' })}>
                              تأیید
                            </Button>
                            <Button variant="danger" className="!px-3 !py-1.5" icon={<Undo2 className="size-4" />} onClick={() => setTarget({ issue: i, decision: 'changes_requested' })}>
                              اصلاح
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Card title="سابقهٔ تصمیم‌ها">
              {!d.history.length ? (
                <Empty title="هنوز تصمیمی ثبت نشده" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted">
                      <tr>
                        <th className="p-2 text-right">شماره</th>
                        <th className="p-2 text-right">تصمیم</th>
                        <th className="hidden p-2 text-right md:table-cell">یادداشت</th>
                        <th className="p-2 text-right">توسط</th>
                        <th className="p-2 text-right">زمان</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.history.map((h: any, idx: number) => (
                        <tr key={idx} className="border-t border-line">
                          <td className="p-2">
                            <Link to={`/admin/issues/${h.issue_id}`} className="hover:text-brand">
                              {h.publication_title} · {toFaDigits(h.number)}
                            </Link>
                          </td>
                          <td className="p-2">
                            <Badge tone={h.decision === 'approved' ? 'ok' : 'warn'}>{h.decision === 'approved' ? 'تأیید' : 'درخواست اصلاح'}</Badge>
                          </td>
                          <td className="hidden max-w-xs truncate p-2 text-muted md:table-cell">{h.note || '—'}</td>
                          <td className="p-2">{h.decided_by_name || '—'}</td>
                          <td className="p-2 text-xs text-muted">{faDate(h.decided_at, true)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </Async>
      {target && <DecideModal target={target} onClose={() => setTarget(null)} onDone={() => (setTarget(null), st.reload())} />}
    </div>
  )
}

function DecideModal({ target, onClose, onDone }: { target: { issue: any; decision: 'approved' | 'changes_requested' }; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction()
  const [note, setNote] = useState('')
  const [publishAt, setPublishAt] = useState('')
  const approve = target.decision === 'approved'
  const submit = async () => {
    const r = await run(
      () => api.post(`/api/admin/approvals/${target.issue.id}`, { decision: target.decision, note: note.trim() || undefined, publish_at: publishAt ? new Date(publishAt).toISOString() : undefined }),
      approve ? 'شماره تأیید شد' : 'درخواست اصلاح ارسال شد'
    )
    if (r) onDone()
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={approve ? 'تأیید و انتشار' : 'درخواست اصلاح'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>انصراف</Button>
          <Button variant={approve ? 'primary' : 'danger'} loading={busy} disabled={!approve && !note.trim()} onClick={submit}>
            {approve ? 'تأیید نهایی' : 'ارسال درخواست اصلاح'}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm">
        {target.issue.publication_title} — شمارهٔ {toFaDigits(target.issue.number)} «{target.issue.title}»
      </p>
      <div className="space-y-3">
        <Field label={approve ? 'یادداشت (اختیاری)' : 'توضیح اصلاحات لازم'} hint={approve ? undefined : 'این متن برای تیم نشریه ارسال می‌شود.'}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
        {approve && (
          <Field label="زمان انتشار (اختیاری)" hint="خالی بگذارید تا بلافاصله منتشر شود.">
            <Input type="datetime-local" dir="ltr" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  )
}

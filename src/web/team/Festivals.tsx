// Publications festival — team side (ROADMAP phase 14): open calls, submit published issues, see own results.
import { useState } from 'react'
import { Award, Send, Trash2, Trophy } from 'lucide-react'
import { api } from '../lib/api'
import { faDate, toFaDigits } from '../lib/format'
import { Async, Badge, Button, Card, Empty, Input, Modal, PageHeader, Select, useAction, useAsync, useToast } from '../components/ui'
import { useTeam } from './Layout'

const STATUS: Record<string, { label: string; tone: 'muted' | 'brand' | 'warn' | 'ok' }> = {
  open: { label: 'فراخوان باز', tone: 'brand' },
  judging: { label: 'در حال داوری', tone: 'warn' },
  announced: { label: 'نتایج اعلام شد', tone: 'ok' }
}

export default function TeamFestivals() {
  const { pubId } = useTeam()
  const st = useAsync(() => api.get<any>(`/api/festivals/team/${pubId}`), [pubId])
  const [submitFor, setSubmitFor] = useState<any>(null)
  const { run } = useAction()
  const { confirm } = useToast()
  const withdraw = async (f: any, e: any) => {
    if (!(await confirm(`ارسال «${e.issue_title}» به «${f.title}» پس گرفته شود؟`, { danger: true, okLabel: 'پس‌گرفتن' }))) return
    if (await run(() => api.del(`/api/festivals/${f.id}/entries/${e.id}`), 'پس گرفته شد')) st.reload()
  }
  return (
    <div className="space-y-4">
      <PageHeader title="جشنوارهٔ نشریات" subtitle="فراخوان‌های جشنواره، ارسال شماره‌های منتشرشده و نتایج داوری" />
      <Async state={st}>
        {(d) =>
          d.festivals.length ? (
            <div className="space-y-3">
              {d.festivals.map((f: any) => {
                const mine = d.entries.filter((e: any) => e.festival_id === f.id)
                const res = d.results?.[f.id] || []
                const totalMax = f.criteria.reduce((s: number, c: any) => s + c.max, 0)
                return (
                  <Card
                    key={f.id}
                    title={<span className="inline-flex items-center gap-1"><Award className="size-4" /> {f.title}</span>}
                    action={<Badge tone={STATUS[f.status]?.tone}>{STATUS[f.status]?.label}</Badge>}
                  >
                    {f.description && <p className="mb-2 whitespace-pre-line text-sm text-muted">{f.description}</p>}
                    <div className="mb-2 flex flex-wrap gap-2 text-xs text-muted">
                      {f.submit_until && <span>مهلت ارسال: {faDate(f.submit_until)}</span>}
                      <span>معیارها: {f.criteria.map((c: any) => `${c.label} (${toFaDigits(c.max)})`).join('، ')}</span>
                    </div>
                    {mine.length ? (
                      <ul className="space-y-1 text-sm">
                        {mine.map((e: any) => {
                          const r = res.find((x: any) => x.entry_id === e.id)
                          return (
                            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-2 py-1">
                              <span>شمارهٔ {toFaDigits(e.issue_number)} · {e.issue_title}</span>
                              <span className="flex items-center gap-2">
                                {r?.rank && (
                                  <Badge tone="ok"><Trophy className="inline size-3.5" /> رتبهٔ {toFaDigits(r.rank)} · {toFaDigits(r.avg_total)} از {toFaDigits(totalMax)}</Badge>
                                )}
                                {f.accepting && (
                                  <button className="rounded p-1 text-danger hover:bg-surface" aria-label="پس‌گرفتن اثر" onClick={() => withdraw(f, e)}>
                                    <Trash2 className="size-4" />
                                  </button>
                                )}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted">از این نشریه اثری ارسال نشده است.</p>
                    )}
                    {f.accepting && mine.length < 3 && (
                      <Button className="mt-3" icon={<Send className="size-4" />} onClick={() => setSubmitFor(f)} disabled={!d.issues.length}>
                        ارسال اثر
                      </Button>
                    )}
                  </Card>
                )
              })}
            </div>
          ) : (
            <Empty icon={<Award className="size-10 opacity-60" />} title="فعلاً جشنواره‌ای در جریان نیست" hint="وقتی فراخوان جشنواره منتشر شود، اینجا و در اعلان‌ها خبردار می‌شوید." />
          )
        }
      </Async>
      {submitFor && st.data && (
        <SubmitEntry
          pubId={pubId}
          festival={submitFor}
          issues={st.data.issues.filter((i: any) => !st.data.entries.some((e: any) => e.festival_id === submitFor.id && e.issue_id === i.id))}
          onClose={() => setSubmitFor(null)}
          onDone={() => (setSubmitFor(null), st.reload())}
        />
      )}
    </div>
  )
}

function SubmitEntry({ pubId, festival, issues, onClose, onDone }: { pubId: string; festival: any; issues: any[]; onClose: () => void; onDone: () => void }) {
  const [issueId, setIssueId] = useState(issues[0]?.id || '')
  const [note, setNote] = useState('')
  const { run, busy } = useAction()
  const save = async () => {
    if (await run(() => api.post(`/api/festivals/${festival.id}/entries`, { publication_id: pubId, issue_id: issueId, note: note.trim() }), 'اثر ارسال شد')) onDone()
  }
  return (
    <Modal open onClose={onClose} title={`ارسال اثر به «${festival.title}»`} footer={<Button loading={busy} disabled={!issueId} onClick={save}>ارسال</Button>}>
      <div className="space-y-3">
        <Select value={issueId} onChange={(e) => setIssueId(e.target.value)} aria-label="شمارهٔ منتشرشده" options={issues.map((i) => ({ value: i.id, label: `شمارهٔ ${toFaDigits(i.number)} · ${i.title}` }))} />
        <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="توضیح کوتاه برای داوران (اختیاری)" />
        <p className="text-xs text-muted">هر نشریه حداکثر ۳ اثر می‌تواند ارسال کند. تا پایان مهلت ارسال، امکان پس‌گرفتن اثر وجود دارد.</p>
      </div>
    </Modal>
  )
}

// Festival judging desk (ROADMAP phase 14): every assigned judge scores each entry against the festival criteria.
import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Gavel, CheckCircle2 } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { toFaDigits } from '../lib/format'
import { Async, Badge, Button, Card, Empty, Input, Textarea, useAction, useAsync } from '../components/ui'

export default function Judging() {
  const { user, loading } = useAuth()
  const st = useAsync(() => (user ? api.get<{ festivals: any[] }>('/api/festivals/judging/mine') : Promise.resolve({ festivals: [] })), [user?.id])
  if (!loading && !user) return <Navigate to="/login?next=/judging" replace />
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-extrabold">میز داوری جشنواره</h1>
      <Async state={st}>
        {(d) =>
          d.festivals.length ? (
            d.festivals.map((f) => {
              const done = f.entries.filter((e: any) => e.total != null).length
              return (
                <section key={f.id} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-lg font-bold">{f.title}</h2>
                    <Badge tone={done === f.entries.length ? 'ok' : 'warn'}>{toFaDigits(done)} از {toFaDigits(f.entries.length)} اثر داوری شده</Badge>
                  </div>
                  {f.status !== 'judging' && <p className="text-sm text-muted">نتایج این جشنواره اعلام شده و امتیازها قفل است.</p>}
                  {f.entries.length ? (
                    f.entries.map((e: any) => <ScoreCard key={e.id} festival={f} entry={e} onSaved={st.reload} />)
                  ) : (
                    <p className="text-sm text-muted">اثری برای داوری ارسال نشده است.</p>
                  )}
                </section>
              )
            })
          ) : (
            <Empty icon={<Gavel className="size-10 opacity-60" />} title="داوری فعالی برای شما ثبت نشده" hint="وقتی به‌عنوان داور جشنواره تعیین شوید، آثار اینجا نمایش داده می‌شوند." />
          )
        }
      </Async>
    </div>
  )
}

function ScoreCard({ festival, entry, onSaved }: { festival: any; entry: any; onSaved: () => void }) {
  const locked = festival.status !== 'judging'
  const [scores, setScores] = useState<Record<string, string>>(() =>
    Object.fromEntries(festival.criteria.map((c: any) => [c.key, entry.scores?.[c.key] != null ? String(entry.scores[c.key]) : '']))
  )
  const [comment, setComment] = useState(entry.comment || '')
  const { run, busy } = useAction()
  const totalMax = festival.criteria.reduce((s: number, c: any) => s + c.max, 0)
  const sum = festival.criteria.reduce((s: number, c: any) => s + (Number(scores[c.key]) || 0), 0)
  const complete = festival.criteria.every((c: any) => scores[c.key] !== '' && Number(scores[c.key]) >= 0 && Number(scores[c.key]) <= c.max)
  const save = async () => {
    const payload = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, Number(v)]))
    if (await run(() => api.put(`/api/festivals/${festival.id}/entries/${entry.id}/score`, { scores: payload, comment: comment.trim() }), 'امتیاز ثبت شد')) onSaved()
  }
  return (
    <Card
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          {entry.total != null && <CheckCircle2 className="size-4 text-emerald-600" aria-label="داوری شده" />}
          {entry.publication_title} · شمارهٔ {toFaDigits(entry.issue_number)}
        </span>
      }
      action={<Link className="text-sm text-brand hover:underline" to={`/issue/${entry.issue_id}`} target="_blank">مشاهدهٔ شماره</Link>}
    >
      <p className="mb-2 text-sm">{entry.issue_title}</p>
      {entry.note && <p className="mb-3 rounded-lg bg-surface-2 p-2 text-sm text-muted">یادداشت تیم: {entry.note}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {festival.criteria.map((c: any) => (
          <label key={c.key} className="flex items-center justify-between gap-2 text-sm">
            <span>{c.label} <span className="text-muted">(۰ تا {toFaDigits(c.max)})</span></span>
            <Input
              className="w-24"
              type="number"
              inputMode="decimal"
              step="0.5"
              min={0}
              max={c.max}
              disabled={locked}
              value={scores[c.key]}
              aria-label={c.label}
              onChange={(e) => setScores({ ...scores, [c.key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <Textarea className="mt-3" rows={2} maxLength={1000} disabled={locked} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="نظر داور (اختیاری، فقط برای دبیرخانه)" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold">جمع: {toFaDigits(Math.round(sum * 10) / 10)} از {toFaDigits(totalMax)}</span>
        {!locked && <Button loading={busy} disabled={!complete} onClick={save}>{entry.total != null ? 'به‌روزرسانی امتیاز' : 'ثبت امتیاز'}</Button>}
      </div>
    </Card>
  )
}

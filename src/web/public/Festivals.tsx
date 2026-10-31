// Public festival results (ROADMAP phase 14): ranked results of announced festivals.
import { Link } from 'react-router-dom'
import { Award, Medal } from 'lucide-react'
import { api } from '../lib/api'
import { faDate, toFaDigits } from '../lib/format'
import { Async, Empty, useAsync } from '../components/ui'

const MEDAL = ['text-amber-500', 'text-slate-400', 'text-orange-700']

export default function Festivals() {
  const st = useAsync(() => api.get<{ festivals: any[] }>('/api/festivals/public/results'), [])
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-extrabold">جشنوارهٔ نشریات</h1>
      <Async state={st}>
        {(d) =>
          d.festivals.length ? (
            d.festivals.map((f) => (
              <section key={f.id} className="card p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-lg font-bold">{f.title}</h2>
                  {f.announced_at && <span className="text-xs text-muted">اعلام نتایج: {faDate(f.announced_at)}</span>}
                </div>
                {f.description && <p className="mt-1 text-sm text-muted">{f.description}</p>}
                {f.results.length ? (
                  <ol className="mt-3 space-y-2">
                    {f.results.map((r: any, i: number) => (
                      <li key={i} className="flex items-center gap-3 rounded-xl bg-surface-2 p-2">
                        <span className="flex w-10 shrink-0 items-center justify-center font-extrabold">
                          {r.rank <= 3 ? <Medal className={`size-6 ${MEDAL[r.rank - 1]}`} aria-label={`رتبهٔ ${r.rank}`} /> : toFaDigits(r.rank)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <Link className="font-medium hover:underline" to={`/p/${r.publication_slug}`}>{r.publication_title}</Link>
                          <span className="block truncate text-xs text-muted">شمارهٔ {toFaDigits(r.issue_number)} · {r.issue_title}</span>
                        </span>
                        <span className="shrink-0 text-sm text-muted">{toFaDigits(r.avg_total)}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-2 text-sm text-muted">اثری رتبه‌بندی نشده است.</p>
                )}
              </section>
            ))
          ) : (
            <Empty icon={<Award className="size-10 opacity-60" />} title="هنوز نتیجهٔ جشنواره‌ای اعلام نشده" />
          )
        }
      </Async>
    </div>
  )
}

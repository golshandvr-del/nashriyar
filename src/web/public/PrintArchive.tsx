// /archive — digitised archive of old printed issues (ROADMAP phase 19).
// Filters (publication, original Jalali year range, full text incl. the scanned pages' text layer) live in the URL.
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Archive, Search as SearchIcon } from 'lucide-react'
import { api, qs } from '../lib/api'
import { faDate, toFaDigits } from '../lib/format'
import { Empty, ErrorBox, Select, Spinner } from '../components/ui'
import { Cover } from '../components/cards'
import type { IssueLite } from '../components/cards'

type ArchIssue = IssueLite & { original_date: string | null; original_label: string | null }
interface Result {
  issues: ArchIssue[]
  publications: { slug: string; title: string; n: number }[]
  span: { from: string | null; to: string | null }
}

function toEn(s: string) {
  const v = s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\D/g, '')
  return /^1[34]\d\d$/.test(v) ? v : ''
}

export default function PrintArchive() {
  const [sp, setSp] = useSearchParams()
  const q = sp.get('q') || ''
  const publication = sp.get('publication') || ''
  const from = sp.get('from') || ''
  const to = sp.get('to') || ''
  const setParam = (k: string, v: string) => {
    const next: Record<string, string> = {}
    sp.forEach((val, key) => (next[key] = val))
    if (v) next[k] = v
    else delete next[k]
    setSp(next, { replace: true })
  }
  const [text, setText] = useState(q)
  const [fromText, setFromText] = useState(from ? toFaDigits(from) : '')
  const [toText, setToText] = useState(to ? toFaDigits(to) : '')
  const [res, setRes] = useState<Result | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'آرشیو شماره‌های چاپی | نشریار'
  }, [])

  // debounce typing -> URL
  useEffect(() => {
    const t = setTimeout(() => {
      if (text !== q) setParam('q', text)
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    api
      .get<Result>(`/api/public/print-archive${qs({ q: q.trim().length >= 2 ? q : '', publication, from, to })}`)
      .then((r) => alive && setRes(r))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [q, publication, from, to])

  // group by original (Jalali) year label for a timeline feel
  const groups: { year: string; items: ArchIssue[] }[] = []
  for (const i of res?.issues || []) {
    const y = i.original_date ? faDate(i.original_date).split(/[/\s]/).find((p) => /^[۰-۹]{4}$/.test(p)) || '—' : '—'
    const g = groups[groups.length - 1]
    if (g && g.year === y) g.items.push(i)
    else groups.push({ year: y, items: [i] })
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-black">
          <Archive className="size-6 text-brand" /> آرشیو شماره‌های چاپی
        </h1>
        <p className="text-sm text-muted">
          شماره‌های قدیمی که پیش از سامانه چاپ شده‌اند و اکنون دیجیتال شده‌اند. جست‌وجو در متن صفحه‌های اسکن‌شده هم انجام می‌شود.
          {res?.span.from && res.span.to && (
            <>
              {' '}
              بازهٔ آرشیو: {faDate(res.span.from)} تا {faDate(res.span.to)}.
            </>
          )}
        </p>
      </header>

      <section id="archive-filters" className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted" />
          <input type="search" className="input h-11 ps-10" placeholder="عنوان، مطلب یا متن داخل صفحات…" value={text} onChange={(e) => setText(e.target.value)} aria-label="جست‌وجو در آرشیو" />
        </div>
        {res && res.publications.length > 0 && (
          <Select
            className="h-11 w-auto"
            aria-label="نشریه"
            value={publication}
            onChange={(e) => setParam('publication', e.target.value)}
            placeholder="همهٔ نشریه‌ها"
            options={res.publications.map((p) => ({ value: p.slug, label: `${p.title} (${toFaDigits(p.n)})` }))}
          />
        )}
        <input className="input h-11 w-24 text-center" inputMode="numeric" placeholder="از سال" aria-label="از سال" value={fromText} onChange={(e) => setFromText(e.target.value)} onBlur={() => setParam('from', toEn(fromText))} />
        <input className="input h-11 w-24 text-center" inputMode="numeric" placeholder="تا سال" aria-label="تا سال" value={toText} onChange={(e) => setToText(e.target.value)} onBlur={() => setParam('to', toEn(toText))} />
      </section>

      {loading && (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      )}
      {error && <ErrorBox error={error} />}
      {res && !loading && !res.issues.length && <Empty icon={<Archive className="size-10 opacity-60" />} title="شماره‌ای در آرشیو با این فیلترها یافت نشد" />}

      {!loading &&
        groups.map((g) => (
          <section key={g.year} className="space-y-3">
            <h2 className="sticky top-14 z-10 bg-bg/90 py-1 text-lg font-black backdrop-blur">{g.year}</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {g.items.map((i) => (
                <Link key={i.id} to={`/issue/${i.id}`} className="group block" aria-label={`${i.publication_title || ''} شمارهٔ ${i.number}`}>
                  <Cover src={i.cover_key} title={i.title} color={i.theme_color} className="transition-transform group-hover:-translate-y-0.5" />
                  <div className="mt-2 space-y-0.5">
                    <div className="truncate text-xs text-muted">{i.publication_title}</div>
                    <div className="line-clamp-2 text-sm font-bold leading-6">{i.title}</div>
                    <div className="text-xs text-muted">
                      شمارهٔ {toFaDigits(i.number)} · {i.original_label || faDate(i.original_date)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
    </div>
  )
}

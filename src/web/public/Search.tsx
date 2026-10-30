import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search as SearchIcon } from 'lucide-react'
import { api, qs } from '../lib/api'
import { toFaDigits, cx } from '../lib/format'
import { Empty, ErrorBox, Select, Spinner } from '../components/ui'
import { IssueGrid, PubCard } from '../components/cards'
import type { IssueLite, PubLite } from '../components/cards'

interface Result {
  q: string
  publications: PubLite[]
  issues: IssueLite[]
  people: { full_name: string; issue_count: number }[]
}

export default function Search() {
  const [sp, setSp] = useSearchParams()
  const q = sp.get('q') || ''
  const pricing = sp.get('pricing') || ''
  const sort = sp.get('sort') || ''
  const faculty = sp.get('faculty') || ''
  const category = sp.get('category') || ''
  const [facets, setFacets] = useState<{ categories: { id: string; name: string; parent_id: string | null }[]; faculties: { id: string; name: string }[] } | null>(null)
  useEffect(() => {
    api.get<any>('/api/public/categories').then(setFacets).catch(() => {})
  }, [])
  /** Keeps every filter in the URL so results are shareable; empty values are dropped. */
  const setParam = (k: string, v: string) => {
    const next: Record<string, string> = {}
    sp.forEach((val, key) => (next[key] = val))
    if (v) next[k] = v
    else delete next[k]
    setSp(next, { replace: true })
  }
  const [text, setText] = useState(q)
  const [res, setRes] = useState<Result | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // debounce typing -> URL
  useEffect(() => {
    const t = setTimeout(() => {
      if (text !== q) setParam('q', text)
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  useEffect(() => {
    if (q.trim().length < 2) return setRes(null)
    let alive = true
    setLoading(true)
    setError(null)
    api
      .get<Result>(`/api/public/search${qs({ q, pricing, sort, faculty, category })}`)
      .then((r) => alive && setRes(r))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [q, pricing, sort, faculty, category])

  const setPricing = (p: string) => setParam('pricing', p)
  const empty = res && !res.publications.length && !res.issues.length && !res.people.length

  return (
    <div className="space-y-5">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted" />
        <input
          autoFocus
          type="search"
          className="input h-12 ps-10 text-base"
          placeholder="نام نشریه، عنوان مطلب، نویسنده یا متن داخل صفحات…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="جست‌وجو"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {[
          ['', 'همه'],
          ['free', 'رایگان'],
          ['paid', 'پولی']
        ].map(([k, l]) => (
          <button key={k} onClick={() => setPricing(k)} className={cx('chip', pricing === k && 'border-brand bg-brand-soft font-bold text-brand')}>
            {l}
          </button>
        ))}
        <Select
          className="h-9 w-auto py-1 text-sm"
          aria-label="مرتب‌سازی"
          value={sort}
          onChange={(e) => setParam('sort', e.target.value)}
          options={[
            { value: '', label: 'تازه‌ترین' },
            { value: 'popular', label: 'پربازدیدترین' },
            { value: 'oldest', label: 'قدیمی‌ترین' },
            { value: 'title', label: 'عنوان (الفبایی)' }
          ]}
        />
        {facets && (
          <>
            <Select className="h-9 w-auto py-1 text-sm" aria-label="دانشکده" value={faculty} onChange={(e) => setParam('faculty', e.target.value)} placeholder="همهٔ دانشکده‌ها" options={facets.faculties.map((f) => ({ value: f.id, label: f.name }))} />
            <Select className="h-9 w-auto py-1 text-sm" aria-label="دسته" value={category} onChange={(e) => setParam('category', e.target.value)} placeholder="همهٔ دسته‌ها" options={facets.categories.map((c) => ({ value: c.id, label: c.parent_id ? `— ${c.name}` : c.name }))} />
          </>
        )}
      </div>

      {loading && (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      )}
      {error && <ErrorBox error={error} />}
      {!res && !loading && <Empty icon={<SearchIcon className="size-10 opacity-60" />} title="جست‌وجو در همهٔ نشریات" hint="حداقل دو حرف وارد کنید. جست‌وجو به حروف عربی/فارسی و نیم‌فاصله حساس نیست." />}
      {empty && <Empty title={`نتیجه‌ای برای «${res!.q}» یافت نشد`} />}

      {res && res.publications.length > 0 && (
        <section>
          <h2 className="mb-2 font-bold">نشریه‌ها</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {res.publications.map((p) => (
              <PubCard key={p.id} pub={p} />
            ))}
          </div>
        </section>
      )}
      {res && res.people.length > 0 && (
        <section>
          <h2 className="mb-2 font-bold">افراد</h2>
          <div className="flex flex-wrap gap-2">
            {res.people.map((p) => (
              <button key={p.full_name} className="chip" onClick={() => setText(p.full_name)}>
                {p.full_name} <span className="text-muted">({toFaDigits(p.issue_count)} شماره)</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {res && res.issues.length > 0 && (
        <section>
          <h2 className="mb-2 font-bold">شماره‌ها</h2>
          <IssueGrid issues={res.issues} />
        </section>
      )}
    </div>
  )
}

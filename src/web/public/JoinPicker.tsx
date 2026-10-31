// Quick publication picker for «درخواست عضویت در تیم نشریه» (ROADMAP phase 15): search + filters by faculty,
// association and subject, then a requested role from the production roles defined by the officer.
import { useEffect, useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { api } from '../lib/api'
import { cx } from '../lib/format'
import { normalizeFa } from '../../shared/fa'
import { Field, Input, Select, Spinner, Textarea } from '../components/ui'

export type JoinValue = { publication_id: string; role_name: string; message: string }
export const EMPTY_JOIN: JoinValue = { publication_id: '', role_name: '', message: '' }

type Opt = {
  publications: { id: string; title: string; tagline?: string; theme_color?: string; faculty_id?: string; faculty_name?: string; association_id: string; association_name: string }[]
  roles: { id: string; name: string }[]
  faculties: { id: string; name: string }[]
  associations: { id: string; name: string; faculty_id?: string }[]
  categories: { id: string; name: string }[]
}

export default function JoinPicker({ value, onChange, exclude = [] }: { value: JoinValue; onChange: (v: JoinValue) => void; exclude?: string[] }) {
  const [opt, setOpt] = useState<Opt | null>(null)
  const [q, setQ] = useState('')
  const [faculty, setFaculty] = useState('')
  const [association, setAssociation] = useState('')
  const [category, setCategory] = useState('')
  const [catIds, setCatIds] = useState<string[] | null>(null)

  useEffect(() => {
    api.get<Opt>('/api/membership/options').then(setOpt).catch(() => setOpt({ publications: [], roles: [], faculties: [], associations: [], categories: [] }))
  }, [])
  // subject filter is resolved on the server (publication_categories); the rest filters locally
  useEffect(() => {
    if (!category) return setCatIds(null)
    api.get<Opt>(`/api/membership/options?category=${encodeURIComponent(category)}`).then((r) => setCatIds(r.publications.map((p) => p.id))).catch(() => setCatIds([]))
  }, [category])

  const list = useMemo(() => {
    if (!opt) return []
    const nq = normalizeFa(q).trim()
    return opt.publications.filter(
      (p) =>
        !exclude.includes(p.id) &&
        (!faculty || p.faculty_id === faculty) &&
        (!association || p.association_id === association) &&
        (!catIds || catIds.includes(p.id)) &&
        (!nq || normalizeFa(`${p.title} ${p.association_name} ${p.tagline || ''}`).includes(nq))
    )
  }, [opt, q, faculty, association, catIds, exclude])

  if (!opt) return <div className="flex justify-center p-4"><Spinner /></div>
  const assocs = opt.associations.filter((a) => !faculty || a.faculty_id === faculty)
  const chosen = opt.publications.find((p) => p.id === value.publication_id)

  return (
    <div className="space-y-3" id="join-picker">
      <div className="relative">
        <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted" />
        <Input aria-label="جست‌وجوی نشریه" placeholder="جست‌وجوی نام نشریه یا انجمن…" className="ps-9" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select aria-label="دانشکده" value={faculty} onChange={(e) => (setFaculty(e.target.value), setAssociation(''))} placeholder="همهٔ دانشکده‌ها" options={opt.faculties.map((f) => ({ value: f.id, label: f.name }))} />
        <Select aria-label="انجمن" value={association} onChange={(e) => setAssociation(e.target.value)} placeholder="همهٔ انجمن‌ها" options={assocs.map((a) => ({ value: a.id, label: a.name }))} />
        <Select aria-label="موضوع" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="همهٔ موضوع‌ها" options={opt.categories.map((c) => ({ value: c.id, label: c.name }))} />
      </div>
      <ul className="max-h-60 divide-y divide-line overflow-y-auto rounded-xl border border-line" role="listbox" aria-label="نشریه‌ها">
        {list.length === 0 && <li className="p-3 text-center text-sm text-muted">نشریه‌ای با این مشخصات پیدا نشد</li>}
        {list.map((p) => {
          const on = p.id === value.publication_id
          return (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => onChange({ ...value, publication_id: p.id })}
                className={cx('flex w-full items-center gap-2 p-2 text-start text-sm hover:bg-surface-2', on && 'bg-brand-soft')}
              >
                <span className="size-3 shrink-0 rounded-full" style={{ background: p.theme_color || 'var(--brand)' }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{p.title}</span>
                  <span className="block truncate text-xs text-muted">
                    {p.association_name}
                    {p.faculty_name ? ` · ${p.faculty_name}` : ''}
                  </span>
                </span>
                {on && <Check className="size-4 shrink-0 text-brand" />}
              </button>
            </li>
          )
        })}
      </ul>
      {chosen && <p className="text-xs text-muted">نشریهٔ انتخاب‌شده: <b className="text-fg">{chosen.title}</b></p>}
      <Field label="سمت درخواستی">
        <Select
          name="role_name"
          value={value.role_name}
          onChange={(e) => onChange({ ...value, role_name: e.target.value })}
          placeholder={opt.roles.length ? 'انتخاب کنید (اختیاری)' : 'نقشی تعریف نشده'}
          options={opt.roles.map((r) => ({ value: r.name, label: r.name }))}
        />
      </Field>
      <Field label="پیام برای مدیرمسئول (اختیاری)">
        <Textarea rows={2} maxLength={500} value={value.message} onChange={(e) => onChange({ ...value, message: e.target.value })} placeholder="سابقه یا علاقه‌مندی خود را کوتاه بنویسید" />
      </Field>
    </div>
  )
}

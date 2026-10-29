import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, qs } from '../lib/api'
import { normalizeFa } from '../lib/format'
import { Async, Card, Empty, Input, Select, useAsync } from '../components/ui'
import { PubCard } from '../components/cards'
import type { PubLite } from '../components/cards'

interface CatData {
  categories: { id: string; parent_id: string | null; type: string; name: string; slug: string; icon?: string; color?: string }[]
  faculties: { id: string; name: string }[]
  associations: { id: string; name: string; kind: string; faculty_id: string | null }[]
}

export default function Categories() {
  const cats = useAsync(() => api.get<CatData>('/api/public/categories'), [])
  const [faculty, setFaculty] = useState('')
  const [q, setQ] = useState('')
  const pubs = useAsync(() => api.get<{ publications: PubLite[] }>(`/api/public/publications${qs({ faculty })}`), [faculty])

  return (
    <Async state={cats}>
      {(d) => {
        const roots = d.categories.filter((c) => !c.parent_id)
        const types = Array.from(new Set(roots.map((c) => c.type)))
        const TYPE_LABEL: Record<string, string> = { subject: 'موضوعی', format: 'قالب', audience: 'مخاطب' }
        const nq = normalizeFa(q)
        const list = (pubs.data?.publications || []).filter((p) => !nq || normalizeFa(`${p.title} ${p.tagline || ''} ${p.association_name || ''}`).includes(nq))
        return (
          <div className="space-y-6">
            <h1 className="text-xl font-extrabold">دسته‌ها و نشریه‌ها</h1>
            {types.map((t) => (
              <section key={t}>
                <h2 className="mb-2 text-sm font-bold text-muted">{TYPE_LABEL[t] || t}</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {roots
                    .filter((c) => c.type === t)
                    .map((c) => (
                      <Link key={c.id} to={`/c/${c.slug}`} className="card flex items-center gap-2 p-3 hover:bg-surface-2">
                        <span className="size-3 rounded-full" style={{ background: c.color || 'var(--brand)' }} />
                        <span className="font-medium">{c.name}</span>
                      </Link>
                    ))}
                </div>
              </section>
            ))}

            <Card title="دانشکده‌ها">
              <div className="flex flex-wrap gap-2">
                {d.faculties.map((f) => (
                  <Link key={f.id} to={`/faculty/${f.id}`} className="chip hover:border-brand">
                    {f.name}
                  </Link>
                ))}
              </div>
            </Card>

            <section>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="me-auto font-bold">همهٔ نشریه‌ها</h2>
                <Input className="w-48" placeholder="فیلتر نام…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="فیلتر نام نشریه" />
                <Select className="w-48" value={faculty} onChange={(e) => setFaculty(e.target.value)} placeholder="همهٔ دانشکده‌ها" options={d.faculties.map((f) => ({ value: f.id, label: f.name }))} aria-label="دانشکده" />
              </div>
              {pubs.loading && !pubs.data ? null : list.length ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((p) => (
                    <PubCard key={p.id} pub={p} />
                  ))}
                </div>
              ) : (
                <Empty title="نشریه‌ای یافت نشد" />
              )}
            </section>
          </div>
        )
      }}
    </Async>
  )
}

import { useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { Async, Empty, useAsync } from '../components/ui'
import { IssueGrid, PubCard } from '../components/cards'
import type { IssueLite, PubLite } from '../components/cards'

interface Data {
  title: string
  color?: string | null
  subtitle?: string | null
  issues: IssueLite[]
  publications: PubLite[]
}

/** Shared listing for a category (/c/:slug), a faculty (/faculty/:id) or an association/club (/association/:id). */
export default function Category({ kind = 'category' }: { kind?: 'category' | 'faculty' | 'association' }) {
  const { slug, id } = useParams()
  const st = useAsync<Data>(async () => {
    if (kind === 'association') {
      const r = await api.get(`/api/public/associations/${id}`)
      const a = r.association
      const sub = [a.kind === 'club' ? 'کانون فرهنگی' : 'انجمن علمی', a.faculty_name ? `دانشکدهٔ ${a.faculty_name}` : null].filter(Boolean).join(' · ')
      return { title: a.name, subtitle: sub, issues: r.issues, publications: r.publications }
    }
    if (kind === 'faculty') {
      const r = await api.get(`/api/public/faculties/${id}`)
      return { title: r.faculty.name, issues: r.issues, publications: r.publications }
    }
    const r = await api.get(`/api/public/categories/${slug}`)
    return { title: r.category.name, color: r.category.color, issues: r.issues, publications: r.publications }
  }, [kind, slug, id])

  return (
    <Async state={st}>
      {(d) => (
        <div className="space-y-6">
          <header className="flex items-center gap-3">
            <span className="size-4 rounded-full" style={{ background: d.color || 'var(--brand)' }} />
            <h1 className="text-xl font-extrabold">{kind === 'faculty' ? `دانشکدهٔ ${d.title}` : d.title}</h1>
            {d.subtitle && <span className="text-sm text-muted">{d.subtitle}</span>}
          </header>
          {d.publications.length > 0 && (
            <section>
              <h2 className="mb-2 font-bold">نشریه‌ها</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {d.publications.map((p) => (
                  <PubCard key={p.id} pub={p} />
                ))}
              </div>
            </section>
          )}
          <section>
            <h2 className="mb-2 font-bold">شماره‌ها</h2>
            {d.issues.length ? <IssueGrid issues={d.issues} /> : <Empty title="شماره‌ای در این بخش منتشر نشده است" />}
          </section>
        </div>
      )}
    </Async>
  )
}

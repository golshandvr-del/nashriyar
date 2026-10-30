import { Link } from 'react-router-dom'
import { Megaphone } from 'lucide-react'
import { api } from '../lib/api'
import { faDate } from '../lib/format'
import { Async, Badge, Empty, useAsync } from '../components/ui'

interface Call {
  id: string
  title: string
  roles_needed: string | null
  body: string | null
  contact: string | null
  open_until: string | null
  publication_slug: string
  publication_title: string
}

/** Open recruitment calls ("we're hiring") across all active publications. */
export default function Recruitment() {
  const st = useAsync(() => api.get<{ calls: Call[] }>('/api/public/recruitment'), [])
  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-4 flex items-center gap-2">
        <Megaphone className="size-6 text-brand" />
        <div>
          <h1 className="text-xl font-extrabold">فراخوان همکاری</h1>
          <p className="text-sm text-muted">نشریه‌هایی که به نویسنده، طراح، ویراستار و … نیاز دارند.</p>
        </div>
      </header>
      <Async state={st}>
        {(d) =>
          d.calls.length ? (
            <ul className="space-y-3">
              {d.calls.map((c) => (
                <li key={c.id} className="card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-bold">{c.title}</h2>
                    {c.open_until && <Badge tone="warn">مهلت: {faDate(c.open_until)}</Badge>}
                  </div>
                  <Link to={`/p/${c.publication_slug}`} className="text-sm text-brand">
                    {c.publication_title}
                  </Link>
                  {c.roles_needed && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {c.roles_needed
                        .split(/[،,]/)
                        .map((r) => r.trim())
                        .filter(Boolean)
                        .map((r) => (
                          <Badge key={r} tone="brand">
                            {r}
                          </Badge>
                        ))}
                    </div>
                  )}
                  {c.body && <p className="mt-2 whitespace-pre-line text-sm leading-7">{c.body}</p>}
                  {c.contact && <p className="mt-2 text-sm text-muted">راه ارتباط: {c.contact}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="فعلاً فراخوان بازی وجود ندارد" hint="بعداً دوباره سر بزنید یا نشریه‌های مورد علاقه‌تان را دنبال کنید." />
          )
        }
      </Async>
    </div>
  )
}

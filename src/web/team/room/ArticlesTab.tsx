// Issue room → "نمایهٔ مقالات" (ROADMAP phase 19): every section of a published issue has a permanent id (PID,
// assigned by the server and never editable). The team completes abstract, keywords, language and an optional DOI;
// these feed the /a/<pid> landing page (citation_* meta), BibTeX/RIS and the OAI-PMH endpoint.
import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { api } from '../../lib/api'
import { Async, Button, Card, Empty, Field, Input, Select, Textarea, useAsync, useToast } from '../../components/ui'
import { toFaDigits } from '../../lib/format'
import type { RoomProps } from './TocTab'

type A = { pid: string; doi: string | null; abstract: string | null; keywords: string | null; lang: string; toc_item_id: string; title: string; kind: string; page_start: number | null; page_end: number | null }

const LANGS = [
  { value: 'fa', label: 'فارسی' },
  { value: 'en', label: 'انگلیسی' },
  { value: 'ar', label: 'عربی' }
]

function ArticleRow({ a, base, canEdit, onSaved }: { a: A; base: string; canEdit: boolean; onSaved: () => void }) {
  const [f, setF] = useState({ abstract: a.abstract || '', keywords: a.keywords || '', lang: a.lang || 'fa', doi: a.doi || '' })
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()
  const dirty = f.abstract !== (a.abstract || '') || f.keywords !== (a.keywords || '') || f.lang !== (a.lang || 'fa') || f.doi !== (a.doi || '')
  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{a.title}</div>
          <div className="text-xs text-muted">
            <span dir="ltr" className="font-mono">{a.pid}</span>
            {a.page_start ? ` · ص ${toFaDigits(a.page_start)}${a.page_end && a.page_end !== a.page_start ? `–${toFaDigits(a.page_end)}` : ''}` : ''}
          </div>
        </div>
        <a href={`/a/${a.pid}`} target="_blank" rel="noreferrer" className="btn-ghost text-xs">
          <ExternalLink className="size-3.5" /> صفحهٔ استناد
        </a>
      </div>
      {canEdit && (
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            try {
              await api.put(`${base}/articles/${a.pid}`, { abstract: f.abstract, keywords: f.keywords, lang: f.lang, doi: f.doi })
              toast('اطلاعات نمایه ذخیره شد')
              onSaved()
            } catch (err: any) {
              toast(err?.message || 'ذخیره نشد', 'error')
            } finally {
              setBusy(false)
            }
          }}
        >
          <Field label="چکیده">
            <Textarea rows={3} maxLength={5000} value={f.abstract} onChange={(e) => setF({ ...f, abstract: e.target.value })} />
          </Field>
          <div className="space-y-3">
            <Field label="کلیدواژه‌ها" hint="با ویرگول جدا کنید">
              <Input value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} />
            </Field>
            <div className="grid grid-cols-[8rem_1fr] gap-3">
              <Field label="زبان">
                <Select options={LANGS} value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value })} />
              </Field>
              <Field label="DOI (اختیاری)">
                <Input dir="ltr" placeholder="10.1234/abc.2026.1" value={f.doi} onChange={(e) => setF({ ...f, doi: e.target.value })} />
              </Field>
            </div>
          </div>
          <div className="md:col-span-2">
            <Button type="submit" loading={busy} disabled={!dirty}>
              ذخیره
            </Button>
          </div>
        </form>
      )}
    </li>
  )
}

export default function ArticlesTab({ d, pubId }: RoomProps) {
  const base = `/api/team/${pubId}/issues/${d.issue.id}`
  const st = useAsync(() => api.get<{ articles: A[] }>(`${base}/articles`), [base])
  const canEdit = d.can_write !== false
  return (
    <Card title="نمایهٔ مقالات و شناسه‌های پایدار">
      <p className="mb-2 text-sm text-muted">
        هر بخش شمارهٔ منتشرشده یک شناسهٔ پایدار دارد که هرگز تغییر نمی‌کند و برای استناد، نمایه‌سازی در Google Scholar و برداشت OAI-PMH به کار می‌رود. چکیده، کلیدواژه و DOI را اینجا کامل کنید.
      </p>
      <Async state={st}>
        {(r) =>
          r.articles.length === 0 ? (
            <Empty title={d.issue.status === 'published' ? 'هنوز شناسه‌ای ساخته نشده' : 'پس از انتشار شماره، برای هر بخش شناسهٔ پایدار ساخته می‌شود'} />
          ) : (
            <ul className="divide-y divide-line">
              {r.articles.map((a) => (
                <ArticleRow key={a.pid} a={a} base={base} canEdit={canEdit} onSaved={st.reload} />
              ))}
            </ul>
          )
        }
      </Async>
    </Card>
  )
}

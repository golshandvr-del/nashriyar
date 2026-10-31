// Limited member portal (ROADMAP phase 9, optional — feature flag `member_portal`).
// A regular team member signs in with their own student account and sees only the TOC sections
// assigned to them (matched by student number); they can move a section between todo → writing → written.
import { Link, Navigate } from 'react-router-dom'
import { ListChecks } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFeature } from '../lib/features'
import { faDate, toFaDigits } from '../../shared/fa'
import { Async, Badge, Empty, useAction, useAsync } from '../components/ui'

const LABEL: Record<string, string> = { todo: 'شروع‌نشده', writing: 'در حال نوشتن', written: 'نوشته شد' }

export default function MySections() {
  const { user, loading } = useAuth()
  const enabled = useFeature('member_portal')
  const st = useAsync(() => (user && enabled ? api.get<{ items: any[]; statuses: string[] }>('/api/me/sections') : Promise.resolve({ items: [], statuses: [] })), [user?.id, enabled])
  const { busy, run } = useAction()

  if (!loading && !user) return <Navigate to="/login?next=/my-sections" replace />
  if (!enabled) return <Empty icon={<ListChecks className="size-10 opacity-60" />} title="این قابلیت توسط مدیر سامانه فعال نشده است" />

  const setStatus = async (id: string, status: string) => {
    if (await run(() => api.post(`/api/me/sections/${id}/status`, { status }), 'ثبت شد')) st.reload()
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-xl font-extrabold">بخش‌های من</h1>
      <p className="mb-4 text-sm text-muted">بخش‌هایی از شماره‌های در حال تولید که به شما (با شماره دانشجویی‌تان) سپرده شده است.</p>
      <Async state={st}>
        {(d) =>
          d.items.length ? (
            <ul className="space-y-3">
              {d.items.map((t) => (
                <li key={t.id} className="card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold">{t.title}</p>
                      <p className="text-xs text-muted">
                        {t.publication_title} · شمارهٔ {toFaDigits(t.issue_number ?? '—')} «{t.issue_title}»{t.my_role ? ` · نقش: ${t.my_role}` : ''}
                      </p>
                      {t.due_at && <p className="text-xs text-muted">مهلت: {faDate(t.due_at)}</p>}
                    </div>
                    <Badge tone={t.status === 'written' ? 'ok' : t.status === 'writing' ? 'warn' : undefined}>{LABEL[t.status] || 'در مرحلهٔ ویرایش'}</Badge>
                  </div>
                  {t.status in LABEL ? (
                    <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="تغییر وضعیت">
                      {d.statuses.map((s) => (
                        <button
                          key={s}
                          disabled={busy || s === t.status}
                          aria-pressed={s === t.status}
                          className={s === t.status ? 'btn-primary !px-3 !py-1 text-xs' : 'btn-ghost !px-3 !py-1 text-xs'}
                          onClick={() => setStatus(t.id, s)}
                        >
                          {LABEL[s]}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted">این بخش وارد مرحلهٔ ویرایش شده است.</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              icon={<ListChecks className="size-10 opacity-60" />}
              title="بخشی به شما سپرده نشده است"
              description={<>اگر عضو تیم نشریه‌ای هستید، از مدیرمسئول بخواهید شماره دانشجویی شما را در فهرست اعضا ثبت کند. <Link to="/guide" className="underline">راهنما</Link></>}
            />
          )
        }
      </Async>
    </div>
  )
}

// «میز کار عضو» (ROADMAP phase 15 access matrix): regular team members — not the three main accounts — see the sections
// assigned to them, upcoming deadlines and their collaboration certificates. The officer decides what is visible.
import { Link, Navigate } from 'react-router-dom'
import { Award, CalendarClock, LayoutDashboard, ListChecks } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { faDate, toFaDigits } from '../../shared/fa'
import { Async, Badge, Card, Empty, PageHeader, useAction, useAsync } from '../components/ui'

const LABEL: Record<string, string> = { todo: 'شروع‌نشده', writing: 'در حال نوشتن', written: 'نوشته شد' }
const STATUSES = ['todo', 'writing', 'written']

export default function Desk() {
  const { user, loading } = useAuth()
  const st = useAsync(() => (user ? api.get<any>('/api/desk') : Promise.resolve(null)), [user?.id])
  const { busy, run } = useAction()

  if (!loading && !user) return <Navigate to="/login?next=/desk" replace />

  const setStatus = async (id: string, status: string) => {
    if (await run(() => api.post(`/api/me/sections/${id}/status`, { status }), 'ثبت شد')) st.reload()
  }

  return (
    <div id="member-desk" className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="میز کار عضو" subtitle="بخش‌های سپرده‌شده، مهلت‌ها و گواهی‌های همکاری شما" />
      <Async state={st}>
        {(d: any) => {
          if (!d) return null
          if (!d.enabled)
            return (
              <Empty
                icon={<LayoutDashboard className="size-10 opacity-60" />}
                title={d.config?.enabled === false ? 'میز کار عضو توسط مسئول نشریات غیرفعال شده است' : 'حساب شما هنوز به عضویت فعال هیچ تیمی متصل نیست'}
                hint={
                  <>
                    از <Link to="/settings?tab=membership" className="text-brand underline">تنظیمات ← عضویت در تیم نشریه</Link> درخواست عضویت بدهید؛ پس از تأیید مدیرمسئول، این میز برایتان باز می‌شود.
                  </>
                }
              />
            )
          return (
            <>
              <section id="desk-memberships" aria-label="تیم‌های من" className="flex flex-wrap gap-2">
                {d.memberships.map((m: any) => (
                  <span key={m.id} className="rounded-xl border border-line px-3 py-1 text-sm">
                    <Link to={`/p/${m.slug}`} className="font-bold hover:text-brand">{m.title}</Link>
                    {m.default_role ? <span className="text-muted"> · {m.default_role}</span> : null}
                  </span>
                ))}
                {d.panel_publications?.length > 0 && (
                  <Link to="/team" className="btn-ghost !py-1 text-sm">پنل نشریه</Link>
                )}
              </section>

              {d.config.sections && (
                <Card title={<span className="flex items-center gap-2"><ListChecks className="size-4" /> بخش‌های من</span>}>
                  {!d.sections?.length ? (
                    <Empty title="فعلاً بخشی به شما سپرده نشده است" />
                  ) : (
                    <ul className="divide-y divide-line">
                      {d.sections.map((t: any) => (
                        <li key={t.id} className="py-3">
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
                          {d.config.update_sections && t.status in LABEL && (
                            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="تغییر وضعیت">
                              {STATUSES.map((s) => (
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
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                {d.config.deadlines && (
                  <Card title={<span className="flex items-center gap-2"><CalendarClock className="size-4" /> مهلت‌ها</span>}>
                    {!d.deadlines?.length ? (
                      <Empty title="مهلت نزدیکی ندارید" />
                    ) : (
                      <ul id="desk-deadlines" className="divide-y divide-line text-sm">
                        {d.deadlines.map((x: any) => (
                          <li key={`${x.kind}-${x.id}`} className="flex flex-wrap justify-between gap-2 py-2">
                            <span className="min-w-0">
                              <span className="font-medium">{x.title}</span>
                              <span className="block text-xs text-muted">{x.context}</span>
                            </span>
                            <Badge tone={x.kind === 'section' ? 'warn' : 'muted'}>{faDate(x.due_at)}</Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                )}
                {d.config.certificates && (
                  <Card title={<span className="flex items-center gap-2"><Award className="size-4" /> گواهی‌های همکاری</span>}>
                    {!d.certificates?.length ? (
                      <Empty title="هنوز گواهی‌ای صادر نشده است" />
                    ) : (
                      <ul id="desk-certificates" className="divide-y divide-line text-sm">
                        {d.certificates.map((ce: any) => (
                          <li key={ce.verify_code} className="flex flex-wrap justify-between gap-2 py-2">
                            <span className="min-w-0">
                              <span className="font-medium">{ce.publication_title} · شمارهٔ {toFaDigits(ce.issue_number)}</span>
                              <span className="block text-xs text-muted">{ce.roles || '—'} · {faDate(ce.issued_at)}</span>
                            </span>
                            <Link to={`/verify/${ce.verify_code}`} className="text-xs text-brand underline" dir="ltr">{ce.verify_code}</Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                )}
              </div>
            </>
          )
        }}
      </Async>
    </div>
  )
}

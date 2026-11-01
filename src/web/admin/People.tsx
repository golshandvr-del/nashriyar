import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { api, qs } from '../lib/api'
import { ISSUE_STATUS, TOC_STATUS, faDate, toFaDigits } from '../lib/format'
import { Async, Badge, Card, Empty, Input, PageHeader, useAsync } from '../components/ui'
import MembershipRequests from '../team/MembershipRequests'
import { DataTable, fetchAllPages } from '../components/DataTable'
import { DEGREE_LABEL as DEGREE_FA, GENDER_LABEL as GENDER_FA, PEOPLE_COLUMNS } from '../../shared/columns'
import { useAdminRole } from './Layout'

/** Officer view of team membership requests across all publications (ROADMAP phase 15). */
function OfficerRequests() {
  const roles = useAsync(() => api.get<{ roles: { id: string; name: string }[] }>('/api/membership/options'), [])
  return <MembershipRequests roles={roles.data?.roles || []} />
}

/** People across all publications (matched by student number, otherwise exact name). */
export default function AdminPeople() {
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  // ROADMAP phase 18: whole list loaded once; DataTable filters/sorts/groups/exports it
  const st = useAsync(() => fetchAllPages(`/api/admin/people${qs({ q: term })}`, 'people'), [term])
  const { admin } = useAdminRole()
  return (
    <div>
      <PageHeader title="پروندهٔ افراد" subtitle="سابقهٔ همکاری هر دانشجو در همهٔ نشریات (بر اساس شمارهٔ دانشجویی یا نام)" />
      {admin && <OfficerRequests />}
      <form
        className="relative mb-4 max-w-lg"
        onSubmit={(e) => {
          e.preventDefault()
          setTerm(q.trim())
        }}
      >
        <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="نام یا شمارهٔ دانشجویی و Enter" className="pr-9" />
      </form>
      <Async state={st}>
        {(d) => (
          <DataTable
            id="admin-people"
            title="پروندهٔ افراد"
            columns={PEOPLE_COLUMNS}
            rows={d.rows}
            truncated={d.truncated}
            rowKey={(p) => String(p.person_key)}
            exportUrl="/api/admin/people/export"
            extraParams={{ q: term }}
            empty={<Empty title="فردی یافت نشد" />}
            render={{
              full_name: (p: any) => (
                <Link to={`/admin/people/${encodeURIComponent(p.person_key)}`} className="font-medium hover:text-brand">
                  {p.full_name}
                </Link>
              ),
              student_number: (p: any) => <span className="font-mono text-xs" dir="ltr">{p.student_number ? toFaDigits(p.student_number) : '—'}</span>,
              publications: (p: any) => (
                <span className="text-xs">
                  {p.publications}
                  {p.publication_count > 1 && <Badge tone="brand" className="mr-1">{toFaDigits(p.publication_count)} نشریه</Badge>}
                </span>
              )
            }}
          />
        )}
      </Async>
    </div>
  )
}


/** Linked accounts' profiles; sensitive fields arrive from the API only for the officer and only with the person's consent. */
function AccountProfiles({ accounts }: { accounts: any[] }) {
  if (!accounts?.length) return null
  return (
    <Card title="حساب کاربری و پروفایل">
      <ul className="divide-y divide-line text-sm">
        {accounts.map((a) => (
          <li key={a.id} id={`account-${a.id}`} className="space-y-1 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{a.display_name}</span>
              <span className="flex flex-wrap gap-1">
                <Badge tone={a.profile_completed_at ? 'ok' : 'muted'}>{a.profile_completed_at ? 'پروفایل کامل' : 'پروفایل ناقص'}</Badge>
                <Badge tone={a.profile_consent_at ? 'ok' : 'muted'}>{a.profile_consent_at ? 'رضایت ثبت شده' : 'بدون رضایت'}</Badge>
              </span>
            </div>
            <div className="text-xs text-muted">
              {[a.faculty_name, a.major_name, DEGREE_FA[a.degree], a.entry_year ? `ورودی ${toFaDigits(a.entry_year)}` : null].filter(Boolean).join(' · ') || '—'}
            </div>
            {a.bio && <p className="text-xs">{a.bio}</p>}
            {a.sensitive_visible ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-xl bg-surface-2 p-2 text-xs">
                <span>جنسیت: {GENDER_FA[a.gender] || '—'}</span>
                <span>سال تولد: {a.birth_year ? toFaDigits(a.birth_year) : '—'}</span>
                <span dir="ltr">{a.phone ? toFaDigits(a.phone) : '—'}</span>
                <span dir="ltr">{a.email || '—'}</span>
              </div>
            ) : (
              <p className="text-xs text-muted">اطلاعات حساس فقط با رضایت فرد و فقط برای مسئول نشریات نمایش داده می‌شود.</p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function AdminPerson() {
  const { key = '' } = useParams()
  const st = useAsync(() => api.get(`/api/admin/people/${encodeURIComponent(key)}`), [key])
  return (
    <Async state={st}>
      {(d: any) => {
        const first = d.memberships[0]
        if (!first) return <Empty title="فرد یافت نشد" />
        return (
          <div className="space-y-4">
            <PageHeader
              back={<Link to="/admin/people" className="text-sm text-muted">← پروندهٔ افراد</Link>}
              title={first.full_name}
              subtitle={first.student_number ? `شمارهٔ دانشجویی ${toFaDigits(first.student_number)}` : undefined}
            />
            <AccountProfiles accounts={d.accounts} />
            <Card title="عضویت در نشریات">
              <ul className="divide-y divide-line text-sm">
                {d.memberships.map((m: any) => (
                  <li key={m.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <Link to={`/admin/publications/${m.publication_id}`} className="font-medium hover:text-brand">{m.publication_title}</Link>
                    <span className="text-xs text-muted">
                      {m.default_role || '—'} · از {faDate(m.joined_at)}
                      {m.left_at ? ` تا ${faDate(m.left_at)}` : ''} {!m.is_active && <Badge>غیرفعال</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title={`شماره‌ها (${toFaDigits(d.issues.length)})`}>
                {!d.issues.length ? (
                  <Empty title="در شماره‌ای ثبت نشده" />
                ) : (
                  <ul className="divide-y divide-line text-sm">
                    {d.issues.map((i: any, idx: number) => (
                      <li key={idx} className="flex flex-wrap justify-between gap-2 py-2">
                        <Link to={`/admin/issues/${i.id}`} className="hover:text-brand">
                          {i.publication_title} · شمارهٔ {toFaDigits(i.number)}
                        </Link>
                        <span className="flex items-center gap-2 text-xs text-muted">
                          {i.production_role || ''}
                          <Badge tone={ISSUE_STATUS[i.status]?.tone}>{ISSUE_STATUS[i.status]?.label || i.status}</Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title={`بخش‌های سپرده‌شده (${toFaDigits(d.sections.length)})`}>
                {!d.sections.length ? (
                  <Empty title="بخشی سپرده نشده" />
                ) : (
                  <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto text-sm">
                    {d.sections.map((s: any, idx: number) => (
                      <li key={idx} className="py-2">
                        <div className="flex justify-between gap-2">
                          <span className="font-medium">{s.title}</span>
                          <Badge tone={s.status === 'done' ? 'ok' : 'muted'}>{TOC_STATUS[s.status] || s.status}</Badge>
                        </div>
                        <div className="text-xs text-muted">
                          {s.publication_title} · شمارهٔ {toFaDigits(s.issue_number)} {s.role ? `· ${s.role}` : ''}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        )
      }}
    </Async>
  )
}

import { useState } from 'react'
import { Pencil, Plus, Search } from 'lucide-react'
import { api } from '../lib/api'
import { ISSUE_STATUS, TOC_STATUS, faDate, formatNumber, normalizeFa } from '../lib/format'
import { Async, Avatar, Badge, Button, Empty, Field, Input, Modal, PageHeader, Select, useAction, useAsync } from '../components/ui'
import { useTeam } from './Layout'
import MembershipRequests from './MembershipRequests'

interface Member {
  id: string
  full_name: string
  student_number: string | null
  faculty_id: string | null
  major_id: string | null
  faculty_name: string | null
  major_name: string | null
  default_role: string | null
  phone: string | null
  joined_at: string | null
  left_at: string | null
  is_active: number
  issue_count: number
  section_count: number
}

export default function TeamMembers() {
  const { pubId } = useTeam()
  const st = useAsync(() => Promise.all([api.get(`/api/team/${pubId}/members`), api.get('/api/public/categories')]), [pubId])
  const [q, setQ] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [edit, setEdit] = useState<Partial<Member> | null>(null)
  const [detail, setDetail] = useState<string | null>(null)

  return (
    <div>
      <PageHeader
        title="اعضای تیم"
        subtitle="نویسندگان، ویراستاران، گرافیست‌ها و دیگر همکاران نشریه"
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setEdit({})}>
            عضو جدید
          </Button>
        }
      />
      <Async state={st}>
        {([d, cats]: any) => {
          const nq = normalizeFa(q.trim())
          const rows: Member[] = d.members.filter(
            (m: Member) => (showInactive || m.is_active) && (!nq || normalizeFa([m.full_name, m.student_number, m.default_role].join(' ')).includes(nq))
          )
          return (
            <>
              <MembershipRequests pubId={pubId} roles={d.roles || []} onApproved={st.reload} />
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <div className="relative min-w-56 flex-1">
                  <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجوی نام، شماره دانشجویی یا نقش" className="pr-9" />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                  نمایش غیرفعال‌ها
                </label>
              </div>
              {!rows.length ? (
                <Empty title="عضوی یافت نشد" hint="اعضای تیم را اضافه کنید تا بتوانید بخش‌های هر شماره را به آن‌ها بسپارید." />
              ) : (
                <div className="card overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-2 text-xs text-muted">
                      <tr>
                        <th className="p-3 text-right">نام</th>
                        <th className="p-3 text-right">نقش پیش‌فرض</th>
                        <th className="hidden p-3 text-right md:table-cell">دانشکده</th>
                        <th className="p-3 text-center">شماره‌ها</th>
                        <th className="p-3 text-center">بخش‌ها</th>
                        <th className="hidden p-3 text-right sm:table-cell">پیوستن</th>
                        <th className="p-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((m) => (
                        <tr key={m.id} className="border-t border-line hover:bg-surface-2/50">
                          <td className="p-3">
                            <button className="flex items-center gap-2 text-right" onClick={() => setDetail(m.id)}>
                              <Avatar name={m.full_name} size={32} />
                              <span>
                                <span className="block font-bold">{m.full_name}</span>
                                {m.student_number && <span className="text-[11px] text-muted">{m.student_number}</span>}
                              </span>
                              {!m.is_active && <Badge>غیرفعال</Badge>}
                            </button>
                          </td>
                          <td className="p-3">{m.default_role || '—'}</td>
                          <td className="hidden p-3 md:table-cell">{m.faculty_name || '—'}</td>
                          <td className="p-3 text-center">{formatNumber(m.issue_count)}</td>
                          <td className="p-3 text-center">{formatNumber(m.section_count)}</td>
                          <td className="hidden p-3 text-xs text-muted sm:table-cell">{faDate(m.joined_at)}</td>
                          <td className="p-3">
                            <button className="rounded-lg p-1.5 hover:bg-surface-2" onClick={() => setEdit(m)} aria-label="ویرایش">
                              <Pencil className="size-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {edit && (
                <MemberForm
                  pubId={pubId}
                  member={edit}
                  roles={d.roles}
                  faculties={cats.faculties}
                  onClose={() => setEdit(null)}
                  onSaved={() => {
                    setEdit(null)
                    st.reload()
                  }}
                />
              )}
            </>
          )
        }}
      </Async>
      {detail && <MemberDetail id={detail} pubId={pubId} onClose={() => setDetail(null)} />}
    </div>
  )
}

function MemberForm({
  pubId,
  member,
  roles,
  faculties,
  onClose,
  onSaved
}: {
  pubId: string
  member: Partial<Member>
  roles: { id: string; name: string }[]
  faculties: { id: string; name: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  const isNew = !member.id
  const [f, setF] = useState({
    full_name: member.full_name || '',
    student_number: member.student_number || '',
    faculty_id: member.faculty_id || '',
    major_id: member.major_id || '',
    default_role: member.default_role || '',
    phone: member.phone || '',
    joined_at: member.joined_at || ''
  })
  const { busy, run } = useAction()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))
  const save = (active = true) =>
    run(async () => {
      const payload = { ...f, is_active: active }
      if (isNew) await api.post(`/api/team/${pubId}/members`, payload)
      else await api.put(`/api/team/${pubId}/members/${member.id}`, payload)
      onSaved()
    }, isNew ? 'عضو افزوده شد' : active ? 'ذخیره شد' : 'عضو غیرفعال شد')

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'افزودن عضو' : `ویرایش ${member.full_name}`}
      footer={
        <>
          {!isNew &&
            (member.is_active ? (
              <Button variant="danger" loading={busy} onClick={() => save(false)}>
                غیرفعال‌سازی
              </Button>
            ) : (
              <Button variant="ghost" loading={busy} onClick={() => save(true)}>
                فعال‌سازی دوباره
              </Button>
            ))}
          <Button loading={busy} disabled={f.full_name.trim().length < 2} onClick={() => save(member.is_active === 0 ? false : true)}>
            ذخیره
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="نام و نام خانوادگی *">
            <Input value={f.full_name} onChange={set('full_name')} autoFocus />
          </Field>
        </div>
        <Field label="شماره دانشجویی" hint="اختیاری">
          <Input value={f.student_number} onChange={set('student_number')} inputMode="numeric" dir="ltr" />
        </Field>
        <Field label="تلفن" hint="فقط برای تیم قابل مشاهده است">
          <Input value={f.phone} onChange={set('phone')} inputMode="tel" dir="ltr" />
        </Field>
        <Field label="دانشکده">
          <Select value={f.faculty_id} onChange={set('faculty_id')} placeholder="—" options={faculties.map((x) => ({ value: x.id, label: x.name }))} />
        </Field>
        <Field label="نقش پیش‌فرض">
          <Input value={f.default_role} onChange={set('default_role')} list="prod-roles" placeholder="مثلاً نویسنده" />
          <datalist id="prod-roles">
            {roles.map((r) => (
              <option key={r.id} value={r.name} />
            ))}
          </datalist>
        </Field>
        <Field label="تاریخ پیوستن" hint="میلادی (YYYY-MM-DD)">
          <Input type="date" value={f.joined_at} onChange={set('joined_at')} dir="ltr" />
        </Field>
      </div>
    </Modal>
  )
}

function MemberDetail({ id, pubId, onClose }: { id: string; pubId: string; onClose: () => void }) {
  const st = useAsync(() => api.get(`/api/team/${pubId}/members/${id}`), [id, pubId])
  return (
    <Modal open onClose={onClose} title="پروندهٔ همکاری" wide>
      <Async state={st}>
        {(d: any) => (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <Avatar name={d.member.full_name} size={48} />
              <div>
                <div className="text-lg font-bold">{d.member.full_name}</div>
                <div className="text-xs text-muted">
                  {d.member.default_role || 'بدون نقش پیش‌فرض'} · عضو از {faDate(d.member.joined_at)}
                  {d.member.left_at && ` تا ${faDate(d.member.left_at)}`}
                </div>
              </div>
            </div>
            <section>
              <h3 className="mb-2 font-bold">شماره‌ها ({formatNumber(d.issues.length)})</h3>
              {d.issues.length ? (
                <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                  {d.issues.map((i: any) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 p-2.5">
                      <span>
                        شمارهٔ {formatNumber(i.number)} — {i.title}
                        {i.production_role && <span className="text-muted"> · {i.production_role}</span>}
                      </span>
                      <Badge tone={ISSUE_STATUS[i.status]?.tone || 'muted'}>{ISSUE_STATUS[i.status]?.label || i.status}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">هنوز در شماره‌ای عضو نبوده است.</p>
              )}
            </section>
            <section>
              <h3 className="mb-2 font-bold">بخش‌های سپرده‌شده ({formatNumber(d.sections.length)})</h3>
              {d.sections.length ? (
                <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                  {d.sections.map((s: any, k: number) => (
                    <li key={s.id + k} className="flex items-center justify-between gap-2 p-2.5">
                      <span>
                        {s.title} <span className="text-muted">({s.role || '—'} · شمارهٔ {formatNumber(s.issue_number)})</span>
                      </span>
                      <span className="text-xs text-muted">{TOC_STATUS[s.status] || s.status}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">بخشی به این عضو سپرده نشده است.</p>
              )}
            </section>
          </div>
        )}
      </Async>
    </Modal>
  )
}

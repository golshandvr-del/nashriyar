import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { api, mediaUrl } from '../lib/api'
import { ASSOC_KIND, FREQUENCY, PUB_STATUS, faDate, normalizeFa, relativeFa, toFaDigits } from '../lib/format'
import { Async, Avatar, Badge, Empty, Input, PageHeader, useAsync } from '../components/ui'
import { ExportButtons } from '../components/Chart'
import { useAdminRole } from './Layout'

const DAY = 86400000

export default function AdminPublications() {
  const { admin } = useAdminRole()
  const st = useAsync(() => api.get('/api/admin/publications'), [])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')

  return (
    <div>
      <PageHeader
        title="نشریات"
        subtitle="همهٔ نشریات دانشجویی، وضعیت مجوز و فعالیت"
        actions={
          admin && (
            <Link to="/admin/publications/new" className="btn-primary">
              <Plus className="size-4" /> نشریهٔ جدید
            </Link>
          )
        }
      />
      <Async state={st}>
        {(d: any) => {
          const nq = normalizeFa(q.trim())
          const rows = d.publications.filter(
            (p: any) => (!status || p.status === status) && (!nq || normalizeFa([p.title, p.association_name, p.faculty_name, p.license_number].join(' ')).includes(nq))
          )
          const pubsCsv = () => {
            const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
            const head = ['نشریه', 'وضعیت', 'دانشکده', 'صاحب امتیاز', 'دوره', 'شمارهٔ مجوز', 'انقضای مجوز', 'منتشرشده', 'در جریان', 'آخرین انتشار', 'اعضا', 'دنبال‌کننده']
            const body = rows.map((p: any) =>
              [p.title, PUB_STATUS[p.status], p.faculty_name, p.association_name, FREQUENCY[p.frequency], p.license_number, faDate(p.license_expires_at), p.published_count, p.in_progress_count, faDate(p.last_published_at), p.member_count, p.follower_count].map(esc).join(',')
            )
            return [head.join(','), ...body].join('\n')
          }
          return (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <div className="relative min-w-56 flex-1">
                  <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجوی نام، انجمن، دانشکده یا شمارهٔ مجوز" className="pr-9" />
                </div>
                <select className="input !w-auto max-w-full" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="وضعیت">
                  <option value="">همهٔ وضعیت‌ها</option>
                  {Object.entries(PUB_STATUS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <ExportButtons name="publications" csv={pubsCsv} />
              </div>
              {!rows.length ? (
                <Empty title="نشریه‌ای یافت نشد" />
              ) : (
                <div className="card overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-2 text-xs text-muted">
                      <tr>
                        <th className="p-3 text-right">نشریه</th>
                        <th className="hidden p-3 text-right lg:table-cell">صاحب امتیاز</th>
                        <th className="p-3 text-center">منتشرشده</th>
                        <th className="p-3 text-center">در جریان</th>
                        <th className="hidden p-3 text-right md:table-cell">آخرین انتشار</th>
                        <th className="hidden p-3 text-right md:table-cell">مجوز</th>
                        <th className="hidden p-3 text-right sm:table-cell">آخرین فعالیت</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p: any) => {
                        const exp = p.license_expires_at ? new Date(p.license_expires_at).getTime() : null
                        const expired = exp !== null && exp < Date.now()
                        const soon = exp !== null && !expired && exp - Date.now() < 60 * DAY
                        return (
                          <tr key={p.id} className="border-t border-line hover:bg-surface-2/50">
                            <td className="p-3">
                              <Link to={`/admin/publications/${p.id}`} className="flex items-center gap-2 hover:text-brand">
                                <Avatar src={mediaUrl(p.logo_key)} name={p.title} size={32} color={p.theme_color} />
                                <span className="min-w-0">
                                  <span className="block truncate font-bold">{p.title}</span>
                                  <span className="block text-xs text-muted">
                                    {FREQUENCY[p.frequency] || p.frequency} · {p.faculty_name || 'بدون دانشکده'}
                                  </span>
                                </span>
                                {p.status !== 'active' && <Badge tone={p.status === 'suspended' ? 'danger' : 'muted'}>{PUB_STATUS[p.status]}</Badge>}
                              </Link>
                            </td>
                            <td className="hidden p-3 text-xs lg:table-cell">
                              {p.association_name}
                              <div className="text-muted">{ASSOC_KIND[p.association_kind] || ''}</div>
                            </td>
                            <td className="p-3 text-center">{toFaDigits(p.published_count)}</td>
                            <td className="p-3 text-center">{toFaDigits(p.in_progress_count)}</td>
                            <td className="hidden p-3 text-xs md:table-cell">{faDate(p.last_published_at)}</td>
                            <td className="hidden p-3 text-xs md:table-cell">
                              {p.license_number ? <span dir="ltr">{toFaDigits(p.license_number)}</span> : '—'}
                              {expired && <Badge tone="danger" className="mr-1">منقضی</Badge>}
                              {soon && <Badge tone="warn" className="mr-1">رو به انقضا</Badge>}
                            </td>
                            <td className="hidden p-3 text-xs text-muted sm:table-cell">{p.last_activity_at ? relativeFa(p.last_activity_at) : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )
        }}
      </Async>
    </div>
  )
}

import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { api, mediaUrl } from '../lib/api'
import { ASSOC_KIND, FREQUENCY, PUB_STATUS, faDate, relativeFa, toFaDigits } from '../lib/format'
import { Async, Avatar, Badge, Empty, PageHeader, useAsync } from '../components/ui'
import { DataTable } from '../components/DataTable'
import { PUB_COLUMNS } from '../../shared/columns'
import { useAdminRole } from './Layout'

const DAY = 86400000

/** Publications list on the unified DataTable (ROADMAP phase 18): filters, search, sort, grouping, columns, export, print. */
export default function AdminPublications() {
  const { admin } = useAdminRole()
  const st = useAsync(() => api.get<{ publications: any[] }>('/api/admin/publications'), [])

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
        {(d) => (
          <DataTable
            id="admin-publications"
            title="نشریات"
            columns={PUB_COLUMNS}
            rows={d.publications}
            rowKey={(p) => String(p.id)}
            exportUrl="/api/admin/publications/export"
            empty={<Empty title="نشریه‌ای یافت نشد" />}
            render={{
              title: (p: any) => (
                <Link to={`/admin/publications/${p.id}`} className="flex items-center gap-2 hover:text-brand">
                  <Avatar src={mediaUrl(p.logo_key)} name={p.title} size={32} color={p.theme_color} />
                  <span className="min-w-0">
                    <span className="block truncate font-bold">{p.title}</span>
                    <span className="block text-xs text-muted">
                      {FREQUENCY[p.frequency] || p.frequency} · {p.faculty_name || 'بدون دانشکده'}
                    </span>
                  </span>
                </Link>
              ),
              status: (p: any) => <Badge tone={p.status === 'active' ? 'ok' : p.status === 'suspended' ? 'danger' : 'muted'}>{PUB_STATUS[p.status] || p.status}</Badge>,
              association_name: (p: any) => (
                <span className="text-xs">
                  {p.association_name}
                  <span className="block text-muted">{ASSOC_KIND[p.association_kind] || ''}</span>
                </span>
              ),
              last_published_at: (p: any) => <span className="text-xs">{faDate(p.last_published_at)}</span>,
              license_number: (p: any) => {
                const exp = p.license_expires_at ? new Date(p.license_expires_at).getTime() : null
                const expired = exp !== null && exp < Date.now()
                const soon = exp !== null && !expired && exp - Date.now() < 60 * DAY
                return (
                  <span className="text-xs">
                    {p.license_number ? <span dir="ltr">{toFaDigits(p.license_number)}</span> : '—'}
                    {expired && <Badge tone="danger" className="mr-1">منقضی</Badge>}
                    {soon && <Badge tone="warn" className="mr-1">رو به انقضا</Badge>}
                  </span>
                )
              },
              last_activity_at: (p: any) => <span className="text-xs text-muted">{p.last_activity_at ? relativeFa(p.last_activity_at) : '—'}</span>
            }}
          />
        )}
      </Async>
    </div>
  )
}

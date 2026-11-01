import { useState } from 'react'
import { FileDiff, ScrollText } from 'lucide-react'
import { qs } from '../lib/api'
import { faDate } from '../lib/format'
import { Async, Badge, Empty, Modal, PageHeader, useAsync } from '../components/ui'
import { DataTable, fetchAllPages } from '../components/DataTable'
import { AUDIT_COLUMNS } from '../../shared/columns'
import { AUDIT_ACTION_FA as ACTION_FA, AUDIT_GROUPS as GROUPS } from '../../shared/labels'

function pretty(json: string | null): string {
  if (!json) return ''
  try {
    return JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    return json
  }
}

/** Audit log on the unified DataTable (ROADMAP phase 18): group chips filter on the server, the table does the rest. */
export default function AdminAudit() {
  const [action, setAction] = useState('')
  // every keyset page of the (server-filtered) log is loaded; DataTable filters/sorts/groups/exports it
  const st = useAsync(() => fetchAllPages('/api/admin/audit' + qs({ action }), 'items'), [action])
  const [open, setOpen] = useState<any>(null)

  return (
    <div className="space-y-4">
      <PageHeader title="گزارش رویدادها" subtitle="ثبت تغییرناپذیر اقدام‌های مدیریتی" />
      <div className="flex flex-wrap gap-2">
        {Object.entries(GROUPS).map(([k, l]) => (
          <button key={k} className={action === k ? 'chip border-brand bg-brand-soft text-brand' : 'chip'} onClick={() => setAction(k)}>
            {l}
          </button>
        ))}
      </div>
      <Async state={st}>
        {(d) => (
          <DataTable
            id="admin-audit"
            title="گزارش رویدادها"
            columns={AUDIT_COLUMNS}
            rows={d.rows}
            truncated={d.truncated}
            rowKey={(a) => String(a.id)}
            exportUrl="/api/admin/audit/export"
            extraParams={{ action }}
            empty={<Empty icon={<ScrollText className="size-10 opacity-60" />} title="رویدادی ثبت نشده" />}
            render={{
              created_at: (a: any) => <span className="text-xs text-muted">{faDate(a.created_at, true)}</span>,
              actor_name: (a: any) => <span className="font-bold">{a.actor_name || 'سیستم'}</span>,
              action: (a: any) => <Badge tone="brand">{ACTION_FA[a.action] || a.action}</Badge>,
              entity_type: (a: any) => <span className="text-xs text-muted">{a.entity_type || '—'}{a.entity_id ? ` · ${String(a.entity_id).slice(0, 8)}` : ''}</span>
            }}
            actions={(a: any) =>
              a.before_json || a.after_json ? (
                <button className="rounded-lg p-1.5 hover:bg-surface-2" onClick={() => setOpen(a)} aria-label="نمایش تغییرات" title="نمایش تغییرات">
                  <FileDiff className="size-4" />
                </button>
              ) : null
            }
          />
        )}
      </Async>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${ACTION_FA[open.action] || open.action} — ${faDate(open.created_at, true)}` : ''} wide>
        {open && (
          <div className="grid gap-2 md:grid-cols-2">
            {(['before_json', 'after_json'] as const).map((k) =>
              open[k] ? (
                <div key={k}>
                  <div className="mb-1 text-xs text-muted">{k === 'before_json' ? 'قبل' : 'بعد'}</div>
                  <pre dir="ltr" className="max-h-96 overflow-auto rounded-lg bg-surface-2 p-2 text-xs">{pretty(open[k])}</pre>
                </div>
              ) : null
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

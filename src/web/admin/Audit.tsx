import { useState } from 'react'
import { ChevronDown, ChevronLeft, ScrollText } from 'lucide-react'
import { api, qs } from '../lib/api'
import { faDate, toFaDigits } from '../lib/format'
import { Async, Badge, Empty, PageHeader, useAsync } from '../components/ui'
import { ExportButtons } from '../components/Chart'
import { AUDIT_ACTION_FA as ACTION_FA, AUDIT_GROUPS as GROUPS } from '../../shared/labels'

const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
const csvOf = (head: string[], rows: unknown[][]) => [head.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')

function pretty(json: string | null): string {
  if (!json) return ''
  try {
    return JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    return json
  }
}

export default function AdminAudit() {
  const [action, setAction] = useState('')
  const st = useAsync(() => api.get('/api/admin/audit' + qs({ action })), [action])
  const [open, setOpen] = useState<string | null>(null)

  const auditCsv = (items: any[]) =>
    csvOf(
      ['زمان', 'کاربر', 'اقدام', 'نوع موجودیت', 'شناسه', 'قبل', 'بعد'],
      items.map((a) => [faDate(a.created_at, true), a.actor_name || a.actor_username || '—', a.action, a.entity_type || '', a.entity_id || '', a.before_json || '', a.after_json || ''])
    )

  return (
    <div className="space-y-4">
      <Async state={st}>
        {(d: any) => (
          <>
            <PageHeader
              title="گزارش رویدادها"
              subtitle="ثبت تغییرناپذیر اقدام‌های مدیریتی (۳۰۰ رویداد اخیر)"
              actions={
                d.items.length ? <ExportButtons name="audit-log" csv={() => auditCsv(d.items)} /> : null
              }
            />
            <div className="flex flex-wrap gap-2">
              {Object.entries(GROUPS).map(([k, l]) => (
                <button key={k} className={action === k ? 'chip border-brand bg-brand-soft text-brand' : 'chip'} onClick={() => setAction(k)}>
                  {l}
                </button>
              ))}
            </div>
            {!d.items.length ? (
              <Empty icon={<ScrollText className="size-10 opacity-60" />} title="رویدادی ثبت نشده" />
            ) : (
              <ul className="card divide-y divide-line">
                {d.items.map((a: any) => {
                  const expanded = open === a.id
                  const hasDiff = a.before_json || a.after_json
                  return (
                    <li key={a.id} className="p-3">
                      <button
                        className="flex w-full flex-wrap items-center gap-2 text-start text-sm disabled:cursor-default"
                        disabled={!hasDiff}
                        onClick={() => setOpen(expanded ? null : a.id)}
                        aria-expanded={expanded}
                      >
                        {hasDiff ? expanded ? <ChevronDown className="size-4 text-muted" /> : <ChevronLeft className="size-4 text-muted" /> : <span className="w-4" />}
                        <span className="font-bold">{a.actor_name || a.actor_username || 'سیستم'}</span>
                        <Badge tone="brand">{ACTION_FA[a.action] || a.action}</Badge>
                        {a.entity_type && <span className="text-xs text-muted">{a.entity_type}{a.entity_id ? ` · ${String(a.entity_id).slice(0, 8)}` : ''}</span>}
                        <span className="ms-auto text-xs text-muted">{faDate(a.created_at, true)}</span>
                      </button>
                      {expanded && (
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          {a.before_json && (
                            <div>
                              <div className="mb-1 text-xs text-muted">قبل</div>
                              <pre dir="ltr" className="max-h-60 overflow-auto rounded-lg bg-surface-2 p-2 text-xs">{pretty(a.before_json)}</pre>
                            </div>
                          )}
                          {a.after_json && (
                            <div>
                              <div className="mb-1 text-xs text-muted">بعد</div>
                              <pre dir="ltr" className="max-h-60 overflow-auto rounded-lg bg-surface-2 p-2 text-xs">{pretty(a.after_json)}</pre>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="text-xs text-muted">{toFaDigits(d.items.length)} رویداد نمایش داده شد.</p>
          </>
        )}
      </Async>
    </div>
  )
}

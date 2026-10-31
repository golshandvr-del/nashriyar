// /system/audit — independent, append-only technical audit log (DB triggers forbid UPDATE / DELETE) (ROADMAP phase 13).
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '../lib/api'
import { Async, Badge, Button, Card, Empty, PageHeader, useAsync } from '../components/ui'
import { faDate } from '../../shared/fa'

type Item = { id: string; action: string; detail_json: string | null; ip: string | null; created_at: string; actor: string | null }

const LABELS: Record<string, string> = {
  'system.elevate': 'تأیید دوبارهٔ هویت',
  'system.elevate_failed': 'تأیید هویت ناموفق',
  'system.settings': 'تغییر تنظیمات فنی',
  'system.backup': 'ساخت پشتیبان',
  'system.restore_test': 'آزمون بازیابی',
  'system.backup_download': 'دانلود پشتیبان',
  'system.session_revoke': 'بستن نشست',
  'system.user_logout_all': 'خروج اجباری کاربر',
  'system.lock_clear': 'رفع قفل ورود',
  'system.db_vacuum': 'VACUUM',
  'system.db_analyze': 'ANALYZE',
  'system.staff_create': 'ساخت حساب کارمند ارشد',
  'system.staff_password_reset': 'بازنشانی رمز کارمند',
  'system.staff_totp_reset': 'حذف ۲FA کارمند',
  'system.staff_status': 'تغییر وضعیت کارمند',
  'system.developer_create': 'ساخت حساب طراح (CLI)',
  'system.developer_reset': 'بازنشانی حساب طراح (CLI)'
}
const DANGER = new Set(['system.elevate_failed', 'system.staff_totp_reset', 'system.user_logout_all', 'system.backup_download'])

export default function SystemAudit() {
  const [pages, setPages] = useState<Item[][]>([])
  const st = useAsync(async () => {
    const r = await api.get<{ items: Item[] }>('/api/system/audit')
    setPages([])
    return r
  }, [])
  const [more, setMore] = useState(false)
  const [done, setDone] = useState(false)
  const all = [...(st.data?.items || []), ...pages.flat()]
  const loadMore = async () => {
    const last = all[all.length - 1]
    if (!last) return
    setMore(true)
    try {
      const r = await api.get<{ items: Item[] }>(`/api/system/audit?before=${encodeURIComponent(last.created_at)}`)
      setPages((p) => [...p, r.items])
      if (r.items.length < 100) setDone(true)
    } finally {
      setMore(false)
    }
  }
  return (
    <div className="space-y-4">
      <PageHeader
        title="گزارش فنی"
        subtitle="هر اقدام در پنل طراح این‌جا ثبت می‌شود؛ این گزارش حتی از پایگاه داده هم قابل ویرایش یا حذف نیست"
        actions={
          <Button variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => (setDone(false), st.reload())}>
            به‌روزرسانی
          </Button>
        }
      />
      <Async state={st}>
        {() =>
          all.length === 0 ? (
            <Empty title="هنوز رویدادی ثبت نشده است" />
          ) : (
            <Card>
              <ul className="divide-y divide-line text-sm">
                {all.map((a) => (
                  <li key={a.id} className="py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={DANGER.has(a.action) ? 'danger' : 'brand'}>{LABELS[a.action] || a.action}</Badge>
                      <span className="text-xs text-muted">{faDate(a.created_at, true)}</span>
                      <span dir="ltr" className="text-xs text-muted">
                        {a.actor ? '@' + a.actor : 'CLI'} · {a.ip || '—'}
                      </span>
                    </div>
                    {a.detail_json && (
                      <pre dir="ltr" className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-surface-2 p-2 text-start text-[11px]">
                        {a.detail_json}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
              {!done && all.length >= 100 && (
                <div className="mt-3 text-center">
                  <Button variant="ghost" loading={more} onClick={loadMore}>
                    موارد قدیمی‌تر
                  </Button>
                </div>
              )}
            </Card>
          )
        }
      </Async>
    </div>
  )
}

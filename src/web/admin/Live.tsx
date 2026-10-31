import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { api } from '../lib/api'
import { ISSUE_STATUS, faDate, relativeFa, toFaDigits } from '../lib/format'
import { Async, Badge, Button, Card, Empty, PageHeader, Progress, useAsync } from '../components/ui'

export const FEED_LABEL: Record<string, string> = {
  'issue.created': 'شمارهٔ جدید آغاز شد',
  'issue.members': 'اعضای شماره به‌روز شد',
  'issue.approval_requested': 'درخواست تأیید انتشار',
  'issue.approval_withdrawn': 'درخواست تأیید پس گرفته شد',
  'issue.published': 'شماره منتشر شد',
  'issue.changes_requested': 'درخواست اصلاح',
  'issue.pages_processed': 'صفحات PDF پردازش شد',
  'toc.added': 'بخش به فهرست افزوده شد',
  'toc.updated': 'بخش ویرایش شد',
  'toc.removed': 'بخش حذف شد',
  'toc.assigned': 'بخش به عضو سپرده شد',
  'toc.status': 'وضعیت بخش تغییر کرد',
  'stage.status': 'مرحلهٔ تولید تغییر کرد',
  'media.uploaded': 'فایل بارگذاری شد',
  'media.deleted': 'فایل حذف شد',
  'member.added': 'عضو جدید به تیم پیوست',
  'post.published': 'پست اکسپلور منتشر شد',
  'post.updated': 'پست ویرایش شد',
  'codes.created': 'کد خرید ساخته شد',
  'physical_sale.recorded': 'فروش چاپی ثبت شد',
  'certificates.issued': 'گواهی همکاری صادر شد',
  'publication.created': 'نشریه تعریف شد',
  'publication.role_changed': 'تغییر در ارکان نشریه'
}

const STALE_DAYS = 14

export default function AdminLive() {
  const st = useAsync(() => api.get('/api/analytics/live'), [])
  // auto refresh every 60s while the tab is visible
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') st.reload()
    }, 60_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <PageHeader
        title="برد زنده"
        subtitle="شماره‌های در حال تولید و آخرین فعالیت تیم‌ها (به‌روزرسانی خودکار هر دقیقه)"
        actions={<Button variant="ghost" icon={<RefreshCw className="size-4" />} onClick={st.reload} loading={st.loading}>به‌روزرسانی</Button>}
      />
      <Async state={st}>
        {(d: any) => (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-3 lg:col-span-2">
              <h2 className="font-bold">در حال تولید ({toFaDigits(d.inProduction.length)})</h2>
              {!d.inProduction.length ? (
                <Empty title="شماره‌ای در حال تولید نیست" />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {d.inProduction.map((i: any) => {
                    const pct = i.toc_total ? Math.round((i.toc_done / i.toc_total) * 100) : 0
                    const stale = i.last_progress_at ? (Date.now() - new Date(i.last_progress_at).getTime()) / 86400000 > STALE_DAYS : true
                    const s = ISSUE_STATUS[i.status]
                    return (
                      <Link key={i.id} to={`/admin/issues/${i.id}`} className="card block p-4 hover:border-brand" style={{ borderInlineStartWidth: 4, borderInlineStartColor: i.theme_color || undefined }}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-xs text-muted">{i.publication_title}</div>
                            <div className="truncate font-bold">
                              شمارهٔ {toFaDigits(i.number)} — {i.title}
                            </div>
                          </div>
                          {s && <Badge tone={s.tone}>{s.label}</Badge>}
                        </div>
                        <Progress value={pct} className="mt-3" />
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-xs text-muted">
                          <span>
                            {toFaDigits(i.toc_done)} از {toFaDigits(i.toc_total)} بخش · {i.current_stage || 'بدون مرحلهٔ فعال'}
                          </span>
                          <span className={stale ? 'font-bold text-danger' : ''}>{i.last_progress_at ? relativeFa(i.last_progress_at) : 'بدون پیشرفت ثبت‌شده'}</span>
                        </div>
                        {i.planned_publish_at && (() => {
                          // ROADMAP phase 7 live board: delay = days past the planned publish date
                          const pp = String(i.planned_publish_at)
                          const late = Math.floor((Date.now() - new Date(pp.length === 10 ? pp + 'T23:59:59Z' : pp).getTime()) / 86400000) || 0
                          return (
                            <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                              <span>انتشار برنامه‌ریزی‌شده: {faDate(i.planned_publish_at)}</span>
                              {late > 0 && <span className="rounded bg-red-100 px-1.5 font-bold text-red-700">{toFaDigits(late)} روز تأخیر</span>}
                            </div>
                          )
                        })()}
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
            <Card title="فید فعالیت">
              {!d.feed.length ? (
                <Empty title="فعالیتی ثبت نشده" />
              ) : (
                <ol className="space-y-3 text-sm">
                  {d.feed.map((f: any, idx: number) => (
                    <li key={idx} className="border-b border-line pb-2 last:border-0">
                      <div className="font-medium">{FEED_LABEL[f.type] || f.type}</div>
                      <div className="text-xs text-muted">
                        {f.publication_title}
                        {f.issue_number ? ` · شمارهٔ ${toFaDigits(f.issue_number)}` : ''}
                        {f.actor_name ? ` · ${f.actor_name}` : ''}
                      </div>
                      <div className="text-[11px] text-muted">{relativeFa(f.created_at)}</div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
        )}
      </Async>
    </div>
  )
}

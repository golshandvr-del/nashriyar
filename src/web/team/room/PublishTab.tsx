import { useState } from 'react'
import { Award, CheckCircle2, QrCode, Send, ShieldOff, Undo2, XCircle } from 'lucide-react'
import { api } from '../../lib/api'
import { faDate, formatNumber, formatToman, relativeFa, toEnDigits } from '../../lib/format'
import { Badge, Button, Card, Field, Input, Select, Textarea, useAction, useToast } from '../../components/ui'
import type { RoomProps } from './TocTab'
import { qrDataUrl, qrSvg } from '../../lib/qr'

const DECISION: Record<string, { label: string; tone: 'ok' | 'danger' | 'muted' | 'warn' }> = {
  approved: { label: 'تأیید شد', tone: 'ok' },
  changes_requested: { label: 'نیازمند اصلاح', tone: 'danger' },
  withdrawn: { label: 'پس گرفته شد', tone: 'muted' }
}

export default function PublishTab({ d, reload, pubId }: RoomProps) {
  const i = d.issue
  const { busy, run } = useAction()
  const { confirm } = useToast()
  const [f, setF] = useState({
    pricing: i.pricing || 'free',
    price_digital: i.price_digital ?? '',
    price_print: i.price_print ?? '',
    print_run: i.print_run ?? '',
    free_preview_pages: i.free_preview_pages ?? 3,
    code_ttl_hours: i.code_ttl_hours ?? 24,
    planned_publish_at: (i.planned_publish_at || '').slice(0, 10)
  })
  const [note, setNote] = useState('')
  const [certs, setCerts] = useState<any[] | null>(null)
  const [revoke, setRevoke] = useState({ student_number: '', reason: '' })
  const awaiting = i.status === 'awaiting_approval'
  const published = i.status === 'published'
  const canRequest = ['planning', 'in_production', 'changes_requested'].includes(i.status)
  const n = (v: any) => (v === '' || v == null ? null : Number(toEnDigits(String(v))))

  const checklist = [
    { ok: d.pages_uploaded > 0 && !!i.page_count, label: 'نسخهٔ دیجیتال (PDF) پردازش شده' },
    { ok: !!i.cover_key, label: 'جلد تعیین شده' },
    { ok: d.toc.length > 0, label: 'فهرست مطالب دارد' },
    { ok: i.pricing !== 'paid' || !!i.price_digital, label: 'قیمت (برای شمارهٔ پولی) تعیین شده' }
  ]
  const lastChanges = d.approvals.find((a: any) => a.decision === 'changes_requested')

  return (
    <div className="space-y-4">
      {i.status === 'changes_requested' && lastChanges && (
        <Card className="border-red-300">
          <div className="flex items-center gap-2 font-bold text-danger"><XCircle className="size-5" /> مسئول نشریات درخواست اصلاح داده است</div>
          {lastChanges.note && <p className="mt-2 whitespace-pre-line text-sm leading-7">{lastChanges.note}</p>}
        </Card>
      )}

      <Card title="قیمت‌گذاری و تنظیمات انتشار">
        <fieldset disabled={awaiting || busy} className="grid gap-3 sm:grid-cols-2">
          <Field label="نوع دسترسی">
            <Select value={f.pricing} onChange={(e) => setF({ ...f, pricing: e.target.value })} options={[{ value: 'free', label: 'رایگان' }, { value: 'paid', label: 'پولی (با کد خرید)' }]} />
          </Field>
          {f.pricing === 'paid' && (
            <Field label="قیمت نسخهٔ دیجیتال (تومان)" hint={f.price_digital ? formatToman(n(f.price_digital) || 0) : 'حداقل ۱٬۰۰۰ تومان'}>
              <Input inputMode="numeric" dir="ltr" value={f.price_digital} onChange={(e) => setF({ ...f, price_digital: e.target.value })} />
            </Field>
          )}
          <Field label="قیمت نسخهٔ چاپی (تومان)">
            <Input inputMode="numeric" dir="ltr" value={f.price_print} onChange={(e) => setF({ ...f, price_print: e.target.value })} />
          </Field>
          <Field label="تیراژ چاپ">
            <Input inputMode="numeric" dir="ltr" value={f.print_run} onChange={(e) => setF({ ...f, print_run: e.target.value })} />
          </Field>
          {f.pricing === 'paid' && (
            <>
              <Field label="صفحات پیش‌نمایش رایگان">
                <Input type="number" min={0} max={50} dir="ltr" value={f.free_preview_pages} onChange={(e) => setF({ ...f, free_preview_pages: e.target.value as any })} />
              </Field>
              <Field label="اعتبار کد خرید (ساعت)" hint="حداکثر ۲۴ ساعت">
                <Input type="number" min={1} max={24} dir="ltr" value={f.code_ttl_hours} onChange={(e) => setF({ ...f, code_ttl_hours: e.target.value as any })} />
              </Field>
            </>
          )}
          <Field label="تاریخ انتشار پیشنهادی">
            <Input type="date" dir="ltr" value={f.planned_publish_at} onChange={(e) => setF({ ...f, planned_publish_at: e.target.value })} />
          </Field>
        </fieldset>
        {!awaiting && (
          <Button
            className="mt-3"
            loading={busy}
            onClick={async () => {
              const r = await run(
                () =>
                  api.put(`/api/team/${pubId}/issues/${i.id}/publishing`, {
                    pricing: f.pricing,
                    price_digital: n(f.price_digital),
                    price_print: n(f.price_print),
                    print_run: n(f.print_run),
                    free_preview_pages: n(f.free_preview_pages) ?? 3,
                    code_ttl_hours: n(f.code_ttl_hours) ?? 24,
                    planned_publish_at: f.planned_publish_at || null
                  }),
                'تنظیمات انتشار ذخیره شد'
              )
              if (r) reload()
            }}
          >
            ذخیرهٔ تنظیمات
          </Button>
        )}
      </Card>

      {!published && (
        <Card title="تأیید انتشار">
          <ul className="mb-3 space-y-1 text-sm">
            {checklist.map((c) => (
              <li key={c.label} className="flex items-center gap-2">
                {c.ok ? <CheckCircle2 className="size-4 text-ok" /> : <XCircle className="size-4 text-danger" />}
                {c.label}
              </li>
            ))}
          </ul>
          {canRequest && (
            <>
              <Field label="یادداشت برای مسئول نشریات (اختیاری)">
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </Field>
              <Button
                className="mt-2"
                loading={busy}
                disabled={!checklist.every((c) => c.ok)}
                icon={<Send className="size-4" />}
                onClick={async () => {
                  if (!(await confirm('پس از ارسال، نسخهٔ اصلی و جلد قفل می‌شوند تا مسئول نشریات تصمیم بگیرد. ارسال شود؟'))) return
                  const r = await run(() => api.post(`/api/team/${pubId}/issues/${i.id}/request-approval`, { note }), 'برای تأیید ارسال شد')
                  if (r) reload()
                }}
              >
                ارسال برای تأیید انتشار
              </Button>
            </>
          )}
          {awaiting && (
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone="warn">در انتظار تصمیم مسئول نشریات</Badge>
              <Button
                variant="ghost"
                loading={busy}
                icon={<Undo2 className="size-4" />}
                onClick={async () => {
                  if (!(await confirm('درخواست تأیید پس گرفته شود؟'))) return
                  const r = await run(() => api.post(`/api/team/${pubId}/issues/${i.id}/withdraw-approval`), 'درخواست پس گرفته شد')
                  if (r) reload()
                }}
              >
                پس گرفتن درخواست
              </Button>
            </div>
          )}
        </Card>
      )}

      {d.approvals.length > 0 && (
        <Card title="سابقهٔ درخواست‌های تأیید">
          <ul className="divide-y divide-line text-sm">
            {d.approvals.map((a: any) => {
              const dec = a.decision ? DECISION[a.decision] || { label: a.decision, tone: 'muted' as const } : { label: 'در انتظار', tone: 'warn' as const }
              return (
                <li key={a.id} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span>درخواست {relativeFa(a.requested_at)}</span>
                    <Badge tone={dec.tone}>{dec.label}</Badge>
                  </div>
                  {a.decided_by_name && <div className="text-xs text-muted">{a.decided_by_name} · {faDate(a.decided_at, true)}</div>}
                  {a.note && <p className="mt-1 whitespace-pre-line text-xs leading-6 text-muted">{a.note}</p>}
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {published && (
        <>
          <Card title={<span className="flex items-center gap-2"><Award className="size-5" /> گواهی همکاری</span>}>
            <p className="mb-3 text-sm text-muted">برای همهٔ اعضای این شماره گواهی با کد استعلام صادر می‌شود (صدور تکراری انجام نمی‌شود).</p>
            <Button
              loading={busy}
              onClick={async () => {
                const r = await run(() => api.post(`/api/team/${pubId}/issues/${i.id}/certificates`))
                if (r) setCerts(r.certificates)
              }}
            >
              صدور / نمایش گواهی‌ها
            </Button>
            {certs && (
              <ul className="mt-3 divide-y divide-line text-sm">
                {certs.map((c) => (
                  <li key={c.verify_code} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span><b>{c.full_name}</b> <span className="text-xs text-muted">— {c.roles}</span></span>
                    <a href={`/verify/${c.verify_code}`} target="_blank" rel="noreferrer" className="font-mono text-xs text-brand" dir="ltr">{c.verify_code}</a>
                  </li>
                ))}
                {!certs.length && <li className="py-2 text-muted">عضوی برای این شماره ثبت نشده است.</li>}
              </ul>
            )}
          </Card>
          {i.pricing === 'paid' && (
            <Card title={<span className="flex items-center gap-2"><ShieldOff className="size-5" /> ابطال دسترسی خواننده</span>}>
              <p className="mb-3 text-xs text-muted">در صورت سوءاستفاده (مثلاً اشتراک‌گذاری حساب)، دسترسی یک دانشجو به این شماره را باطل کنید.</p>
              <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
                <Input dir="ltr" placeholder="شمارهٔ دانشجویی" value={revoke.student_number} onChange={(e) => setRevoke({ ...revoke, student_number: e.target.value })} />
                <Input placeholder="دلیل" value={revoke.reason} onChange={(e) => setRevoke({ ...revoke, reason: e.target.value })} />
                <Button
                  variant="danger"
                  loading={busy}
                  disabled={!revoke.student_number}
                  onClick={async () => {
                    if (!(await confirm(`دسترسی ${revoke.student_number} باطل شود؟`, { danger: true }))) return
                    const r = await run(() => api.post(`/api/team/${pubId}/issues/${i.id}/revoke-reader`, { student_number: toEnDigits(revoke.student_number), reason: revoke.reason }), 'دسترسی باطل شد')
                    if (r) setRevoke({ student_number: '', reason: '' })
                  }}
                >
                  ابطال
                </Button>
              </div>
            </Card>
          )}
          <PrintQr issueId={i.id} number={i.number} />
          <p className="text-center text-xs text-muted">منتشرشده در {faDate(i.published_at)} · {formatNumber(i.page_count || 0)} صفحه</p>
        </>
      )}
    </div>
  )
}

/** QR for the printed edition (ROADMAP phase 3): links the paper copy to the issue's digital page. */
function PrintQr({ issueId, number }: { issueId: string; number: number }) {
  const url = `${window.location.origin}/issue/${issueId}`
  const download = () => {
    const blob = new Blob([qrSvg(url, { px: 1024 })], { type: 'image/svg+xml' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `qr-issue-${number}.svg`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  return (
    <Card title={<span className="flex items-center gap-2"><QrCode className="size-5" /> QR نسخهٔ چاپی</span>}>
      <div className="flex flex-wrap items-center gap-4">
        <img src={qrDataUrl(url, 160)} alt="QR صفحهٔ دیجیتال این شماره" width={128} height={128} className="rounded-lg bg-white p-1" />
        <div className="min-w-0 flex-1 space-y-2 text-sm">
          <p className="text-muted">این کد را روی جلد یا شناسنامهٔ نسخهٔ چاپی بگذارید تا خواننده به صفحهٔ دیجیتال همین شماره برسد.</p>
          <p className="truncate font-mono text-xs" dir="ltr">{url}</p>
          <Button variant="ghost" onClick={download}>دریافت SVG برای چاپ</Button>
        </div>
      </div>
    </Card>
  )
}

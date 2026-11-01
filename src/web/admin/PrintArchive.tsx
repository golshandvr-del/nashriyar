// /admin/print-archive — digitisation of old printed issues (ROADMAP phase 19).
// Workflow: register (original date + optional TOC) → upload the scanned PDF in the issue room's media tab
// (browser pdf.js or server pdftoppm/pdftotext → page images + text layer) → publish with the original date.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Archive, ExternalLink, Plus, Send, Upload } from 'lucide-react'
import { api } from '../lib/api'
import { faDate, toFaDigits } from '../lib/format'
import { isAdmin, useAuth } from '../lib/auth'
import { Async, Badge, Button, Card, Empty, Input, Modal, PageHeader, Select, Textarea, useAction, useAsync } from '../components/ui'

type Row = {
  id: string
  number: number
  title: string
  status: string
  page_count: number | null
  has_pdf: number
  original_date: string | null
  original_label: string | null
  published_at: string | null
  publication_id: string
  publication_title: string
  pages_uploaded: number
  pages_with_text: number
}

const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']

/** "عنوان | ص۱-۴" lines → TOC rows. Page range is optional. */
export function parseToc(text: string): { title: string; page_start?: number; page_end?: number }[] {
  const en = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [t, p] = l.split('|')
      const m = /(\d+)\s*[-–]?\s*(\d+)?/.exec(en(p || ''))
      return { title: t.trim(), ...(m ? { page_start: Number(m[1]), page_end: Number(m[2] || m[1]) } : {}) }
    })
    .filter((x) => x.title.length > 0)
}

export default function AdminPrintArchive() {
  const { user } = useAuth()
  const st = useAsync(() => api.get<{ issues: Row[] }>('/api/admin/print-archive'), [])
  const [open, setOpen] = useState(false)
  const [publishing, setPublishing] = useState<Row | null>(null)
  const canEdit = isAdmin(user)
  return (
    <div className="space-y-4">
      <PageHeader
        title="آرشیو شماره‌های چاپی"
        subtitle="دیجیتال‌سازی شماره‌های قدیمی: ثبت با تاریخ چاپ اصلی، بارگذاری اسکن، انتشار در آرشیو عمومی"
        actions={
          <div className="flex gap-2">
            <Link to="/archive" className="btn-ghost inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm" target="_blank">
              <ExternalLink className="size-4" /> آرشیو عمومی
            </Link>
            {canEdit && (
              <Button onClick={() => setOpen(true)}>
                <Plus className="size-4" /> ثبت شمارهٔ قدیمی
              </Button>
            )}
          </div>
        }
      />
      <Card>
        <ol className="list-inside list-decimal space-y-1 text-sm text-muted">
          <li>شماره را با تاریخ چاپ اصلی (حداقل سال) و در صورت امکان فهرست مطالبش ثبت کنید.</li>
          <li>در اتاق شماره، تب «رسانه»، فایل PDF اسکن‌شده را بارگذاری کنید؛ صفحه‌ها و لایهٔ متنی (برای جست‌وجوی تمام‌متن) ساخته می‌شوند.</li>
          <li>«انتشار در آرشیو» را بزنید؛ تاریخ انتشار همان تاریخ چاپ اصلی می‌شود و شماره در قفسه‌های «تازه‌ها» نمی‌آید.</li>
        </ol>
      </Card>
      <Async state={st}>
        {(d) =>
          !d.issues.length ? (
            <Empty icon={<Archive className="size-10 opacity-60" />} title="هنوز شمارهٔ چاپی‌ای ثبت نشده است" />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-xs text-muted">
                  <tr>
                    <th className="p-2 text-start">نشریه</th>
                    <th className="p-2 text-start">شماره</th>
                    <th className="p-2 text-start">تاریخ چاپ</th>
                    <th className="p-2 text-start">صفحه / متن</th>
                    <th className="p-2 text-start">وضعیت</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {d.issues.map((r) => (
                    <tr key={r.id} className="border-t border-line">
                      <td className="p-2">{r.publication_title}</td>
                      <td className="p-2">
                        <div className="font-bold">{r.title}</div>
                        <div className="text-xs text-muted">شمارهٔ {toFaDigits(r.number)}</div>
                      </td>
                      <td className="p-2">{r.original_label || faDate(r.original_date)}</td>
                      <td className="p-2">
                        {toFaDigits(r.pages_uploaded)} / {toFaDigits(r.pages_with_text)}
                      </td>
                      <td className="p-2">{r.status === 'published' ? <Badge tone="ok">منتشرشده</Badge> : r.pages_uploaded ? <Badge tone="warn">آمادهٔ انتشار</Badge> : <Badge>منتظر اسکن</Badge>}</td>
                      <td className="p-2">
                        <div className="flex flex-wrap justify-end gap-1">
                          {r.status === 'published' ? (
                            <Link className="btn-ghost inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs" to={`/issue/${r.id}`}>
                              <ExternalLink className="size-3.5" /> مشاهده
                            </Link>
                          ) : (
                            <>
                              <Link className="btn-ghost inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs" to={`/team/${r.publication_id}/issues/${r.id}?tab=media`}>
                                <Upload className="size-3.5" /> بارگذاری اسکن
                              </Link>
                              {canEdit && (
                                <Button className="px-2 py-1 text-xs" disabled={!r.pages_uploaded} onClick={() => setPublishing(r)}>
                                  <Send className="size-3.5" /> انتشار در آرشیو
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Async>
      {open && <RegisterModal onClose={() => setOpen(false)} onDone={() => (setOpen(false), st.reload())} />}
      {publishing && <PublishModal row={publishing} onClose={() => setPublishing(null)} onDone={() => (setPublishing(null), st.reload())} />}
    </div>
  )
}

function RegisterModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const pubs = useAsync(() => api.get<any>('/api/admin/publications'), [])
  const [f, setF] = useState({ publication_id: '', number: '', title: '', jy: '', jm: '', jd: '', label: '', summary: '', keywords: '', toc: '' })
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }))
  const { run, busy } = useAction()
  const en = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\D/g, '')
  const valid = f.publication_id && en(f.number) && f.title.trim().length >= 2 && /^1[34]\d\d$/.test(en(f.jy))
  const submit = async () => {
    const payload = {
      publication_id: f.publication_id,
      number: Number(en(f.number)),
      title: f.title.trim(),
      original_jy: Number(en(f.jy)),
      original_jm: f.jm ? Number(f.jm) : null,
      original_jd: f.jm && en(f.jd) ? Number(en(f.jd)) : null,
      original_label: f.label.trim() || null,
      summary: f.summary.trim() || null,
      keywords: f.keywords,
      toc: parseToc(f.toc)
    }
    if (await run(() => api.post('/api/admin/print-archive', payload), 'شمارهٔ چاپی ثبت شد؛ اکنون اسکن را بارگذاری کنید')) onDone()
  }
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="ثبت شمارهٔ چاپی قدیمی"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>انصراف</Button>
          <Button disabled={busy || !valid} onClick={submit}>
            <Plus className="size-4" /> ثبت
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block sm:col-span-2">
            <span className="label">نشریه</span>
            <Select value={f.publication_id} onChange={(e) => set({ publication_id: e.target.value })} placeholder="انتخاب کنید" options={((pubs.data as any)?.publications || []).map((p: any) => ({ value: p.id, label: p.title }))} />
          </label>
          <label className="block">
            <span className="label">شمارهٔ ترتیبی</span>
            <Input inputMode="numeric" value={f.number} onChange={(e) => set({ number: e.target.value })} />
          </label>
        </div>
        <label className="block">
          <span className="label">عنوان شماره</span>
          <Input value={f.title} maxLength={160} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="label">سال چاپ (شمسی)</span>
            <Input inputMode="numeric" placeholder="۱۳۷۸" value={f.jy} onChange={(e) => set({ jy: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">ماه (اختیاری)</span>
            <Select value={f.jm} onChange={(e) => set({ jm: e.target.value, jd: e.target.value ? f.jd : '' })} placeholder="—" options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
          </label>
          <label className="block">
            <span className="label">روز (اختیاری)</span>
            <Input inputMode="numeric" disabled={!f.jm} value={f.jd} onChange={(e) => set({ jd: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">برچسب تاریخ (اختیاری)</span>
            <Input placeholder="پاییز ۱۳۷۸" maxLength={60} value={f.label} onChange={(e) => set({ label: e.target.value })} />
          </label>
        </div>
        <label className="block">
          <span className="label">خلاصه (اختیاری)</span>
          <Textarea rows={3} maxLength={3000} value={f.summary} onChange={(e) => set({ summary: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">کلیدواژه‌ها (با ویرگول)</span>
          <Input value={f.keywords} onChange={(e) => set({ keywords: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">فهرست مطالب (اختیاری؛ هر خط یک مطلب، صفحه‌ها پس از |)</span>
          <Textarea rows={5} placeholder={'سرمقاله | ۱\nگفت‌وگو با استاد … | ۲-۵'} value={f.toc} onChange={(e) => set({ toc: e.target.value })} />
        </label>
        <p className="text-xs text-muted">هر مطلب فهرست پس از انتشار یک شناسهٔ پایدار (NSH-…) می‌گیرد و در نمایهٔ مقالات و جست‌وجو دیده می‌شود.</p>
      </div>
    </Modal>
  )
}

function PublishModal({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const [pricing, setPricing] = useState('free')
  const [price, setPrice] = useState('')
  const { run, busy } = useAction()
  const submit = async () => {
    const payload = { pricing, price_digital: pricing === 'paid' ? Number(price.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\D/g, '')) : null }
    if (await run(() => api.post(`/api/admin/print-archive/${row.id}/publish`, payload), 'شماره در آرشیو منتشر شد')) onDone()
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={`انتشار «${row.title}» در آرشیو`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>انصراف</Button>
          <Button disabled={busy || (pricing === 'paid' && !price)} onClick={submit}>
            <Send className="size-4" /> انتشار
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          تاریخ انتشار: <b>{row.original_label || faDate(row.original_date)}</b> (تاریخ چاپ اصلی) · {toFaDigits(row.pages_uploaded)} صفحه
          {row.pages_with_text < row.pages_uploaded && <span className="text-amber-700 dark:text-amber-300"> · {toFaDigits(row.pages_uploaded - row.pages_with_text)} صفحه بدون لایهٔ متنی</span>}
        </p>
        <label className="block">
          <span className="label">دسترسی</span>
          <Select value={pricing} onChange={(e) => setPricing(e.target.value)} options={[{ value: 'free', label: 'رایگان (پیشنهادی برای آرشیو)' }, { value: 'paid', label: 'پولی' }]} />
        </label>
        {pricing === 'paid' && (
          <label className="block">
            <span className="label">قیمت نسخهٔ دیجیتال (تومان)</span>
            <Input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
        )}
        <p className="text-xs text-muted">به دنبال‌کنندگان اعلان «شمارهٔ تازه» فرستاده نمی‌شود.</p>
      </div>
    </Modal>
  )
}

import { useRef, useState } from 'react'
import { FileText, ImagePlus, Music, Paperclip, Trash2, Upload, Video } from 'lucide-react'
import { api, mediaUrl, upload } from '../../lib/api'
import { processPdf, pdfFirstPage } from '../../lib/pdf'
import { asFile, prepareImage } from '../../lib/image'
import type { ProcessProgress } from '../../lib/pdf'
import { faDate, fileSize, formatNumber } from '../../lib/format'
import { Badge, Button, Card, Field, Input, Progress, Select, useAction, useToast } from '../../components/ui'
import { Cover } from '../../components/cards'
import type { RoomProps } from './TocTab'

const ROLE_FA: Record<string, string> = { main_pdf: 'نسخهٔ اصلی PDF', cover: 'جلد', gallery: 'گالری تصویر', podcast: 'پادکست / صوت', clip: 'ویدئو', attachment: 'پیوست' }
const ROLE_ICON: Record<string, any> = { main_pdf: FileText, cover: ImagePlus, gallery: ImagePlus, podcast: Music, clip: Video, attachment: Paperclip }
const ACCESS_FA: Record<string, string> = { free: 'رایگان', paid: 'ویژهٔ خریداران', private: 'خصوصی (فقط تیم)' }
const PHASE_FA: Record<string, string> = { reading: 'خواندن فایل', rendering: 'تبدیل صفحه', uploading: 'بارگذاری صفحه', finalizing: 'نهایی‌سازی', done: 'انجام شد' }

export default function MediaTab({ d, reload, pubId }: RoomProps) {
  const issue = d.issue
  const locked = ['awaiting_approval', 'published'].includes(issue.status)
  const { toast, confirm } = useToast()
  const { run } = useAction()
  const pdfInput = useRef<HTMLInputElement>(null)
  const coverInput = useRef<HTMLInputElement>(null)
  const extraInput = useRef<HTMLInputElement>(null)
  const [up, setUp] = useState<{ label: string; ratio: number } | null>(null)
  const [proc, setProc] = useState<ProcessProgress | null>(null)
  const [extra, setExtra] = useState({ role: 'podcast', title: '', access: 'free', toc_item_id: '' })

  const send = async (file: File | Blob, role: string, fields: Record<string, string> = {}, label = 'بارگذاری') => {
    setUp({ label, ratio: 0 })
    try {
      return await upload(`/api/media/upload`, { file, pub: pubId, role, issue: issue.id, ...fields }, (r) => setUp({ label, ratio: r }))
    } finally {
      setUp(null)
    }
  }

  const onPdf = async (file?: File) => {
    if (!file) return
    if (file.type && file.type !== 'application/pdf') return toast('فقط فایل PDF پذیرفته می‌شود', 'error')
    try {
      await send(file, 'main_pdf', { title: file.name }, 'بارگذاری PDF اصلی')
      // auto-cover from page 1 when no cover yet
      if (!issue.cover_key) {
        const blob = await pdfFirstPage(file).catch(() => null)
        if (blob) await send(new File([blob], 'cover.jpg', { type: 'image/jpeg' }), 'cover', {}, 'ساخت جلد از صفحهٔ اول')
      }
      await processPdf(issue.id, file, setProc)
      toast('نسخهٔ دیجیتال آماده شد')
    } catch (e: any) {
      toast(e?.message || 'پردازش ناموفق بود؛ دوباره همان فایل را انتخاب کنید تا از ادامه شروع شود', 'error')
    } finally {
      setProc(null)
      reload()
    }
  }

  const onCover = async (file?: File) => {
    if (!file) return
    try {
      await send(file, 'cover', {}, 'بارگذاری جلد')
      toast('جلد ذخیره شد')
      reload()
    } catch (e: any) {
      toast(e?.message || 'خطا', 'error')
    }
  }

  const onExtra = async (file?: File) => {
    if (!file) return
    try {
      // Gallery photos: downscale + re-encode in the browser (drops EXIF/GPS, much smaller upload).
      if (extra.role === 'gallery' && /^image\/(jpeg|png|webp)$/.test(file.type)) file = asFile(await prepareImage(file, { maxSide: 1800 }), file.name.replace(/\.[^.]+$/, ''))
      await send(file, extra.role, { title: extra.title || file.name, access: extra.access, ...(extra.toc_item_id ? { toc_item_id: extra.toc_item_id } : {}) }, 'بارگذاری فایل')
      toast('فایل افزوده شد')
      setExtra({ ...extra, title: '' })
      reload()
    } catch (e: any) {
      toast(e?.message || 'خطا', 'error')
    }
  }

  const media: any[] = d.media
  const supplementary = media.filter((m) => !['main_pdf', 'cover'].includes(m.role))
  const mainPdf = media.find((m) => m.role === 'main_pdf')

  return (
    <div className="space-y-4">
      {(up || proc) && (
        <Card className="border-brand">
          {up && (
            <div className="text-sm">
              {up.label}… {formatNumber(Math.round(up.ratio * 100))}٪
              <Progress value={up.ratio * 100} className="mt-2" />
            </div>
          )}
          {proc && (
            <div className="mt-2 text-sm">
              {PHASE_FA[proc.phase]} {proc.total ? `${formatNumber(proc.page)} از ${formatNumber(proc.total)}` : ''}
              {proc.skipped > 0 && <span className="text-xs text-muted"> ({formatNumber(proc.skipped)} صفحه از قبل موجود بود)</span>}
              <Progress value={proc.total ? (proc.page / proc.total) * 100 : 0} className="mt-2" />
              <p className="mt-1 text-xs text-muted">تا پایان پردازش این صفحه را نبندید. اگر قطع شد، همان فایل را دوباره انتخاب کنید؛ از صفحهٔ باقی‌مانده ادامه می‌یابد.</p>
            </div>
          )}
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-[180px_1fr]">
        <Card title="جلد">
          <Cover src={mediaUrl(issue.cover_key)} title={issue.title} className="w-full" />
          <input ref={coverInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => onCover(e.target.files?.[0])} />
          <Button variant="ghost" className="mt-3 w-full" disabled={locked || !!up} onClick={() => coverInput.current?.click()} icon={<ImagePlus className="size-4" />}>
            {issue.cover_key ? 'تغییر جلد' : 'بارگذاری جلد'}
          </Button>
        </Card>

        <Card title="نسخهٔ دیجیتال (PDF)">
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              {d.pages_uploaded && issue.page_count ? (
                <Badge tone="ok">آماده — {formatNumber(issue.page_count)} صفحه</Badge>
              ) : d.pages_uploaded ? (
                <Badge tone="warn">ناقص — {formatNumber(d.pages_uploaded)} صفحه پردازش شده</Badge>
              ) : (
                <Badge tone="muted">بارگذاری نشده</Badge>
              )}
              {mainPdf && <span className="text-xs text-muted">{mainPdf.title} · {fileSize(mainPdf.size_bytes)}</span>}
            </div>
            <p className="text-xs leading-6 text-muted">
              فایل PDF در همین مرورگر به تصاویر صفحه تبدیل می‌شود؛ خوانندگان فقط تصویر صفحات را با نشان‌آب شخصی می‌بینند و فایل اصلی هرگز در دسترس عموم قرار نمی‌گیرد. حداکثر حجم ۹۵ مگابایت.
            </p>
            <input ref={pdfInput} type="file" accept="application/pdf" hidden onChange={(e) => { onPdf(e.target.files?.[0]); e.target.value = '' }} />
            <Button disabled={locked || !!up || !!proc} onClick={() => pdfInput.current?.click()} icon={<Upload className="size-4" />}>
              {d.pages_uploaded ? 'جایگزینی / ادامهٔ پردازش PDF' : 'انتخاب فایل PDF'}
            </Button>
            {locked && <p className="text-xs text-amber-700 dark:text-amber-300">شماره در انتظار تأیید یا منتشرشده است؛ نسخهٔ اصلی و جلد قفل‌اند.</p>}
          </div>
        </Card>
      </div>

      <Card title="محتوای تکمیلی (پادکست، ویدئو، گالری، پیوست)">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="نوع">
            <Select value={extra.role} onChange={(e) => setExtra({ ...extra, role: e.target.value })} options={['podcast', 'clip', 'gallery', 'attachment'].map((r) => ({ value: r, label: ROLE_FA[r] }))} />
          </Field>
          <Field label="عنوان">
            <Input value={extra.title} onChange={(e) => setExtra({ ...extra, title: e.target.value })} placeholder="اختیاری" />
          </Field>
          <Field label="دسترسی">
            <Select value={extra.access} onChange={(e) => setExtra({ ...extra, access: e.target.value })} options={Object.entries(ACCESS_FA).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="مرتبط با بخش">
            <Select value={extra.toc_item_id} placeholder="—" onChange={(e) => setExtra({ ...extra, toc_item_id: e.target.value })} options={d.toc.map((t: any) => ({ value: t.id, label: t.title }))} />
          </Field>
        </div>
        <input ref={extraInput} type="file" hidden onChange={(e) => { onExtra(e.target.files?.[0]); e.target.value = '' }} />
        <Button variant="ghost" className="mt-3" disabled={!!up} onClick={() => extraInput.current?.click()} icon={<Upload className="size-4" />}>
          انتخاب فایل
        </Button>

        {supplementary.length > 0 && (
          <ul className="mt-4 divide-y divide-line text-sm">
            {supplementary.map((m) => {
              const Icon = ROLE_ICON[m.role] || Paperclip
              return (
                <li key={m.id} className="flex items-center gap-3 py-2">
                  <Icon className="size-5 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <a href={mediaUrl(m.storage_key)} target="_blank" rel="noreferrer" className="block truncate hover:text-brand">{m.title || ROLE_FA[m.role]}</a>
                    <div className="text-xs text-muted">{ROLE_FA[m.role] || m.role} · {ACCESS_FA[m.access] || m.access} · {fileSize(m.size_bytes)} · {faDate(m.created_at)}</div>
                  </div>
                  <button
                    className="rounded p-1 text-danger hover:bg-surface-2"
                    aria-label="حذف"
                    onClick={async () => {
                      if (!(await confirm('این فایل حذف شود؟', { danger: true, okLabel: 'حذف' }))) return
                      const r = await run(() => api.del(`/api/media/${m.id}`), 'حذف شد')
                      if (r) reload()
                    }}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}

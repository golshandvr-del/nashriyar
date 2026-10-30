import { useState } from 'react'
import { Download, Trash2, Upload } from 'lucide-react'
import { api } from '../lib/api'
import { faDate, toFaDigits } from '../../shared/fa'
import { Async, Badge, Button, Card, useAction, useAsync } from '../components/ui'

type Row = { student_number: string; secret_kind: string | null; used_at: string | null; created_at: string }

/** Registration allowlist (SECURITY.md §2): CSV of student numbers [+ national id] or generated activation codes. */
export default function AllowlistCard() {
  const st = useAsync(() => api.get<{ items: Row[]; total: number; used: number; mode: string }>('/api/admin/registration-allowlist'), [])
  const [csv, setCsv] = useState('')
  const [withCodes, setWithCodes] = useState(false)
  const [codes, setCodes] = useState<{ student_number: string; code: string }[]>([])
  const { busy, run } = useAction()

  const readFile = async (f: File | undefined) => {
    if (f) setCsv(await f.text())
  }
  const upload = async () => {
    const r = await run(() => api.post<{ added: number; skipped: number; codes: { student_number: string; code: string }[] }>('/api/admin/registration-allowlist', { csv, activation_codes: withCodes }))
    if (r) {
      setCodes(r.codes)
      setCsv('')
      st.reload()
    }
  }
  const remove = async (sn: string) => {
    if (await run(() => api.del(`/api/admin/registration-allowlist/${sn}`), 'حذف شد')) st.reload()
  }
  const downloadCodes = () => {
    const blob = new Blob(['\ufeffstudent_number,activation_code\n' + codes.map((c) => `${c.student_number},${c.code}`).join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'activation-codes.csv'
    a.click()
  }

  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-lg font-bold">فهرست مجاز ثبت‌نام</h2>
      <p className="text-sm leading-6 text-muted">
        هر سطر: <code dir="ltr">شماره‌دانشجویی[,کدملی]</code>. اگر کد ملی بدهید، دانشجو هنگام ثبت‌نام باید همان را وارد کند. با گزینهٔ «کد فعال‌سازی» برای هر شماره کدی
        تصادفی ساخته می‌شود که <b>فقط همین یک بار</b> نمایش داده می‌شود. این فهرست فقط وقتی اعمال می‌شود که «روش ثبت‌نام» روی «فهرست مجاز» باشد.
      </p>
      <textarea
        dir="ltr"
        className="input min-h-28 font-mono text-sm"
        placeholder={'40012345,0012345678\n40012346'}
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn btn-ghost cursor-pointer">
          <Upload className="size-4" /> انتخاب فایل CSV
          <input type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={(e) => readFile(e.target.files?.[0])} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={withCodes} onChange={(e) => setWithCodes(e.target.checked)} /> ساخت کد فعال‌سازی برای هر شماره
        </label>
        <Button loading={busy} disabled={!csv.trim()} onClick={upload}>
          افزودن به فهرست
        </Button>
      </div>
      {codes.length > 0 && (
        <div className="rounded-xl border border-brand bg-brand-soft p-3">
          <div className="mb-2 flex items-center justify-between">
            <b className="text-sm">{toFaDigits(codes.length)} کد فعال‌سازی (فقط همین یک بار)</b>
            <Button onClick={downloadCodes}>
              <Download className="size-4" /> دریافت CSV
            </Button>
          </div>
          <ul dir="ltr" className="max-h-40 overflow-auto font-mono text-xs leading-6">
            {codes.slice(0, 200).map((c) => (
              <li key={c.student_number}>
                {c.student_number} — {c.code}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Async state={st}>
        {(d) => (
          <div>
            <div className="mb-2 flex flex-wrap gap-2 text-sm">
              <Badge tone={d.mode === 'allowlist' ? 'ok' : 'muted'}>{d.mode === 'allowlist' ? 'فعال' : 'غیرفعال (ثبت‌نام آزاد)'}</Badge>
              <span>کل: {toFaDigits(d.total)}</span>
              <span>ثبت‌نام‌کرده: {toFaDigits(d.used || 0)}</span>
            </div>
            {d.items.length > 0 && (
              <ul className="max-h-64 divide-y divide-line overflow-auto rounded-xl border border-line text-sm">
                {d.items.map((r) => (
                  <li key={r.student_number} className="flex items-center gap-2 px-3 py-1.5">
                    <span dir="ltr" className="font-mono">
                      {r.student_number}
                    </span>
                    {r.secret_kind && <Badge>{r.secret_kind === 'national_id' ? 'کد ملی' : 'کد فعال‌سازی'}</Badge>}
                    {r.used_at ? <Badge tone="ok">ثبت‌نام: {faDate(r.used_at)}</Badge> : null}
                    <button className="ms-auto p-1 text-muted hover:text-red-600" aria-label="حذف" onClick={() => remove(r.student_number)}>
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Async>
    </Card>
  )
}

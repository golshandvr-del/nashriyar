import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Plus, Trash2 } from 'lucide-react'
import { api, mediaUrl, upload } from '../lib/api'
import { asFile, prepareImage } from '../lib/image'
import { FREQUENCY, faDate } from '../lib/format'
import { Async, Avatar, Button, Card, Field, Input, PageHeader, Select, Textarea, useAction, useAsync, useToast } from '../components/ui'
import { useTeam } from './Layout'

const CONTACT_KINDS = [
  { value: 'telegram', label: 'تلگرام' },
  { value: 'bale', label: 'بله' },
  { value: 'eitaa', label: 'ایتا' },
  { value: 'instagram', label: 'اینستاگرام' },
  { value: 'email', label: 'ایمیل' },
  { value: 'website', label: 'وب‌سایت' },
  { value: 'phone', label: 'تلفن' },
  { value: 'other', label: 'سایر' }
]

export default function TeamProfile() {
  const { pubId } = useTeam()
  const st = useAsync(() => api.get(`/api/team/${pubId}/dashboard`), [pubId])
  return (
    <div>
      <PageHeader title="پروفایل نشریه" subtitle="مشخصات رسمی (نام، مجوز، صاحب امتیاز) را فقط مسئول نشریات تغییر می‌دهد." />
      <Async state={st}>{(d: any) => <ProfileForm pubId={pubId} p={d.publication} onSaved={st.reload} />}</Async>
    </div>
  )
}

function ProfileForm({ pubId, p, onSaved }: { pubId: string; p: any; onSaved: () => void }) {
  const { toast } = useToast()
  const { busy, run } = useAction()
  const [f, setF] = useState({ tagline: p.tagline || '', description: p.description || '', keywords: (p.keywords || '').split('،').filter(Boolean).join('، '), theme_color: p.theme_color || '#0f766e' })
  const [contacts, setContacts] = useState<{ kind: string; value: string; label: string }[]>(() => {
    try {
      return JSON.parse(p.contacts_json || '[]')
    } catch {
      return []
    }
  })
  const [logo, setLogo] = useState<string | null>(p.logo_key)
  const [logoBusy, setLogoBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => setLogo(p.logo_key), [p.logo_key])

  const onLogo = async (file?: File) => {
    if (!file) return
    setLogoBusy(true)
    try {
      const blob = await prepareImage(file, { aspect: '1:1', maxSide: 512 })
      const r = await upload(`/api/media/upload`, { file: asFile(blob, 'logo'), pub: pubId, role: 'logo' })
      setLogo(r.key)
      toast('لوگو به‌روزرسانی شد')
    } catch (e: any) {
      toast(e?.message || 'بارگذاری ناموفق بود', 'error')
    } finally {
      setLogoBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const save = () =>
    run(async () => {
      await api.put(`/api/team/${pubId}/profile`, { ...f, contacts: contacts.filter((c) => c.value.trim()) })
      onSaved()
    }, 'پروفایل ذخیره شد')

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card title="معرفی">
          <div className="space-y-3">
            <Field label="شعار کوتاه" hint="حداکثر ۱۴۰ نویسه؛ زیر نام نشریه نمایش داده می‌شود.">
              <Input value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} maxLength={140} />
            </Field>
            <Field label="معرفی نشریه">
              <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={3000} rows={7} />
            </Field>
            <Field label="کلیدواژه‌ها" hint="با ویرگول جدا کنید؛ در جست‌وجو استفاده می‌شوند.">
              <Input value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} />
            </Field>
            <Field label="رنگ شاخص">
              <div className="flex items-center gap-3">
                <input type="color" value={f.theme_color} onChange={(e) => setF({ ...f, theme_color: e.target.value })} className="h-10 w-16 cursor-pointer rounded-lg border border-line bg-transparent" aria-label="رنگ شاخص" />
                <span className="font-mono text-sm" dir="ltr">
                  {f.theme_color}
                </span>
              </div>
            </Field>
          </div>
        </Card>
        <Card
          title="راه‌های ارتباط و خرید"
          action={
            <Button variant="ghost" icon={<Plus className="size-4" />} disabled={contacts.length >= 10} onClick={() => setContacts([...contacts, { kind: 'telegram', value: '', label: '' }])}>
              افزودن
            </Button>
          }
        >
          {!contacts.length && <p className="text-sm text-muted">مثلاً شناسهٔ تلگرام برای خرید کد یا صفحهٔ اینستاگرام نشریه.</p>}
          <div className="space-y-2">
            {contacts.map((c, i) => (
              <div key={i} className="grid grid-cols-[8rem_1fr_auto] gap-2 sm:grid-cols-[8rem_1fr_10rem_auto]">
                <Select value={c.kind} onChange={(e) => setContacts(contacts.map((x, k) => (k === i ? { ...x, kind: e.target.value } : x)))} options={CONTACT_KINDS} />
                <Input value={c.value} dir="ltr" placeholder="@nashriye" onChange={(e) => setContacts(contacts.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)))} />
                <Input className="hidden sm:block" value={c.label} placeholder="برچسب (اختیاری)" onChange={(e) => setContacts(contacts.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} />
                <button className="rounded-lg p-2 text-danger hover:bg-surface-2" onClick={() => setContacts(contacts.filter((_, k) => k !== i))} aria-label="حذف">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        </Card>
        <div className="flex justify-end">
          <Button loading={busy} onClick={save}>
            ذخیرهٔ تغییرات
          </Button>
        </div>
      </div>
      <div className="space-y-4">
        <Card title="لوگو">
          <div className="flex flex-col items-center gap-3">
            <Avatar src={mediaUrl(logo)} name={p.title} size={112} color={f.theme_color} />
            <Button variant="ghost" icon={<ImagePlus className="size-4" />} loading={logoBusy} onClick={() => fileRef.current?.click()}>
              تغییر لوگو
            </Button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => onLogo(e.target.files?.[0])} />
            <p className="text-center text-[11px] text-muted">مربعی برش داده می‌شود (۵۱۲×۵۱۲).</p>
          </div>
        </Card>
        <Card title="مشخصات رسمی">
          <dl className="space-y-2 text-sm">
            <Row k="نام" v={p.title} />
            <Row k="نشانی" v={<span dir="ltr">/p/{p.slug}</span>} />
            <Row k="دورهٔ انتشار" v={FREQUENCY[p.frequency] || '—'} />
            <Row k="شمارهٔ مجوز" v={p.license_number || '—'} />
            <Row k="تاریخ مجوز" v={faDate(p.license_issued_at)} />
            <Row k="انقضای مجوز" v={faDate(p.license_expires_at)} />
          </dl>
        </Card>
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted">{k}</dt>
      <dd className="text-left font-medium">{v}</dd>
    </div>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { api } from '../lib/api'
import { ASSOC_KIND, FREQUENCY } from '../lib/format'
import { Async, Button, Card, Field, Input, PageHeader, Select, Textarea, useAction, useAsync } from '../components/ui'

const ROLES = [
  { key: 'managing_director', label: 'مدیرمسئول' },
  { key: 'editor_in_chief', label: 'سردبیر' },
  { key: 'license_holder', label: 'صاحب امتیاز (نمایندهٔ انجمن)' }
] as const

interface Account { mode: 'new' | 'existing'; display_name: string; username: string; student_number: string; existing_user_id: string }
const emptyAcc = (): Account => ({ mode: 'new', display_name: '', username: '', student_number: '', existing_user_id: '' })

export interface Credential { role_fa?: string; name: string; username: string; password: string }

/** Printable sheet of one-time credentials (shown once, never stored in plain text). */
export function CredentialsSheet({ title, items, onDone }: { title: string; items: Credential[]; onDone?: () => void }) {
  return (
    <div className="space-y-4">
      <div className="card print-area space-y-3 p-5">
        <h2 className="text-lg font-extrabold">{title}</h2>
        <p className="text-sm text-muted">این رمزها موقت‌اند و در اولین ورود باید تغییر داده شوند. این برگه را فقط یک بار می‌بینید؛ آن را چاپ یا ذخیره کنید.</p>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="p-2 text-right">نقش</th>
              <th className="p-2 text-right">نام</th>
              <th className="p-2 text-right">نام کاربری</th>
              <th className="p-2 text-right">رمز موقت</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c, i) => (
              <tr key={i} className="border-t border-line">
                <td className="p-2">{c.role_fa || '—'}</td>
                <td className="p-2">{c.name}</td>
                <td className="p-2 font-mono" dir="ltr">{c.username}</td>
                <td className="p-2 font-mono font-bold" dir="ltr">{c.password}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted">آدرس ورود: {location.origin}/login</p>
      </div>
      <div className="no-print flex gap-2">
        <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>چاپ برگهٔ ورود</Button>
        {onDone && <Button variant="ghost" onClick={onDone}>ادامه</Button>}
      </div>
    </div>
  )
}

export default function AdminPublicationNew() {
  const st = useAsync(() => Promise.all([api.get('/api/admin/structure'), api.get('/api/admin/categories'), api.get('/api/admin/team-users')]), [])
  const { busy, run } = useAction()
  const [f, setF] = useState({ title: '', slug: '', tagline: '', description: '', association_id: '', faculty_id: '', license_number: '', license_issued_at: '', license_expires_at: '', frequency: 'irregular', theme_color: '#0f766e', keywords: '' })
  const [cats, setCats] = useState<string[]>([])
  const [acc, setAcc] = useState<Record<string, Account>>({ managing_director: emptyAcc(), editor_in_chief: emptyAcc(), license_holder: emptyAcc() })
  const [result, setResult] = useState<{ id: string; credentials: Credential[] } | null>(null)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const setA = (role: string, patch: Partial<Account>) => setAcc({ ...acc, [role]: { ...acc[role], ...patch } })

  if (result)
    return (
      <div>
        <PageHeader title="نشریه ساخته شد" />
        <CredentialsSheet title={`برگهٔ ورود ارکان «${f.title}»`} items={result.credentials} />
        <Link to={`/admin/publications/${result.id}`} className="btn-ghost no-print mt-3">رفتن به پروندهٔ نشریه</Link>
      </div>
    )

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const accounts: Record<string, any> = {}
    for (const r of ROLES) {
      const a = acc[r.key]
      accounts[r.key] = a.mode === 'existing' ? { existing_user_id: a.existing_user_id, display_name: a.display_name } : { display_name: a.display_name, username: a.username || undefined, student_number: a.student_number || undefined }
    }
    const r = await run(() => api.post('/api/admin/publications', { ...f, category_ids: cats, accounts }), 'نشریه ساخته شد')
    if (r) setResult({ id: r.id, credentials: r.credentials })
  }

  return (
    <div>
      <PageHeader title="تعریف نشریهٔ جدید" subtitle="مشخصات نشریه و سه حساب اصلی (مدیرمسئول، سردبیر، صاحب امتیاز)" back={<Link to="/admin/publications" className="text-sm text-muted">← نشریات</Link>} />
      <Async state={st}>
        {([s, c, tu]: any) => {
          const assoc = s.associations.find((a: any) => a.id === f.association_id)
          return (
            <form onSubmit={submit} className="space-y-4">
              <Card title="مشخصات">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="نام نشریه *"><Input value={f.title} onChange={set('title')} required minLength={2} maxLength={120} /></Field>
                  <Field label="نامک (slug)" hint="خالی = ساخت خودکار از نام"><Input value={f.slug} onChange={set('slug')} dir="ltr" maxLength={60} /></Field>
                  <Field label="شعار"><Input value={f.tagline} onChange={set('tagline')} maxLength={140} /></Field>
                  <Field label="دورهٔ انتشار">
                    <Select value={f.frequency} onChange={set('frequency')} options={Object.entries(FREQUENCY).map(([value, label]) => ({ value, label }))} />
                  </Field>
                  <Field label="انجمن/کانون صاحب امتیاز *">
                    <Select
                      value={f.association_id}
                      onChange={(e) => {
                        const a = s.associations.find((x: any) => x.id === e.target.value)
                        setF({ ...f, association_id: e.target.value, faculty_id: a?.faculty_id || f.faculty_id })
                      }}
                      required
                      placeholder="انتخاب کنید"
                      options={s.associations.filter((a: any) => a.is_active).map((a: any) => ({ value: a.id, label: `${a.name} — ${ASSOC_KIND[a.kind] || ''}${a.faculty_name ? ' · ' + a.faculty_name : ''}` }))}
                    />
                  </Field>
                  <Field label="دانشکده" hint={assoc?.faculty_name ? `پیش‌فرض: دانشکدهٔ انجمن (${assoc.faculty_name})` : undefined}>
                    <Select value={f.faculty_id} onChange={set('faculty_id')} placeholder="بدون دانشکده (دانشگاهی)" options={s.faculties.map((x: any) => ({ value: x.id, label: x.name }))} />
                  </Field>
                  <Field label="شمارهٔ مجوز"><Input value={f.license_number} onChange={set('license_number')} maxLength={40} /></Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="تاریخ صدور"><Input type="date" dir="ltr" value={f.license_issued_at} onChange={set('license_issued_at')} /></Field>
                    <Field label="تاریخ انقضا"><Input type="date" dir="ltr" value={f.license_expires_at} onChange={set('license_expires_at')} /></Field>
                  </div>
                  <Field label="کلیدواژه‌ها" hint="با ویرگول جدا کنید"><Input value={f.keywords} onChange={set('keywords')} /></Field>
                  <Field label="رنگ شاخص"><input type="color" value={f.theme_color} onChange={set('theme_color')} className="h-10 w-20 cursor-pointer rounded-lg border border-line" /></Field>
                </div>
                <div className="mt-3">
                  <Field label="معرفی"><Textarea value={f.description} onChange={set('description')} maxLength={3000} /></Field>
                </div>
              </Card>

              <Card title="دسته‌بندی‌ها" action={<span className="text-xs text-muted">حداکثر ۱۵</span>}>
                <div className="flex flex-wrap gap-2">
                  {c.categories.filter((x: any) => x.is_active).map((x: any) => {
                    const on = cats.includes(x.id)
                    return (
                      <button type="button" key={x.id} onClick={() => setCats(on ? cats.filter((i) => i !== x.id) : cats.length < 15 ? [...cats, x.id] : cats)} className={on ? 'chip border-brand bg-brand-soft text-brand' : 'chip'}>
                        {x.name}
                      </button>
                    )
                  })}
                </div>
              </Card>

              <Card title="حساب‌های ارکان نشریه">
                <div className="grid gap-4 lg:grid-cols-3">
                  {ROLES.map((r) => {
                    const a = acc[r.key]
                    return (
                      <div key={r.key} className="space-y-2 rounded-xl border border-line p-3">
                        <div className="font-bold">{r.label}</div>
                        <div className="flex gap-3 text-sm">
                          <label className="flex items-center gap-1"><input type="radio" checked={a.mode === 'new'} onChange={() => setA(r.key, { mode: 'new' })} /> حساب جدید</label>
                          <label className="flex items-center gap-1"><input type="radio" checked={a.mode === 'existing'} onChange={() => setA(r.key, { mode: 'existing' })} /> حساب موجود</label>
                        </div>
                        <Field label="نام و نام خانوادگی *"><Input value={a.display_name} onChange={(e) => setA(r.key, { display_name: e.target.value })} required minLength={2} /></Field>
                        {a.mode === 'new' ? (
                          <>
                            <Field label="نام کاربری" hint="خالی = ساخت خودکار"><Input value={a.username} onChange={(e) => setA(r.key, { username: e.target.value })} dir="ltr" /></Field>
                            <Field label="شمارهٔ دانشجویی"><Input value={a.student_number} onChange={(e) => setA(r.key, { student_number: e.target.value })} dir="ltr" inputMode="numeric" /></Field>
                          </>
                        ) : (
                          <Field label="انتخاب حساب تیمی">
                            <Select value={a.existing_user_id} onChange={(e) => setA(r.key, { existing_user_id: e.target.value })} required placeholder="انتخاب کنید" options={tu.users.map((u: any) => ({ value: u.id, label: `${u.display_name} (${u.username})` }))} />
                          </Field>
                        )}
                      </div>
                    )
                  })}
                </div>
              </Card>
              <div className="flex justify-end">
                <Button type="submit" loading={busy}>ساخت نشریه و حساب‌ها</Button>
              </div>
            </form>
          )
        }}
      </Async>
    </div>
  )
}

// «پروفایل من» (ROADMAP phase 15): full profile with validation, consent for sensitive fields,
// current positions and collaboration history.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck, UserRound } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth, ROLE_LABEL, PUB_ROLE_LABEL } from '../lib/auth'
import { faDate, formatNumber } from '../lib/format'
import { toEnDigits } from '../../shared/fa'
import { Async, Badge, Button, Card, Field, Input, Progress, Select, Textarea, useAction, useAsync } from '../components/ui'

export const DEGREE_LABEL: Record<string, string> = { associate: 'کاردانی', bachelor: 'کارشناسی', master: 'کارشناسی ارشد', phd: 'دکتری' }
export const GENDER_LABEL: Record<string, string> = { male: 'مرد', female: 'زن' }

const FIELD_LABEL: Record<string, string> = {
  display_name: 'نام',
  faculty_id: 'دانشکده',
  gender: 'جنسیت',
  degree: 'مقطع',
  entry_year: 'سال ورود',
  student_number: 'شمارهٔ دانشجویی'
}

type Meta = { faculties: { id: string; name: string }[]; majors: { id: string; name: string; faculty_id: string }[] }
type Form = Record<'display_name' | 'faculty_id' | 'major_id' | 'gender' | 'degree' | 'entry_year' | 'birth_year' | 'student_number' | 'phone' | 'email' | 'bio', string>

const EMPTY: Form = { display_name: '', faculty_id: '', major_id: '', gender: '', degree: '', entry_year: '', birth_year: '', student_number: '', phone: '', email: '', bio: '' }

/** Client-side checks mirroring the server (the server stays authoritative). */
function check(f: Form): Partial<Record<keyof Form, string>> {
  const e: Partial<Record<keyof Form, string>> = {}
  if (f.display_name.trim().length < 2) e.display_name = 'نام حداقل ۲ نویسه'
  const ph = toEnDigits(f.phone).replace(/[\s-]/g, '')
  if (ph && !/^09\d{9}$/.test(ph)) e.phone = '۱۱ رقم و با ۰۹ شروع شود'
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = 'رایانامه نامعتبر است'
  const sn = toEnDigits(f.student_number.trim())
  if (sn && !/^\d{6,14}$/.test(sn)) e.student_number = '۶ تا ۱۴ رقم'
  const by = Number(toEnDigits(f.birth_year)), ey = Number(toEnDigits(f.entry_year))
  if (f.birth_year && f.entry_year && ey - by < 15) e.entry_year = 'با سال تولد سازگار نیست'
  return e
}

export default function ProfileForm() {
  const { refresh } = useAuth()
  const st = useAsync(() => api.get('/api/me/profile'), [])
  const [meta, setMeta] = useState<Meta>({ faculties: [], majors: [] })
  const [f, setF] = useState<Form>(EMPTY)
  const [consent, setConsent] = useState(false)
  const { busy, run } = useAction()
  useEffect(() => {
    api.get('/api/public/categories').then((r) => setMeta({ faculties: r.faculties || [], majors: r.majors || [] })).catch(() => {})
  }, [])
  useEffect(() => {
    if (!st.data) return
    const u = st.data.user
    const s = (v: unknown) => (v == null ? '' : String(v))
    setF({
      display_name: s(u.display_name), faculty_id: s(u.faculty_id), major_id: s(u.major_id), gender: s(u.gender), degree: s(u.degree),
      entry_year: s(u.entry_year), birth_year: s(u.birth_year), student_number: s(u.student_number), phone: s(u.phone), email: s(u.email), bio: s(u.bio)
    })
    setConsent(!!u.profile_consent_at)
  }, [st.data])
  const errs = useMemo(() => check(f), [f])
  const majors = meta.majors.filter((m) => !f.faculty_id || m.faculty_id === f.faculty_id)
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((o) => ({ ...o, [k]: e.target.value, ...(k === 'faculty_id' ? { major_id: '' } : {}) }))
  const sensitiveFilled = !!(f.gender || f.birth_year || f.phone || f.email)

  const save = async (hadConsent: boolean) => {
    const payload: Record<string, unknown> = { ...f, display_name: f.display_name.trim() }
    if (!hadConsent && consent) payload.consent = true
    if (hadConsent || !consent) {
      // without consent the sensitive fields are not sent at all
      if (!hadConsent) for (const k of ['gender', 'birth_year', 'phone', 'email']) delete payload[k]
    }
    if (st.data?.user.student_number) delete payload.student_number // locked once set
    const r = await run(() => api.post<{ complete: boolean }>('/api/me/profile', payload), 'پروفایل ذخیره شد')
    if (r) {
      await refresh()
      st.reload()
    }
  }

  const withdraw = async () => {
    if (!window.confirm('رضایت پس گرفته شود؟ جنسیت، سال تولد، تلفن و رایانامهٔ شما پاک می‌شود.')) return
    if (await run(() => api.post('/api/me/profile/consent', { consent: false }), 'رضایت پس گرفته شد و اطلاعات حساس پاک شد')) st.reload()
  }

  return (
    <Card title="پروفایل من">
      <Async state={st}>
        {(d: any) => {
          const hadConsent = !!d.user.profile_consent_at
          const required: string[] = d.required || []
          const filled = required.filter((k) => !!(f as any)[k]).length
          const missing = required.filter((k) => !(f as any)[k])
          return (
            <div className="space-y-4" id="profile-form">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge tone="brand">{ROLE_LABEL[d.user.system_role as keyof typeof ROLE_LABEL] || d.user.system_role}</Badge>
                <Badge>نام کاربری: {d.user.username}</Badge>
                {d.complete ? <Badge tone="ok">پروفایل کامل</Badge> : <Badge tone="warn">پروفایل ناقص</Badge>}
              </div>
              {!d.complete && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-900/20" role="status">
                  <div className="mb-2 font-bold">تکمیل پروفایل: {formatNumber(filled)} از {formatNumber(required.length)}</div>
                  <Progress value={required.length ? filled / required.length : 0} />
                  {missing.length > 0 && <p className="mt-2 text-xs text-muted">باقی‌مانده: {missing.map((k) => FIELD_LABEL[k] || k).join('، ')}</p>}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <Link to="/library" className="rounded-xl bg-surface-2 p-2">
                  <div className="text-lg font-extrabold">{formatNumber(d.stats.library)}</div>کتابخانه
                </Link>
                <Link to="/following" className="rounded-xl bg-surface-2 p-2">
                  <div className="text-lg font-extrabold">{formatNumber(d.stats.following)}</div>دنبال‌شده
                </Link>
                <Link to="/library?tab=saved" className="rounded-xl bg-surface-2 p-2">
                  <div className="text-lg font-extrabold">{formatNumber(d.stats.saved)}</div>ذخیره‌شده
                </Link>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="نام و نام خانوادگی *" error={errs.display_name}>
                  <Input name="display_name" value={f.display_name} onChange={set('display_name')} maxLength={80} />
                </Field>
                <Field label="شمارهٔ دانشجویی *" error={errs.student_number} hint={d.user.student_number ? 'تغییر فقط توسط مسئول نشریات' : 'یکتا؛ پس از ثبت قفل می‌شود'}>
                  <Input name="student_number" inputMode="numeric" dir="ltr" value={f.student_number} onChange={set('student_number')} disabled={!!d.user.student_number} />
                </Field>
                <Field label="دانشکده *">
                  <Select name="faculty_id" value={f.faculty_id} onChange={set('faculty_id')} placeholder="انتخاب کنید" options={meta.faculties.map((x) => ({ value: x.id, label: x.name }))} />
                </Field>
                <Field label="رشته">
                  <Select name="major_id" value={f.major_id} onChange={set('major_id')} placeholder={majors.length ? 'انتخاب کنید' : 'رشته‌ای تعریف نشده'} options={majors.map((x) => ({ value: x.id, label: x.name }))} />
                </Field>
                <Field label="مقطع تحصیلی *">
                  <Select name="degree" value={f.degree} onChange={set('degree')} placeholder="انتخاب کنید" options={Object.entries(DEGREE_LABEL).map(([value, label]) => ({ value, label }))} />
                </Field>
                <Field label="سال ورود (شمسی) *" error={errs.entry_year}>
                  <Input name="entry_year" inputMode="numeric" dir="ltr" placeholder="۱۴۰۲" value={f.entry_year} onChange={set('entry_year')} maxLength={4} />
                </Field>
              </div>
              <Field label="معرفی کوتاه" hint="حداکثر ۳۰۰ نویسه">
                <Textarea name="bio" rows={2} value={f.bio} onChange={set('bio')} maxLength={300} />
              </Field>

              <fieldset className="space-y-3 rounded-2xl border border-line p-3">
                <legend className="flex items-center gap-1 px-1 text-sm font-bold">
                  <ShieldCheck className="size-4 text-brand" /> اطلاعات حساس
                </legend>
                <p className="text-xs text-muted">جنسیت، سال تولد، تلفن و رایانامه فقط برای خود شما و مسئول نشریات قابل مشاهده است و فقط با رضایت شما ذخیره می‌شود.</p>
                {!hadConsent && (
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="consent" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
                    با ذخیرهٔ این اطلاعات برای امور نشریات دانشگاه موافقم.
                  </label>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="جنسیت *">
                    <Select name="gender" value={f.gender} onChange={set('gender')} disabled={!hadConsent && !consent} placeholder="انتخاب کنید" options={Object.entries(GENDER_LABEL).map(([value, label]) => ({ value, label }))} />
                  </Field>
                  <Field label="سال تولد (شمسی)">
                    <Input name="birth_year" inputMode="numeric" dir="ltr" placeholder="۱۳۸۲" value={f.birth_year} onChange={set('birth_year')} disabled={!hadConsent && !consent} maxLength={4} />
                  </Field>
                  <Field label="تلفن همراه" error={errs.phone}>
                    <Input name="phone" inputMode="tel" dir="ltr" placeholder="09121234567" value={f.phone} onChange={set('phone')} disabled={!hadConsent && !consent} maxLength={13} />
                  </Field>
                  <Field label="رایانامه" error={errs.email}>
                    <Input name="email" type="email" dir="ltr" value={f.email} onChange={set('email')} disabled={!hadConsent && !consent} maxLength={120} />
                  </Field>
                </div>
                {hadConsent && (
                  <button type="button" onClick={withdraw} className="text-xs text-red-600 underline">
                    پس گرفتن رضایت و حذف اطلاعات حساس
                  </button>
                )}
                {!hadConsent && !consent && sensitiveFilled && <p className="text-xs text-amber-700">بدون رضایت، این فیلدها ذخیره نمی‌شوند.</p>}
              </fieldset>

              <Button loading={busy} disabled={Object.keys(errs).length > 0} onClick={() => save(hadConsent)}>
                ذخیرهٔ پروفایل
              </Button>

              <section className="space-y-2" aria-labelledby="positions-h">
                <h3 id="positions-h" className="flex items-center gap-1 text-sm font-bold">
                  <UserRound className="size-4" /> سمت‌های فعلی
                </h3>
                {d.positions.length ? (
                  <div className="flex flex-wrap gap-2">
                    {d.positions.map((p: any) => (
                      <Badge key={p.publication_id + p.role} tone="ok">
                        {PUB_ROLE_LABEL[p.role] || 'عضو تیم'} «{p.title}»
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted">سمتی در نشریه‌ها ندارید.</p>
                )}
              </section>
              <section className="space-y-2" aria-labelledby="history-h">
                <h3 id="history-h" className="text-sm font-bold">سابقهٔ همکاری</h3>
                {d.memberships.length ? (
                  <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                    {d.memberships.map((m: any) => (
                      <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                        <span className="min-w-0">
                          <Link to={`/p/${m.slug}`} className="font-bold hover:text-brand">{m.title}</Link>
                          {m.default_role && <span className="text-muted"> · {m.default_role}</span>}
                        </span>
                        <span className="flex flex-wrap gap-1 text-xs">
                          {m.is_active ? <Badge tone="ok">فعال</Badge> : <Badge>پایان همکاری{m.left_at ? ` ${faDate(m.left_at)}` : ''}</Badge>}
                          {m.joined_at && <Badge>از {faDate(m.joined_at)}</Badge>}
                          {m.certificates > 0 && <Badge tone="brand">{formatNumber(m.certificates)} گواهی</Badge>}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted">هنوز سابقهٔ همکاری ثبت نشده است.</p>
                )}
              </section>
            </div>
          )
        }}
      </Async>
    </Card>
  )
}

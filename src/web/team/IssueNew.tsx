import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Plus, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { cx, formatNumber } from '../lib/format'
import { Button, Card, Field, Input, PageHeader, Select, Textarea, useAction } from '../components/ui'
import { useTeam } from './Layout'

interface TocRow {
  key: string
  title: string
  kind: string
  due_at: string
  assignments: { member_id: string; role: string }[]
}

const KINDS = [
  { value: 'article', label: 'مقاله' },
  { value: 'interview', label: 'گفت‌وگو' },
  { value: 'report', label: 'گزارش' },
  { value: 'story', label: 'داستان' },
  { value: 'poem', label: 'شعر' },
  { value: 'editorial', label: 'سرمقاله' },
  { value: 'translation', label: 'ترجمه' },
  { value: 'other', label: 'سایر' }
]
const ASSIGN_ROLES = [
  { value: 'author', label: 'نویسنده' },
  { value: 'editor', label: 'ویراستار' },
  { value: 'translator', label: 'مترجم' },
  { value: 'illustrator', label: 'تصویرگر' },
  { value: 'photographer', label: 'عکاس' }
]
const STEPS = ['اطلاعات پایه', 'فهرست مطالب', 'اعضا و نقش‌ها', 'مرور و ساخت']
let seq = 0
const newKey = () => `k${Date.now().toString(36)}${seq++}`

export default function IssueNew() {
  const { pubId, base } = useTeam()
  const nav = useNavigate()
  const { busy, run } = useAction()
  const [step, setStep] = useState(0)
  const [members, setMembers] = useState<any[]>([])
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([])
  const [cats, setCats] = useState<any[]>([])
  const [kwSuggest, setKwSuggest] = useState<string[]>([])
  const [nextNumber, setNextNumber] = useState<number>(1)
  const [info, setInfo] = useState({ title: '', number: '', summary: '', keywords: '', planned_publish_at: '', progress_view: 'timeline', category_ids: [] as string[] })
  const [toc, setToc] = useState<TocRow[]>([])
  const [paste, setPaste] = useState('')
  const [team, setTeam] = useState<Record<string, string>>({}) // member_id -> production role
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    api.get(`/api/team/${pubId}/members`).then((r) => {
      setMembers(r.members.filter((m: any) => m.is_active))
      setRoles(r.roles || [])
    }).catch(() => {})
    api.get(`/api/team/${pubId}/issues`).then((r) => setNextNumber(r.next_number)).catch(() => {})
    api.get('/api/public/categories').then((r) => setCats(r.categories.filter((c: any) => c.type !== 'major'))).catch(() => {})
    api.get(`/api/team/${pubId}/keywords`).then((r) => setKwSuggest(r.keywords || [])).catch(() => {})
  }, [pubId])

  const keywords = useMemo(() => info.keywords.split(/[,،\n]/).map((s) => s.trim()).filter(Boolean), [info.keywords])
  const [kwBusy, setKwBusy] = useState(false)
  /** Suggest keywords from this issue's own text (AI when enabled, frequency fallback otherwise). */
  const suggestFromText = async () => {
    const text = [info.title, info.summary, ...toc.map((t) => t.title)].join('\n')
    setKwBusy(true)
    try {
      const r = await api.post<{ keywords: string[] }>(`/api/team/${pubId}/keywords/suggest`, { text })
      setKwSuggest((old) => [...new Set([...(r.keywords || []), ...old])])
    } catch {
      /* suggestions are optional */
    } finally {
      setKwBusy(false)
    }
  }

  const addPasted = () => {
    const lines = paste.split('\n').map((l) => l.replace(/^[\s\d۰-۹\-–—.)•*]+/, '').trim()).filter(Boolean)
    setToc([...toc, ...lines.map((t) => ({ key: newKey(), title: t, kind: 'article', due_at: '', assignments: [] }))])
    setPaste('')
  }
  const upd = (k: string, patch: Partial<TocRow>) => setToc(toc.map((t) => (t.key === k ? { ...t, ...patch } : t)))
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir
    if (j < 0 || j >= toc.length) return
    const a = [...toc]
    ;[a[idx], a[j]] = [a[j], a[idx]]
    setToc(a)
  }

  const validate = (s: number) => {
    setErr(null)
    if (s === 0 && info.title.trim().length < 2) return setErr('عنوان شماره را وارد کنید'), false
    return true
  }

  // members assigned to TOC items are auto-included in the issue team
  useEffect(() => {
    const next = { ...team }
    let changed = false
    for (const t of toc)
      for (const a of t.assignments)
        if (a.member_id && !next[a.member_id]) {
          next[a.member_id] = ASSIGN_ROLES.find((r) => r.value === a.role)?.label || 'همکار'
          changed = true
        }
    if (changed) setTeam(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toc])

  const submit = async () => {
    const r = await run(
      () =>
        api.post(`/api/team/${pubId}/issues`, {
          title: info.title.trim(),
          number: info.number ? Number(info.number) : undefined,
          summary: info.summary,
          keywords,
          category_ids: info.category_ids,
          progress_view: info.progress_view,
          planned_publish_at: info.planned_publish_at || null,
          toc: toc.map((t) => ({ key: t.key, title: t.title, kind: t.kind, due_at: t.due_at || null, assignments: t.assignments.filter((a) => a.member_id) })),
          members: Object.entries(team).map(([member_id, production_role]) => ({ member_id, production_role }))
        }),
      'شماره ساخته شد'
    )
    if (r?.id) nav(`${base}/issues/${r.id}`)
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="شمارهٔ جدید" subtitle={`ساخت گام‌به‌گام — شمارهٔ پیشنهادی ${formatNumber(nextNumber)}`} />
      <ol className="mb-5 grid grid-cols-4 gap-2 text-center text-xs">
        {STEPS.map((s, i) => (
          <li key={s} className={cx('rounded-xl border p-2', i === step ? 'border-brand bg-brand-soft font-bold text-brand' : i < step ? 'border-line text-ok' : 'border-line text-muted')}>
            {formatNumber(i + 1)}. {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="عنوان شماره *">
              <Input value={info.title} onChange={(e) => setInfo({ ...info, title: e.target.value })} maxLength={160} autoFocus />
            </Field>
            <Field label="شمارهٔ ترتیبی" hint={`خالی بگذارید تا ${formatNumber(nextNumber)} در نظر گرفته شود`}>
              <Input type="number" min={1} value={info.number} onChange={(e) => setInfo({ ...info, number: e.target.value })} dir="ltr" />
            </Field>
            <Field label="تاریخ برنامه‌ریزی‌شدهٔ انتشار">
              <Input type="date" value={info.planned_publish_at} onChange={(e) => setInfo({ ...info, planned_publish_at: e.target.value })} dir="ltr" />
            </Field>
            <Field label="نمای پیشرفت">
              <Select value={info.progress_view} onChange={(e) => setInfo({ ...info, progress_view: e.target.value })} options={[{ value: 'timeline', label: 'خط زمانی' }, { value: 'checklist', label: 'چک‌لیست' }, { value: 'kanban', label: 'کانبان' }]} />
            </Field>
          </div>
          <Field label="خلاصه / یادداشت سردبیر">
            <Textarea value={info.summary} onChange={(e) => setInfo({ ...info, summary: e.target.value })} maxLength={3000} className="mt-1" />
          </Field>
          <div className="mt-3">
            <Field label="کلیدواژه‌ها" hint="با ویرگول جدا کنید">
              <Input value={info.keywords} onChange={(e) => setInfo({ ...info, keywords: e.target.value })} />
            </Field>
            <button type="button" className="mt-1 text-xs text-brand hover:underline disabled:opacity-50" disabled={kwBusy || (!info.title && !info.summary)} onClick={suggestFromText}>
              {kwBusy ? 'در حال پیشنهاد…' : 'پیشنهاد کلیدواژه از عنوان و خلاصه'}
            </button>
            {kwSuggest.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {kwSuggest.filter((k) => !keywords.includes(k)).slice(0, 14).map((k) => (
                  <button key={k} type="button" className="chip" onClick={() => setInfo({ ...info, keywords: [...keywords, k].join('، ') })}>
                    + {k}
                  </button>
                ))}
              </div>
            )}
          </div>
          {cats.length > 0 && (
            <div className="mt-3">
              <span className="label">دسته‌بندی موضوعی</span>
              <div className="flex flex-wrap gap-1">
                {cats.map((c) => {
                  const on = info.category_ids.includes(c.id)
                  return (
                    <button key={c.id} type="button" className={on ? 'chip border-brand bg-brand-soft text-brand' : 'chip'} onClick={() => setInfo({ ...info, category_ids: on ? info.category_ids.filter((x) => x !== c.id) : [...info.category_ids, c.id] })}>
                      {c.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </Card>
      )}

      {step === 1 && (
        <Card title="فهرست مطالب" action={<span className="text-xs text-muted">{formatNumber(toc.length)} بخش</span>}>
          <Field label="افزودن سریع" hint="هر خط یک بخش؛ شماره‌گذاری ابتدای خط خودکار حذف می‌شود">
            <Textarea rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'سرمقاله\nگفت‌وگو با استاد ...\nگزارش همایش ...'} />
          </Field>
          <div className="mt-2 flex gap-2">
            <Button variant="ghost" onClick={addPasted} disabled={!paste.trim()} icon={<Plus className="size-4" />}>افزودن خطوط</Button>
            <Button variant="ghost" onClick={() => setToc([...toc, { key: newKey(), title: '', kind: 'article', due_at: '', assignments: [] }])}>بخش خالی</Button>
          </div>
          <ul className="mt-4 space-y-3">
            {toc.map((t, idx) => (
              <li key={t.key} className="rounded-xl border border-line p-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 text-center text-xs text-muted">{formatNumber(idx + 1)}</span>
                  <Input value={t.title} onChange={(e) => upd(t.key, { title: e.target.value })} placeholder="عنوان بخش" />
                  <div className="flex shrink-0">
                    <button className="rounded p-1 hover:bg-surface-2" onClick={() => move(idx, -1)} aria-label="بالا"><ArrowRight className="size-4 rotate-90" /></button>
                    <button className="rounded p-1 hover:bg-surface-2" onClick={() => move(idx, 1)} aria-label="پایین"><ArrowRight className="size-4 -rotate-90" /></button>
                    <button className="rounded p-1 text-danger hover:bg-surface-2" onClick={() => setToc(toc.filter((x) => x.key !== t.key))} aria-label="حذف"><Trash2 className="size-4" /></button>
                  </div>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Select value={t.kind} onChange={(e) => upd(t.key, { kind: e.target.value })} options={KINDS} aria-label="نوع" />
                  <Input type="date" value={t.due_at} onChange={(e) => upd(t.key, { due_at: e.target.value })} dir="ltr" aria-label="موعد" />
                </div>
                <div className="mt-2 space-y-1">
                  {t.assignments.map((a, ai) => (
                    <div key={ai} className="flex gap-2">
                      <Select value={a.member_id} placeholder="عضو…" onChange={(e) => upd(t.key, { assignments: t.assignments.map((x, j) => (j === ai ? { ...x, member_id: e.target.value } : x)) })} options={members.map((m) => ({ value: m.id, label: m.full_name }))} />
                      <Select value={a.role} onChange={(e) => upd(t.key, { assignments: t.assignments.map((x, j) => (j === ai ? { ...x, role: e.target.value } : x)) })} options={ASSIGN_ROLES} />
                      <button className="rounded p-1 text-danger" onClick={() => upd(t.key, { assignments: t.assignments.filter((_, j) => j !== ai) })} aria-label="حذف"><Trash2 className="size-4" /></button>
                    </div>
                  ))}
                  {members.length > 0 && (
                    <button className="text-xs text-brand" onClick={() => upd(t.key, { assignments: [...t.assignments, { member_id: '', role: 'author' }] })}>+ واگذاری به عضو</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {!toc.length && <p className="mt-3 text-sm text-muted">می‌توانید فهرست را بعداً هم در اتاق شماره تکمیل کنید.</p>}
        </Card>
      )}

      {step === 2 && (
        <Card title="اعضای این شماره" action={<span className="text-xs text-muted">{formatNumber(Object.keys(team).length)} نفر</span>}>
          {members.length ? (
            <ul className="divide-y divide-line">
              {members.map((m) => {
                const on = m.id in team
                return (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 py-2">
                    <label className="flex min-w-40 flex-1 items-center gap-2 text-sm">
                      <input type="checkbox" checked={on} onChange={(e) => { const n = { ...team }; if (e.target.checked) n[m.id] = m.default_role || 'همکار'; else delete n[m.id]; setTeam(n) }} />
                      {m.full_name}
                    </label>
                    {on && (
                      <Input className="max-w-56" list="prod-roles" value={team[m.id]} onChange={(e) => setTeam({ ...team, [m.id]: e.target.value })} aria-label="نقش تولید" />
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted">هنوز عضوی ثبت نکرده‌اید؛ از بخش «اعضا» اضافه کنید.</p>
          )}
          <datalist id="prod-roles">{roles.map((r) => <option key={r.id} value={r.name} />)}</datalist>
        </Card>
      )}

      {step === 3 && (
        <Card title="مرور">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">عنوان</dt><dd className="font-bold">{info.title}</dd>
            <dt className="text-muted">شماره</dt><dd>{formatNumber(Number(info.number) || nextNumber)}</dd>
            <dt className="text-muted">کلیدواژه‌ها</dt><dd>{keywords.join('، ') || '—'}</dd>
            <dt className="text-muted">فهرست مطالب</dt><dd>{formatNumber(toc.filter((t) => t.title.trim()).length)} بخش</dd>
            <dt className="text-muted">اعضا</dt><dd>{formatNumber(Object.keys(team).length)} نفر</dd>
            <dt className="text-muted">مراحل تولید</dt><dd>نویسندگی ← ویراستاری ← گرافیک ← صفحه‌آرایی ← بازبینی ← انتشار</dd>
          </dl>
          <p className="mt-4 text-xs leading-6 text-muted">پس از ساخت، در «اتاق شماره» می‌توانید پیشرفت را ثبت کنید، PDF و جلد را بارگذاری کنید و برای تأیید انتشار ارسال کنید. انتشار نهایی همیشه با تأیید مسئول نشریات است.</p>
        </Card>
      )}

      {err && <p className="mt-3 text-sm text-danger">{err}</p>}
      <div className="mt-5 flex justify-between gap-2">
        <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)} icon={<ArrowRight className="size-4" />}>قبلی</Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={() => validate(step) && setStep(step + 1)}>بعدی <ArrowLeft className="size-4" /></Button>
        ) : (
          <Button loading={busy} onClick={submit}>ساخت شماره</Button>
        )}
      </div>
    </div>
  )
}

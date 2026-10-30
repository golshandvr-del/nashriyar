import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { api } from '../lib/api'
import { toFaDigits } from '../lib/format'
import { Async, Badge, Button, Card, Empty, Input, Modal, PageHeader, Select, useAction, useAsync, useToast } from '../components/ui'

interface Banner { title: string; subtitle: string; link: string; color: string }
interface IssueOpt { id: string; number: number; title: string; publication_title: string }

export default function AdminStorefront() {
  const st = useAsync(() => api.get('/api/admin/shelves'), [])
  return (
    <div className="space-y-6">
      <PageHeader title="ویترین" subtitle="قفسه‌های ویژه و بنرهای صفحهٔ اصلی" />
      <Async state={st}>
        {(d: any) => (
          <>
            <Shelves shelves={d.shelves} issues={d.issues} reload={st.reload} />
            <Banners initial={d.banners || []} reload={st.reload} />
          </>
        )}
      </Async>
    </div>
  )
}

function Shelves({ shelves, issues, reload }: { shelves: any[]; issues: IssueOpt[]; reload: () => void }) {
  const [edit, setEdit] = useState<any>(null)
  const { run, busy } = useAction()
  const { confirm } = useToast()
  const byId = new Map(issues.map((i) => [i.id, i]))
  const remove = async (s: any) => {
    if (!(await confirm(`قفسهٔ «${s.title}» حذف شود؟`, { danger: true, okLabel: 'حذف' }))) return
    if (await run(() => api.del(`/api/admin/shelves/${s.id}`), 'حذف شد')) reload()
  }
  const toggle = async (s: any) => {
    if (await run(() => api.post('/api/admin/shelves', { id: s.id, title: s.title, issue_ids: s.issue_ids, sort_order: s.sort_order, is_active: !s.is_active }), s.is_active ? 'غیرفعال شد' : 'فعال شد')) reload()
  }
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold">قفسه‌های ویژه</h2>
        <Button onClick={() => setEdit({ title: '', issue_ids: [], sort_order: shelves.length })}>
          <Plus className="size-4" /> قفسهٔ جدید
        </Button>
      </div>
      {!shelves.length ? (
        <Empty title="هنوز قفسه‌ای ساخته نشده" hint="قفسه‌ها مجموعه‌ای منتخب از شماره‌ها هستند که در صفحهٔ اصلی نمایش داده می‌شوند." />
      ) : (
        <ul className="space-y-2">
          {shelves.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-bold">
                  {s.title}
                  {s.is_active ? <Badge tone="ok">فعال</Badge> : <Badge>غیرفعال</Badge>}
                </div>
                <div className="mt-1 truncate text-xs text-muted">
                  {s.rule ? <>قفسهٔ خودکار ({s.rule.split(':')[0]})</> : <>
                  {toFaDigits(s.issue_ids.length)} شماره:{' '}
                  {s.issue_ids
                    .slice(0, 4)
                    .map((id: string) => byId.get(id))
                    .filter(Boolean)
                    .map((i: IssueOpt) => `${i.publication_title} ${toFaDigits(i.number)}`)
                    .join('، ')}
                  {s.issue_ids.length > 4 ? '…' : ''}
                  </>}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" disabled={busy} onClick={() => toggle(s)}>{s.is_active ? 'غیرفعال' : 'فعال'}</Button>
                <Button variant="ghost" onClick={() => setEdit(s)} aria-label="ویرایش"><Pencil className="size-4" /></Button>
                <Button variant="danger" disabled={busy} onClick={() => remove(s)} aria-label="حذف"><Trash2 className="size-4" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {edit && <ShelfModal shelf={edit} issues={issues} onClose={() => setEdit(null)} onDone={() => (setEdit(null), reload())} />}
    </Card>
  )
}

function ShelfModal({ shelf, issues, onClose, onDone }: { shelf: any; issues: IssueOpt[]; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState<string>(shelf.title || '')
  const [ids, setIds] = useState<string[]>(shelf.issue_ids || [])
  const [order, setOrder] = useState<number>(shelf.sort_order ?? 0)
  const [rule, setRule] = useState<string>(shelf.rule || 'manual')
  const [facets, setFacets] = useState<{ categories: { id: string; name: string }[]; faculties: { id: string; name: string }[] }>({ categories: [], faculties: [] })
  useEffect(() => {
    api.get<any>('/api/public/categories').then(setFacets).catch(() => {})
  }, [])
  const ruleOptions = [
    { value: 'manual', label: 'دستی (انتخاب شماره‌ها)' },
    { value: 'latest', label: 'خودکار: تازه‌ترین شماره‌ها' },
    { value: 'free', label: 'خودکار: تازه‌ترین رایگان‌ها' },
    { value: 'popular', label: 'خودکار: پربازدیدترین ۳۰ روز اخیر' },
    ...facets.faculties.map((f) => ({ value: `faculty:${f.id}`, label: `خودکار: دانشکدهٔ ${f.name}` })),
    ...facets.categories.map((c) => ({ value: `category:${c.id}`, label: `خودکار: دستهٔ ${c.name}` }))
  ]
  const manual = rule === 'manual'
  const [q, setQ] = useState('')
  const { run, busy } = useAction()
  const byId = new Map(issues.map((i) => [i.id, i]))
  const term = q.trim()
  const candidates = issues.filter((i) => !ids.includes(i.id) && (!term || `${i.publication_title} ${i.title} ${i.number}`.includes(term))).slice(0, 30)
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir
    if (j < 0 || j >= ids.length) return
    const next = [...ids]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    setIds(next)
  }
  const save = async () => {
    const payload = { id: shelf.id, title: title.trim(), issue_ids: manual ? ids : [], rule, sort_order: order, is_active: shelf.id ? !!shelf.is_active : true }
    if (await run(() => api.post('/api/admin/shelves', payload), 'ذخیره شد')) onDone()
  }
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={shelf.id ? 'ویرایش قفسه' : 'قفسهٔ جدید'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>انصراف</Button>
          <Button disabled={busy || !title.trim() || (manual && !ids.length)} onClick={save}><Save className="size-4" /> ذخیره</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <label className="block">
          <span className="label">عنوان قفسه</span>
          <Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً: پیشنهاد سردبیر" />
        </label>
        <label className="block">
          <span className="label">ترتیب</span>
          <Input type="number" min={0} value={order} onChange={(e) => setOrder(Number(e.target.value) || 0)} />
        </label>
      </div>
      <label className="mt-3 block">
        <span className="label">نوع قفسه</span>
        <Select value={rule} onChange={(e) => setRule(e.target.value)} options={ruleOptions} />
      </label>
      {!manual && <p className="mt-3 rounded-xl bg-surface-2 p-3 text-sm leading-7 text-muted">این قفسه خودکار پر می‌شود (حداکثر ۱۲ شماره) و با انتشار شماره‌های تازه به‌روز می‌ماند؛ انتخاب دستی لازم نیست.</p>}
      {manual && (
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <div className="label">شماره‌های انتخاب‌شده ({toFaDigits(ids.length)}/۴۰)</div>
          {!ids.length ? (
            <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">از فهرست کناری شماره اضافه کنید.</p>
          ) : (
            <ol className="max-h-72 space-y-1 overflow-y-auto">
              {ids.map((id, idx) => {
                const i = byId.get(id)
                return (
                  <li key={id} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1 text-sm">
                    <span className="w-5 text-xs text-muted">{toFaDigits(idx + 1)}</span>
                    <span className="min-w-0 flex-1 truncate">{i ? `${i.publication_title} — شمارهٔ ${toFaDigits(i.number)}` : 'شمارهٔ ناموجود'}</span>
                    <button className="p-1 text-muted hover:text-ink" onClick={() => move(idx, -1)} aria-label="بالا"><ArrowUp className="size-4" /></button>
                    <button className="p-1 text-muted hover:text-ink" onClick={() => move(idx, 1)} aria-label="پایین"><ArrowDown className="size-4" /></button>
                    <button className="p-1 text-danger" onClick={() => setIds(ids.filter((x) => x !== id))} aria-label="حذف"><X className="size-4" /></button>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
        <div>
          <div className="label">افزودن شماره</div>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجوی نشریه یا عنوان…" />
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {candidates.map((i) => (
              <li key={i.id}>
                <button
                  disabled={ids.length >= 40}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-start text-sm hover:bg-surface-2 disabled:opacity-40"
                  onClick={() => setIds([...ids, i.id])}
                >
                  <Plus className="size-4 text-brand" />
                  <span className="min-w-0 flex-1 truncate">{i.publication_title} — شمارهٔ {toFaDigits(i.number)}: {i.title}</span>
                </button>
              </li>
            ))}
            {!candidates.length && <li className="p-2 text-xs text-muted">موردی یافت نشد</li>}
          </ul>
        </div>
      </div>
      )}
    </Modal>
  )
}

const DEFAULT_BANNER: Banner = { title: '', subtitle: '', link: '', color: '#4f46e5' }

function Banners({ initial, reload }: { initial: Banner[]; reload: () => void }) {
  const [list, setList] = useState<Banner[]>(initial)
  const [dirty, setDirty] = useState(false)
  const { run, busy } = useAction()
  const update = (idx: number, patch: Partial<Banner>) => {
    setList(list.map((b, i) => (i === idx ? { ...b, ...patch } : b)))
    setDirty(true)
  }
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir
    if (j < 0 || j >= list.length) return
    const next = [...list]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    setList(next)
    setDirty(true)
  }
  const save = async () => {
    const clean = list.filter((b) => b.title.trim())
    if (await run(() => api.post('/api/admin/banners', { banners: clean }), 'بنرها ذخیره شد')) {
      setDirty(false)
      reload()
    }
  }
  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">بنرهای صفحهٔ اصلی</h2>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={list.length >= 8} onClick={() => (setList([...list, { ...DEFAULT_BANNER }]), setDirty(true))}>
            <Plus className="size-4" /> بنر جدید
          </Button>
          <Button disabled={busy || !dirty} onClick={save}><Save className="size-4" /> ذخیرهٔ بنرها</Button>
        </div>
      </div>
      {!list.length ? (
        <Empty title="بنری تعریف نشده" hint="حداکثر ۸ بنر؛ بنرهای بدون عنوان هنگام ذخیره حذف می‌شوند." />
      ) : (
        <ul className="space-y-3">
          {list.map((b, idx) => (
            <li key={idx} className="grid gap-3 rounded-xl border border-line p-3 lg:grid-cols-[1fr_16rem]">
              <div className="grid gap-2 sm:grid-cols-2">
                <Input value={b.title} maxLength={80} onChange={(e) => update(idx, { title: e.target.value })} placeholder="عنوان" />
                <Input value={b.link} maxLength={200} dir="ltr" onChange={(e) => update(idx, { link: e.target.value })} placeholder="/p/slug یا https://…" />
                <Input className="sm:col-span-2" value={b.subtitle} maxLength={160} onChange={(e) => update(idx, { subtitle: e.target.value })} placeholder="زیرعنوان" />
                <div className="flex items-center gap-2">
                  <input type="color" value={b.color} onChange={(e) => update(idx, { color: e.target.value })} className="h-9 w-12 cursor-pointer rounded border border-line" aria-label="رنگ" />
                  <button className="p-1 text-muted hover:text-ink" onClick={() => move(idx, -1)} aria-label="بالا"><ArrowUp className="size-4" /></button>
                  <button className="p-1 text-muted hover:text-ink" onClick={() => move(idx, 1)} aria-label="پایین"><ArrowDown className="size-4" /></button>
                  <button className="p-1 text-danger" onClick={() => (setList(list.filter((_, i) => i !== idx)), setDirty(true))} aria-label="حذف"><Trash2 className="size-4" /></button>
                </div>
              </div>
              <div className="flex flex-col justify-center rounded-xl p-4 text-white" style={{ background: b.color }}>
                <div className="font-extrabold">{b.title || 'پیش‌نمایش عنوان'}</div>
                {b.subtitle && <div className="mt-1 text-sm opacity-90">{b.subtitle}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

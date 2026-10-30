import { useState } from 'react'
import { Copy, Plus, Printer, Trash2 } from 'lucide-react'
import { api, qs } from '../lib/api'
import { CHANNEL, CODE_STATE, faDate, formatNumber, formatToman, relativeFa, toEnDigits } from '../lib/format'
import { Async, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Stat, Tabs, useAction, useAsync, useToast } from '../components/ui'
import { useTeam } from './Layout'
import { qrDataUrl } from '../lib/qr'

const STATE_TONE: Record<string, 'ok' | 'muted' | 'warn' | 'danger' | 'brand'> = { active: 'brand', redeemed: 'ok', expired: 'muted', revoked: 'danger' }

export default function TeamSales() {
  const { pubId } = useTeam()
  const [tab, setTab] = useState<'codes' | 'print'>('codes')
  const issues = useAsync(() => api.get(`/api/team/${pubId}/issues`), [pubId])
  const published = (issues.data?.issues || []).filter((i: any) => i.status === 'published')
  return (
    <div>
      <PageHeader title="فروش و کد خرید" subtitle="فروش بدون درگاه: پس از دریافت وجه، کد یک‌بارمصرف بسازید و به خریدار بدهید." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'codes', label: 'کدهای خرید دیجیتال' },
          { key: 'print', label: 'فروش نسخهٔ چاپی' }
        ]}
      />
      <div className="mt-4">{tab === 'codes' ? <Codes pubId={pubId} issues={published} /> : <PrintSales pubId={pubId} issues={published} />}</div>
    </div>
  )
}

// ───────── Digital purchase codes ─────────
function Codes({ pubId, issues }: { pubId: string; issues: any[] }) {
  const [issue, setIssue] = useState('')
  const [state, setState] = useState('')
  const st = useAsync(() => api.get(`/api/team/${pubId}/codes${qs({ issue })}`), [pubId, issue])
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<any | null>(null)
  const { confirm } = useToast()
  const { busy, run } = useAction()
  const paid = issues.filter((i) => i.pricing === 'paid')

  const revoke = async (c: any) => {
    if (!(await confirm(`کد …${c.code_last4} باطل شود؟ این کار برگشت‌پذیر نیست.`, { danger: true, okLabel: 'ابطال' }))) return
    run(async () => {
      await api.post(`/api/team/${pubId}/codes/${c.id}/revoke`)
      st.reload()
    }, 'کد باطل شد')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56">
          <Select value={issue} onChange={(e) => setIssue(e.target.value)} placeholder="همهٔ شماره‌ها" options={paid.map((i) => ({ value: i.id, label: `شمارهٔ ${formatNumber(i.number)} — ${i.title}` }))} />
        </div>
        <div className="min-w-40">
          <Select value={state} onChange={(e) => setState(e.target.value)} placeholder="همهٔ وضعیت‌ها" options={Object.entries(CODE_STATE).map(([value, label]) => ({ value, label }))} />
        </div>
        <div className="flex-1" />
        <Button icon={<Plus className="size-4" />} disabled={!paid.length} onClick={() => setCreating(true)} title={paid.length ? '' : 'شمارهٔ پولی منتشرشده‌ای ندارید'}>
          ساخت کد
        </Button>
      </div>
      <Async state={st}>
        {(d: any) => {
          const all = d.codes as any[]
          const count = (s: string) => all.filter((c) => c.state === s).length
          const revenue = all.filter((c) => c.state === 'redeemed').reduce((a, c) => a + (c.price_paid || 0), 0)
          const rows = state ? all.filter((c) => c.state === state) : all
          return (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="فعال" value={formatNumber(count('active'))} />
                <Stat label="استفاده‌شده" value={formatNumber(count('redeemed'))} tone="ok" />
                <Stat label="منقضی/باطل" value={formatNumber(count('expired') + count('revoked'))} tone="muted" />
                <Stat label="درآمد اعلامی (کدهای استفاده‌شده)" value={formatToman(revenue)} />
              </div>
              {!rows.length ? (
                <Empty title="کدی یافت نشد" hint="پس از دریافت وجه (کارت‌به‌کارت، نقدی…) یک کد بسازید؛ اعتبار کد حداکثر ۲۴ ساعت است." />
              ) : (
                <div className="card overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-2 text-xs text-muted">
                      <tr>
                        <th className="p-3 text-right">کد</th>
                        <th className="p-3 text-right">شماره</th>
                        <th className="p-3 text-right">وضعیت</th>
                        <th className="hidden p-3 text-right md:table-cell">مبلغ / روش</th>
                        <th className="hidden p-3 text-right sm:table-cell">ساخت / انقضا</th>
                        <th className="p-3 text-right">استفاده‌کننده</th>
                        <th className="p-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((c) => (
                        <tr key={c.id} className="border-t border-line">
                          <td className="p-3 font-mono" dir="ltr">
                            NSH-····-{c.code_last4.slice(0, 4)}
                          </td>
                          <td className="p-3">ش {formatNumber(c.issue_number)}</td>
                          <td className="p-3">
                            <Badge tone={STATE_TONE[c.state]}>{CODE_STATE[c.state]}</Badge>
                            {c.bound_student_number && <div className="mt-1 text-[11px] text-muted">مخصوص {c.bound_student_number}</div>}
                          </td>
                          <td className="hidden p-3 md:table-cell">
                            {formatToman(c.price_paid || 0)}
                            <div className="text-[11px] text-muted">{CHANNEL[c.channel] || c.channel}</div>
                          </td>
                          <td className="hidden p-3 text-xs text-muted sm:table-cell">
                            {relativeFa(c.created_at)}
                            <div>تا {faDate(c.expires_at, true)}</div>
                          </td>
                          <td className="p-3 text-xs">{c.redeemed_at ? `${c.redeemed_by_name || ''} ${c.redeemed_by_sn ? `(${c.redeemed_by_sn})` : ''}` : '—'}</td>
                          <td className="p-3">
                            {c.state === 'active' && (
                              <button className="text-xs text-danger" disabled={busy} onClick={() => revoke(c)}>
                                ابطال
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )
        }}
      </Async>
      {creating && (
        <CreateCodes
          pubId={pubId}
          issues={paid}
          initialIssue={issue}
          onClose={() => setCreating(false)}
          onCreated={(r) => {
            setCreating(false)
            setCreated(r)
            st.reload()
          }}
        />
      )}
      {created && <CreatedCodes data={created} onClose={() => setCreated(null)} />}
    </div>
  )
}

function CreateCodes({ pubId, issues, initialIssue, onClose, onCreated }: { pubId: string; issues: any[]; initialIssue: string; onClose: () => void; onCreated: (r: any) => void }) {
  const [f, setF] = useState({ issue_id: initialIssue || issues[0]?.id || '', count: '1', ttl_hours: '24', student_number: '', channel: 'card_to_card', price_paid: '', note: '' })
  const { busy, run } = useAction()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))
  const sel = issues.find((i) => i.id === f.issue_id)
  const n = Number(toEnDigits(f.count)) || 1
  return (
    <Modal
      open
      onClose={onClose}
      title="ساخت کد خرید"
      footer={
        <Button
          loading={busy}
          disabled={!f.issue_id}
          onClick={() =>
            run(async () => {
              const r = await api.post(`/api/team/${pubId}/codes`, {
                ...f,
                count: n,
                ttl_hours: Number(toEnDigits(f.ttl_hours)) || 24,
                price_paid: f.price_paid === '' ? '' : Number(toEnDigits(f.price_paid))
              })
              onCreated(r)
            })
          }
        >
          ساخت {formatNumber(n)} کد
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="شمارهٔ پولی">
            <Select value={f.issue_id} onChange={set('issue_id')} options={issues.map((i) => ({ value: i.id, label: `شمارهٔ ${formatNumber(i.number)} — ${i.title}` }))} />
          </Field>
        </div>
        <Field label="تعداد" hint="۱ تا ۱۰۰">
          <Input value={f.count} onChange={set('count')} inputMode="numeric" disabled={!!f.student_number} />
        </Field>
        <Field label="اعتبار (ساعت)" hint="حداکثر ۲۴ ساعت">
          <Input value={f.ttl_hours} onChange={set('ttl_hours')} inputMode="numeric" />
        </Field>
        <Field label="مخصوص شماره دانشجویی" hint="اختیاری؛ فقط برای کد تکی">
          <Input
            value={f.student_number}
            onChange={(e) => setF((s) => ({ ...s, student_number: e.target.value, count: e.target.value ? '1' : s.count }))}
            inputMode="numeric"
            dir="ltr"
          />
        </Field>
        <Field label="روش دریافت وجه">
          <Select value={f.channel} onChange={set('channel')} options={Object.entries(CHANNEL).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="مبلغ دریافتی (تومان)" hint={sel?.price_digital ? `پیش‌فرض: ${formatToman(sel.price_digital)}` : undefined}>
          <Input value={f.price_paid} onChange={set('price_paid')} inputMode="numeric" placeholder="پیش‌فرض قیمت دیجیتال" />
        </Field>
        <Field label="یادداشت داخلی">
          <Input value={f.note} onChange={set('note')} maxLength={200} placeholder="مثلاً نام خریدار" />
        </Field>
      </div>
    </Modal>
  )
}

function CreatedCodes({ data, onClose }: { data: any; onClose: () => void }) {
  const { toast } = useToast()
  const text = data.codes.join('\n')
  const copy = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t)
      toast('کپی شد')
    } catch {
      toast('کپی ممکن نشد؛ دستی انتخاب کنید', 'error')
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="کدها ساخته شد"
      footer={
        <>
          <Button variant="ghost" icon={<Printer className="size-4" />} onClick={() => window.print()}>
            چاپ
          </Button>
          <Button icon={<Copy className="size-4" />} onClick={() => copy(text)}>
            کپی همه
          </Button>
        </>
      }
    >
      <div className="card mb-3 border-amber-400 p-3 text-sm leading-7">
        این کدها <b>فقط همین یک بار</b> نمایش داده می‌شوند (در سامانه فقط هش آن‌ها ذخیره می‌شود). اعتبار تا <b>{faDate(data.expires_at, true)}</b>.
      </div>
      <p className="mb-2 text-sm">
        شمارهٔ {formatNumber(data.issue.number)} — {data.issue.title}
      </p>
      <ul className="print-area space-y-2">
        {data.codes.map((c: string) => (
          <li key={c} className="flex items-center justify-between gap-2 rounded-xl border border-line p-3">
            {/* QR opens /redeem with the code prefilled (URL fragment — never sent to the server) */}
            <img src={qrDataUrl(`${window.location.origin}/redeem#code=${c}`, 96)} alt={`QR کد ${c}`} width={72} height={72} className="shrink-0 rounded bg-white" />
            <span className="me-auto font-mono text-lg font-bold tracking-wider" dir="ltr">
              {c}
            </span>
            <button className="no-print rounded-lg p-2 hover:bg-surface-2" onClick={() => copy(c)} aria-label="کپی">
              <Copy className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">خریدار کد را در صفحهٔ «ثبت کد خرید» (/redeem) وارد می‌کند و شماره به کتابخانه‌اش افزوده می‌شود.</p>
    </Modal>
  )
}

// ───────── Physical (print) sales ─────────
function PrintSales({ pubId, issues }: { pubId: string; issues: any[] }) {
  const st = useAsync(() => api.get(`/api/team/${pubId}/physical-sales`), [pubId])
  const [f, setF] = useState({ issue_id: '', quantity: '', unit_price: '', sold_at: new Date().toISOString().slice(0, 10), channel: '' })
  const { confirm } = useToast()
  const { busy, run } = useAction()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))
  const sel = issues.find((i) => i.id === f.issue_id)
  const add = () =>
    run(async () => {
      await api.post(`/api/team/${pubId}/physical-sales`, {
        ...f,
        quantity: Number(toEnDigits(f.quantity)),
        unit_price: f.unit_price === '' ? undefined : Number(toEnDigits(f.unit_price))
      })
      setF((s) => ({ ...s, quantity: '', unit_price: '' }))
      st.reload()
    }, 'فروش ثبت شد')
  const del = async (s: any) => {
    if (!(await confirm('این ردیف فروش حذف شود؟', { danger: true, okLabel: 'حذف' }))) return
    run(async () => {
      await api.del(`/api/team/${pubId}/physical-sales/${s.id}`)
      st.reload()
    }, 'حذف شد')
  }
  return (
    <div className="space-y-4">
      <Card title="ثبت فروش چاپی">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Field label="شماره">
              <Select value={f.issue_id} onChange={set('issue_id')} placeholder="انتخاب" options={issues.map((i) => ({ value: i.id, label: `شمارهٔ ${formatNumber(i.number)} — ${i.title}` }))} />
            </Field>
          </div>
          <Field label="تعداد">
            <Input value={f.quantity} onChange={set('quantity')} inputMode="numeric" />
          </Field>
          <Field label="قیمت واحد (تومان)">
            <Input value={f.unit_price} onChange={set('unit_price')} inputMode="numeric" placeholder={sel?.price_print ? String(sel.price_print) : ''} />
          </Field>
          <Field label="تاریخ">
            <Input type="date" value={f.sold_at} onChange={set('sold_at')} dir="ltr" />
          </Field>
          <div className="sm:col-span-2 lg:col-span-4">
            <Field label="محل فروش">
              <Input value={f.channel} onChange={set('channel')} maxLength={60} placeholder="مثلاً غرفهٔ جشنواره، دفتر انجمن" />
            </Field>
          </div>
          <div className="flex items-end">
            <Button className="w-full" loading={busy} disabled={!f.issue_id || !Number(toEnDigits(f.quantity))} onClick={add}>
              ثبت
            </Button>
          </div>
        </div>
      </Card>
      <Async state={st}>
        {(d: any) => {
          const total = d.sales.reduce((a: number, s: any) => a + s.quantity, 0)
          const revenue = d.sales.reduce((a: number, s: any) => a + s.quantity * (s.unit_price || 0), 0)
          return !d.sales.length ? (
            <Empty title="فروش چاپی ثبت نشده" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="نسخهٔ فروخته‌شده" value={formatNumber(total)} />
                <Stat label="درآمد اعلامی" value={formatToman(revenue)} />
              </div>
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-xs text-muted">
                    <tr>
                      <th className="p-3 text-right">تاریخ</th>
                      <th className="p-3 text-right">شماره</th>
                      <th className="p-3 text-center">تعداد</th>
                      <th className="p-3 text-right">مبلغ</th>
                      <th className="hidden p-3 text-right sm:table-cell">محل</th>
                      <th className="p-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {d.sales.map((s: any) => (
                      <tr key={s.id} className="border-t border-line">
                        <td className="p-3">{faDate(s.sold_at)}</td>
                        <td className="p-3">ش {formatNumber(s.issue_number)}</td>
                        <td className="p-3 text-center">{formatNumber(s.quantity)}</td>
                        <td className="p-3">{formatToman(s.quantity * (s.unit_price || 0))}</td>
                        <td className="hidden p-3 text-muted sm:table-cell">{s.channel || '—'}</td>
                        <td className="p-3">
                          <button className="rounded-lg p-1.5 text-danger hover:bg-surface-2" onClick={() => del(s)} aria-label="حذف">
                            <Trash2 className="size-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        }}
      </Async>
    </div>
  )
}

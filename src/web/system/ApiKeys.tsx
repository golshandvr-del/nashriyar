// /system/api-keys — keys of the read-only public API /api/open/* (ROADMAP phase 19).
// The plain key is returned exactly once at creation; the list only shows its 8-char prefix.
import { useState } from 'react'
import { Copy, KeyRound, Plus, RefreshCw } from 'lucide-react'
import { api } from '../lib/api'
import { Async, Badge, Button, Card, Empty, Field, Input, PageHeader, useAsync, useToast } from '../components/ui'
import { faDate, relativeFa, toFaDigits } from '../../shared/fa'
import { useSudo } from './lib'

type K = { id: string; name: string; prefix: string; scopes: string; rate_per_min: number; created_at: string; last_used_at: string | null; use_count: number; revoked_at: string | null; created_by: string | null }

export default function SystemApiKeys() {
  const st = useAsync(() => api.get<{ keys: K[] }>('/api/system/api-keys'), [])
  const { guard } = useSudo()
  const { confirm, toast } = useToast()
  const [name, setName] = useState('')
  const [rate, setRate] = useState('120')
  const [busy, setBusy] = useState<string | null>(null)
  const [fresh, setFresh] = useState<{ name: string; key: string } | null>(null)
  const origin = typeof location !== 'undefined' ? location.origin : ''

  const create = async () => {
    setBusy('create')
    const r = await guard(() => api.post<{ key: string }>('/api/system/api-keys', { name: name.trim(), rate_per_min: Number(rate) || 120 }), 'کلید ساخته شد')
    setBusy(null)
    if (r?.key) {
      setFresh({ name: name.trim(), key: r.key })
      setName('')
      st.reload()
    }
  }
  const revoke = async (k: K) => {
    if (!(await confirm(`کلید «${k.name}» باطل شود؟ سامانهٔ مصرف‌کننده بلافاصله دسترسی را از دست می‌دهد.`, { danger: true, okLabel: 'ابطال' }))) return
    setBusy(k.id)
    const r = await guard(() => api.post(`/api/system/api-keys/${k.id}/revoke`, {}), 'کلید باطل شد')
    setBusy(null)
    if (r) st.reload()
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="کلیدهای API عمومی"
        subtitle="دسترسی فقط‌خواندنی سامانه‌های دیگر دانشگاه به دادهٔ عمومی نشریات — ساخت و ابطال در گزارش فنی ثبت می‌شود"
        actions={
          <Button variant="ghost" icon={<RefreshCw className="size-4" />} onClick={st.reload}>
            به‌روزرسانی
          </Button>
        }
      />

      <Card title="کلید تازه">
        <form
          className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim().length >= 2) create()
          }}
        >
          <Field label="نام سامانهٔ مصرف‌کننده">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً سامانهٔ آموزش" maxLength={80} />
          </Field>
          <Field label="سقف درخواست در دقیقه">
            <Input dir="ltr" inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Button type="submit" icon={<Plus className="size-4" />} loading={busy === 'create'} disabled={name.trim().length < 2}>
            ساخت کلید
          </Button>
        </form>
        {fresh && (
          <div className="mt-4 space-y-2 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm" role="status">
            <p className="font-bold">کلید «{fresh.name}» فقط همین یک بار نمایش داده می‌شود؛ آن را در جای امن ذخیره کنید.</p>
            <div className="flex flex-wrap items-center gap-2">
              <code dir="ltr" className="break-all rounded bg-surface px-2 py-1 font-mono text-xs">
                {fresh.key}
              </code>
              <Button
                variant="ghost"
                icon={<Copy className="size-4" />}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(fresh.key)
                    toast('کپی شد')
                  } catch {
                    toast('کپی ممکن نشد؛ دستی انتخاب کنید', 'error')
                  }
                }}
              >
                کپی
              </Button>
            </div>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">
          نشانی پایه: <code dir="ltr">{origin}/api/open</code> · سرآیند <code dir="ltr">X-API-Key</code> · قرارداد ماشینی:{' '}
          <a dir="ltr" className="underline" href="/api/open/openapi.json" target="_blank" rel="noreferrer">
            openapi.json
          </a>
        </p>
      </Card>

      <Async state={st}>
        {(d) => (
          <Card title={`کلیدها (${toFaDigits(d.keys.length)})`}>
            {d.keys.length === 0 ? (
              <Empty title="هنوز کلیدی ساخته نشده" />
            ) : (
              <ul className="divide-y divide-line text-sm">
                {d.keys.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        <KeyRound className="size-4 text-muted" />
                        {k.name}
                        <code dir="ltr" className="text-xs text-muted">
                          {k.prefix}…
                        </code>
                        {k.revoked_at ? <Badge tone="danger">باطل‌شده {faDate(k.revoked_at)}</Badge> : <Badge tone="ok">فعال</Badge>}
                      </div>
                      <div className="text-xs text-muted">
                        سقف {toFaDigits(k.rate_per_min)} در دقیقه · {toFaDigits(k.use_count)} درخواست · آخرین استفاده {k.last_used_at ? relativeFa(k.last_used_at) : '—'} · ساخت {faDate(k.created_at)}
                        {k.created_by ? ` توسط ${k.created_by}` : ''}
                      </div>
                    </div>
                    {!k.revoked_at && (
                      <Button variant="ghost" loading={busy === k.id} onClick={() => revoke(k)}>
                        ابطال
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </Async>
    </div>
  )
}

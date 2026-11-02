// Account settings card: outbound notification channels (ROADMAP phase 19) — email, Bale bot, Eitaa.
// Connect → verify (email/Eitaa: code sent there; Bale: open the bot with a link code) → per-channel muted categories.
import { useState } from 'react'
import { BellRing, ExternalLink, Send, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { cx, faDate, toFaDigits } from '../lib/format'
import { Async, Badge, Button, Card, Field, Input, useAction, useAsync } from '../components/ui'

interface Ch {
  channel: 'email' | 'bale' | 'eitaa'
  label: string
  available: boolean
  address: string | null
  verified: boolean
  verified_at: string | null
  pending: boolean
  muted: string[]
  bot?: string | null
}
interface Data {
  categories: Record<string, string>
  channels: Ch[]
}

function ChannelRow({ ch, categories, reload }: { ch: Ch; categories: Record<string, string>; reload: () => void }) {
  const { run, busy } = useAction()
  const [address, setAddress] = useState('')
  const [code, setCode] = useState('')
  const [bale, setBale] = useState<{ code: string; link: string | null } | null>(null)
  const [open, setOpen] = useState(false)
  const connect = async () => {
    const r = await run(() => api.post<{ code?: string; link?: string | null }>(`/api/channels/${ch.channel}/connect`, { address }), ch.channel === 'bale' ? undefined : 'کد تأیید فرستاده شد')
    if (r && ch.channel === 'bale' && r.code) setBale({ code: r.code, link: r.link || null })
    if (r) reload()
  }
  const verify = async () => {
    if (await run(() => api.post(`/api/channels/${ch.channel}/verify`, { code }), `${ch.label} متصل شد`)) {
      setCode('')
      reload()
    }
  }
  const toggleMute = async (k: string) => {
    const muted = ch.muted.includes(k) ? ch.muted.filter((x) => x !== k) : [...ch.muted, k]
    if (await run(() => api.post(`/api/channels/${ch.channel}/mute`, { muted }))) reload()
  }
  const remove = async () => {
    if (!confirm(`اتصال ${ch.label} قطع شود؟`)) return
    if (await run(() => api.del(`/api/channels/${ch.channel}`), 'اتصال قطع شد')) {
      setBale(null)
      reload()
    }
  }
  return (
    <li className="rounded-xl border border-line p-3" data-channel={ch.channel}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{ch.label}</span>
        {ch.verified ? <Badge tone="ok">متصل</Badge> : ch.pending ? <Badge tone="warn">در انتظار تأیید</Badge> : <Badge>غیرفعال</Badge>}
        {ch.verified && ch.address && (
          <span className="truncate text-xs text-muted" dir="ltr">
            {ch.channel === 'bale' ? `chat ${ch.address}` : ch.address}
          </span>
        )}
        <span className="flex-1" />
        {ch.verified && (
          <>
            <Button variant="ghost" className="px-2 py-1 text-xs" icon={<Send className="size-3.5" />} loading={busy} onClick={() => run(() => api.post(`/api/channels/${ch.channel}/test`), 'پیام آزمایشی فرستاده شد')}>
              آزمایش
            </Button>
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              موضوع‌ها
            </Button>
          </>
        )}
        {(ch.verified || ch.pending) && (
          <button className="rounded-lg p-1.5 text-danger hover:bg-surface-2" onClick={remove} aria-label={`قطع اتصال ${ch.label}`}>
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
      {!ch.available && !ch.verified && <p className="mt-2 text-xs text-muted">این کانال هنوز توسط مدیر سامانه راه‌اندازی نشده است.</p>}
      {ch.available && !ch.verified && ch.channel !== 'bale' && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <Input
              dir="ltr"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={ch.channel === 'email' ? 'name@example.com' : 'شناسهٔ ایتا (مثل @username)'}
              aria-label={ch.channel === 'email' ? 'نشانی ایمیل' : 'شناسهٔ ایتا'}
            />
            <Button variant="ghost" loading={busy} disabled={!address.trim()} onClick={connect}>
              ارسال کد
            </Button>
          </div>
          {ch.pending && (
            <div className="flex gap-2">
              <Input dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} placeholder="کد تأیید" aria-label="کد تأیید" />
              <Button loading={busy} disabled={!code.trim()} onClick={verify}>
                تأیید
              </Button>
            </div>
          )}
        </div>
      )}
      {ch.available && !ch.verified && ch.channel === 'bale' && (
        <div className="mt-3 space-y-2 text-sm">
          {!bale ? (
            <Button variant="ghost" loading={busy} onClick={connect}>
              دریافت کد اتصال ربات بله
            </Button>
          ) : (
            <div className="rounded-lg bg-surface-2 p-3 leading-7">
              {bale.link ? (
                <a className="inline-flex items-center gap-1 text-brand underline" href={bale.link} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" /> باز کردن ربات در بله
                </a>
              ) : (
                <span>به ربات نشریار در بله بروید</span>
              )}{' '}
              و این کد را بفرستید: <b dir="ltr" className="font-mono">{bale.code}</b>
              <p className="text-xs text-muted">کد ۱۵ دقیقه اعتبار دارد. پس از ارسال، این صفحه را تازه کنید.</p>
              <Button variant="ghost" className="mt-1 px-2 py-1 text-xs" onClick={reload}>
                بررسی دوباره
              </Button>
            </div>
          )}
        </div>
      )}
      {ch.verified && open && (
        <fieldset className="mt-3 grid gap-1 sm:grid-cols-2">
          <legend className="mb-1 text-xs text-muted">اعلان این موضوع‌ها از {ch.label} فرستاده شود:</legend>
          {Object.entries(categories).map(([k, label]) => (
            <label key={k} className={cx('flex items-center gap-2 text-sm', busy && 'opacity-60')}>
              <input type="checkbox" checked={!ch.muted.includes(k)} disabled={busy} onChange={() => toggleMute(k)} />
              {label}
            </label>
          ))}
        </fieldset>
      )}
      {ch.verified && ch.verified_at && <p className="mt-2 text-[11px] text-muted">متصل از {faDate(ch.verified_at)}</p>}
    </li>
  )
}

export default function NotifyChannelsCard() {
  const state = useAsync(() => api.get<Data>('/api/channels'))
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <BellRing className="size-4 text-brand" /> اعلان در ایمیل و پیام‌رسان‌ها
        </span>
      }
    >
      <Async state={state}>
        {(d) => (
          <div className="space-y-2">
            <p className="text-sm text-muted">اعلان‌های سامانه همیشه در نشریار هست؛ با اتصال این کانال‌ها، یک نسخه هم در ایمیل، بله یا ایتا دریافت می‌کنید.</p>
            <ul className="space-y-2">
              {d.channels.map((ch) => (
                <ChannelRow key={ch.channel} ch={ch} categories={d.categories} reload={state.reload} />
              ))}
            </ul>
            <p className="text-[11px] text-muted">{toFaDigits(d.channels.filter((c) => c.verified).length)} کانال متصل</p>
          </div>
        )}
      </Async>
    </Card>
  )
}

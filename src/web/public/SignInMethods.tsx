// Account settings card (ROADMAP phase 19): alternative sign-in methods — a verified mobile number for SMS one-time
// codes, and a linked university (OpenID Connect) identity. Hidden entirely when neither method is configured.
import { useState } from 'react'
import { Building2, Fingerprint, MessageSquareText, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { faDate } from '../lib/format'
import { Badge, Button, Card, Input, useAction, useAsync } from '../components/ui'

interface PhoneState {
  phone: string | null
  verified_at: string | null
  otp_available: boolean
}
interface SsoState {
  available: boolean
  label: string | null
  identities: { issuer: string; email: string | null; created_at: string; last_login_at: string | null }[]
}

function PhoneRow({ st, reload }: { st: PhoneState; reload: () => void }) {
  const { run, busy } = useAction()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const send = async () => {
    if (await run(() => api.post('/api/signin/phone/send', { phone }), 'کد تأیید پیامک شد')) setSent(true)
  }
  const verify = async () => {
    if (await run(() => api.post('/api/signin/phone/verify', { phone, code }), 'شمارهٔ همراه تأیید شد')) {
      setSent(false)
      setCode('')
      setPhone('')
      reload()
    }
  }
  const remove = async () => {
    if (!confirm('ورود با کد پیامکی برای این حساب خاموش شود؟')) return
    if (await run(() => api.del('/api/signin/phone'), 'ورود پیامکی خاموش شد')) reload()
  }
  return (
    <li className="rounded-xl border border-line p-3" id="signin-phone">
      <div className="flex flex-wrap items-center gap-2">
        <MessageSquareText className="size-4 text-brand" />
        <span className="font-bold">ورود با کد پیامکی</span>
        {st.verified_at ? <Badge tone="ok">فعال</Badge> : <Badge>غیرفعال</Badge>}
        {st.phone && (
          <span className="text-xs text-muted" dir="ltr">
            {st.phone}
          </span>
        )}
        <span className="flex-1" />
        {st.verified_at && (
          <button className="rounded-lg p-1.5 text-danger hover:bg-surface-2" onClick={remove} aria-label="خاموش کردن ورود پیامکی">
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
      {!st.otp_available && <p className="mt-2 text-xs text-muted">ارسال پیامک هنوز توسط مدیر سامانه راه‌اندازی نشده است.</p>}
      {st.otp_available && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted">{st.verified_at ? `تأییدشده از ${faDate(st.verified_at)} — برای تغییر شماره، شمارهٔ تازه را تأیید کنید.` : 'پس از تأیید شماره، می‌توانید بدون رمز عبور و با کد پیامکی وارد شوید.'}</p>
          <div className="flex gap-2">
            <Input dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09123456789" aria-label="شمارهٔ همراه" disabled={sent} />
            <Button variant="ghost" loading={busy} disabled={!phone.trim() || sent} onClick={send}>
              ارسال کد
            </Button>
          </div>
          {sent && (
            <div className="flex gap-2">
              <Input dir="ltr" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="کد شش‌رقمی" aria-label="کد تأیید پیامکی" />
              <Button loading={busy} disabled={!code.trim()} onClick={verify}>
                تأیید
              </Button>
              <Button variant="ghost" onClick={() => setSent(false)}>
                انصراف
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function SsoRow({ st, reload }: { st: SsoState; reload: () => void }) {
  const { run } = useAction()
  const linked = st.identities.length > 0
  const remove = async () => {
    if (!confirm('اتصال حساب دانشگاه قطع شود؟')) return
    if (await run(() => api.del('/api/signin/sso/identities'), 'اتصال قطع شد')) reload()
  }
  return (
    <li className="rounded-xl border border-line p-3" id="signin-sso">
      <div className="flex flex-wrap items-center gap-2">
        <Building2 className="size-4 text-brand" />
        <span className="font-bold">{st.label || 'حساب دانشگاه'}</span>
        {linked ? <Badge tone="ok">متصل</Badge> : <Badge>متصل نیست</Badge>}
        {linked && st.identities[0].email && (
          <span className="text-xs text-muted" dir="ltr">
            {st.identities[0].email}
          </span>
        )}
        <span className="flex-1" />
        {linked ? (
          <button className="rounded-lg p-1.5 text-danger hover:bg-surface-2" onClick={remove} aria-label="قطع اتصال حساب دانشگاه">
            <Trash2 className="size-4" />
          </button>
        ) : st.available ? (
          <a className="btn-ghost rounded-lg px-3 py-1.5 text-sm" href="/api/signin/sso/start?link=1">
            اتصال
          </a>
        ) : null}
      </div>
      {!st.available && !linked && <p className="mt-2 text-xs text-muted">ورود با حساب دانشگاه هنوز راه‌اندازی نشده است.</p>}
      {linked && st.identities[0].last_login_at && <p className="mt-2 text-[11px] text-muted">آخرین ورود: {faDate(st.identities[0].last_login_at)}</p>}
    </li>
  )
}

export default function SignInMethodsCard() {
  const phone = useAsync(() => api.get<PhoneState>('/api/signin/phone'), [])
  const sso = useAsync(() => api.get<SsoState>('/api/signin/sso/identities'), [])
  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null
  const ssoMsg = params?.get('sso')
  // nothing configured and nothing linked → no card at all
  const show = (phone.data && (phone.data.otp_available || phone.data.verified_at)) || (sso.data && (sso.data.available || sso.data.identities.length))
  if (!show) return null
  return (
    <Card title={<span className="flex items-center gap-2"><Fingerprint className="size-4 text-brand" /> روش‌های ورود</span>}>
      {ssoMsg === 'linked' && <p className="mb-3 rounded-lg bg-surface-2 p-2 text-sm">حساب دانشگاه متصل شد ✅</p>}
      {ssoMsg === 'taken' && <p className="mb-3 rounded-lg bg-surface-2 p-2 text-sm text-danger">این حساب دانشگاه قبلاً به حساب دیگری متصل شده است.</p>}
      <ul className="space-y-3">
        {phone.data && (phone.data.otp_available || phone.data.verified_at) && <PhoneRow st={phone.data} reload={phone.reload} />}
        {sso.data && (sso.data.available || sso.data.identities.length > 0) && <SsoRow st={sso.data} reload={sso.reload} />}
      </ul>
    </Card>
  )
}

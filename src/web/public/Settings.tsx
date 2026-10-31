import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { BookOpen, LayoutDashboard, LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth, ROLE_LABEL, PUB_ROLE_LABEL, isMonitor } from '../lib/auth'
import { applyTheme, getTheme, getLargeText, setLargeText } from '../lib/theme'
import type { Theme } from '../lib/theme'
import { cx, faDate, relativeFa, formatNumber } from '../lib/format'
import ProfileForm from './ProfileForm'
import { Async, Badge, Button, Card, Field, Input, PasswordInput, Select, useAction, useAsync, useToast } from '../components/ui'

const COMMENT_STATUS: Record<string, { label: string; tone: 'muted' | 'ok' | 'warn' | 'danger' }> = {
  pending: { label: 'در انتظار بررسی', tone: 'warn' },
  approved: { label: 'منتشرشده', tone: 'ok' },
  rejected: { label: 'ردشده', tone: 'danger' },
  spam: { label: 'هرزنامه', tone: 'danger' }
}

function ThemeCard() {
  const [t, setT] = useState<Theme>(getTheme())
  const [large, setLarge] = useState(getLargeText())
  const opts: { k: Theme; label: string; icon: any }[] = [
    { k: 'light', label: 'روشن', icon: Sun },
    { k: 'dark', label: 'تیره', icon: Moon },
    { k: 'system', label: 'مطابق دستگاه', icon: Monitor }
  ]
  return (
    <Card title="ظاهر">
      <div className="grid grid-cols-3 gap-2">
        {opts.map((o) => (
          <button
            key={o.k}
            onClick={() => {
              setT(o.k)
              applyTheme(o.k)
            }}
            className={cx('flex flex-col items-center gap-1 rounded-xl border p-3 text-sm', t === o.k ? 'border-brand bg-brand-soft font-bold text-brand' : 'border-line hover:bg-surface-2')}
            aria-pressed={t === o.k}
          >
            <o.icon className="size-5" />
            {o.label}
          </button>
        ))}
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={large}
          onChange={(e) => {
            setLarge(e.target.checked)
            setLargeText(e.target.checked)
          }}
        />
        متن درشت‌تر (خوانایی بیشتر)
      </label>
    </Card>
  )
}

/** Entry cards to every panel the user may open + their current positions in publications. */
function PanelsCard() {
  const { user, publications } = useAuth()
  if (!user || (!isMonitor(user) && !publications.length)) return null
  return (
    <Card title="پنل‌ها و سمت‌های من">
      <div className="grid gap-2 sm:grid-cols-2">
        {isMonitor(user) && (
          <Link to="/admin" className="flex items-center gap-3 rounded-2xl border border-line p-3 hover:border-brand">
            <LayoutDashboard className="size-6 shrink-0 text-brand" />
            <div className="min-w-0">
              <div className="font-bold">پنل مدیریت</div>
              <div className="text-xs text-muted">{ROLE_LABEL[user.system_role as keyof typeof ROLE_LABEL]}</div>
            </div>
          </Link>
        )}
        {publications.map((p) => (
          <Link key={p.publication_id + p.role} to={`/team/${p.publication_id}`} className="flex items-center gap-3 rounded-2xl border border-line p-3 hover:border-brand">
            <BookOpen className="size-6 shrink-0 text-brand" />
            <div className="min-w-0">
              <div className="truncate font-bold">پنل نشریهٔ {p.title}</div>
              <div className="text-xs text-muted">سمت: {PUB_ROLE_LABEL[p.role] || 'عضو تیم'}</div>
            </div>
          </Link>
        ))}
      </div>
    </Card>
  )
}

export function PasswordCard() {
  const { user, refresh } = useAuth()
  const [f, setF] = useState({ current: '', next: '', next2: '' })
  const [err, setErr] = useState<string | null>(null)
  const { busy, run } = useAction()
  const submit = async () => {
    setErr(null)
    if (f.next.length < 8) return setErr('رمز جدید باید حداقل ۸ نویسه باشد')
    if (f.next !== f.next2) return setErr('تکرار رمز جدید یکسان نیست')
    const r = await run(() => api.post('/api/auth/change-password', { current: f.current, next: f.next }), 'رمز عبور تغییر کرد؛ سایر نشست‌ها خارج شدند')
    if (r) {
      setF({ current: '', next: '', next2: '' })
      refresh()
    }
  }
  return (
    <Card title="تغییر رمز عبور" className={user?.must_change_password ? 'border-amber-400' : undefined}>
      {!!user?.must_change_password && <p className="mb-3 text-sm text-amber-700 dark:text-amber-300">رمز شما توسط مدیر صادر شده است؛ لطفاً همین حالا آن را تغییر دهید.</p>}
      <div className="space-y-3">
        <Field label="رمز فعلی">
          <PasswordInput autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
        </Field>
        <Field label="رمز جدید" hint="حداقل ۸ نویسه">
          <PasswordInput strength autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
        </Field>
        <Field label="تکرار رمز جدید" error={err}>
          <PasswordInput autoComplete="new-password" value={f.next2} onChange={(e) => setF({ ...f, next2: e.target.value })} />
        </Field>
        <Button loading={busy} onClick={submit} disabled={!f.current || !f.next}>
          تغییر رمز
        </Button>
      </div>
    </Card>
  )
}

/** One-time recovery code (ROADMAP phase 5): shown once; only its hash is stored. Used on /recover. */
function RecoveryCard() {
  const [has, setHas] = useState<boolean | null>(null)
  const [pw, setPw] = useState('')
  const [code, setCode] = useState<string | null>(null)
  const { busy, run } = useAction()
  useEffect(() => {
    api.get<{ has_code: boolean }>('/api/auth/recovery-code').then((r) => setHas(r.has_code)).catch(() => setHas(false))
  }, [])
  const make = async () => {
    const r = await run(() => api.post<{ code: string }>('/api/auth/recovery-code', { password: pw }), 'کد بازیابی ساخته شد')
    if (r) {
      setCode(r.code)
      setHas(true)
      setPw('')
    }
  }
  return (
    <Card title="کد بازیابی رمز">
      <p className="mb-3 text-sm leading-6 text-muted">
        اگر رمزتان را فراموش کنید، با این کد از صفحهٔ «بازیابی رمز» رمز تازه تعیین می‌کنید. کد فقط یک بار نمایش داده می‌شود؛ آن را جایی امن یادداشت کنید.
        {has ? ' شما یک کد فعال دارید؛ ساخت کد تازه، کد قبلی را باطل می‌کند.' : has === false ? ' هنوز کدی نساخته‌اید.' : ''}
      </p>
      {code && (
        <div className="mb-3 rounded-xl border border-brand bg-brand-soft p-3 text-center">
          <div dir="ltr" className="select-all font-mono text-lg font-bold tracking-wider">
            {code}
          </div>
          <button className="mt-1 text-xs text-brand underline" onClick={() => navigator.clipboard?.writeText(code)}>
            کپی
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="رمز فعلی">
            <PasswordInput autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
        </div>
        <Button loading={busy} onClick={make} disabled={!pw}>
          {has ? 'ساخت کد تازه' : 'ساخت کد'}
        </Button>
      </div>
    </Card>
  )
}

/** Two-factor authentication (TOTP) for staff accounts — setup → confirm code → enabled; disable needs password + code. */
export function TotpCard() {
  const st = useAsync(() => api.get<{ enabled: boolean; available: boolean; recommended: boolean }>('/api/auth/totp'), [])
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null)
  const [code, setCode] = useState('')
  const [pw, setPw] = useState('')
  const { busy, run } = useAction()
  const d = st.data
  if (!d || !d.available) return null
  const start = async () => {
    const r = await run(() => api.post<{ secret: string; uri: string }>('/api/auth/totp/setup', {}))
    if (r) setSetup(r as { secret: string; uri: string })
  }
  const enable = async () => {
    if (await run(() => api.post('/api/auth/totp/enable', { code }), 'رمز دومرحله‌ای فعال شد')) {
      setSetup(null)
      setCode('')
      st.reload()
    }
  }
  const disable = async () => {
    if (await run(() => api.post('/api/auth/totp/disable', { password: pw, code }), 'رمز دومرحله‌ای غیرفعال شد')) {
      setCode('')
      setPw('')
      st.reload()
    }
  }
  return (
    <Card title="رمز دومرحله‌ای (TOTP)" className={!d.enabled && d.recommended ? 'border-amber-400' : undefined}>
      {d.enabled ? (
        <div className="space-y-3">
          <p className="text-sm">
            <Badge tone="ok">فعال</Badge> هنگام ورود، علاوه بر رمز، کد شش‌رقمی برنامهٔ احراز هویت هم خواسته می‌شود.
          </p>
          <Field label="رمز عبور فعلی">
            <PasswordInput autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <Field label="کد شش‌رقمی فعلی">
            <Input dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Button variant="danger" loading={busy} disabled={!pw || code.length < 6} onClick={disable}>
            غیرفعال کردن
          </Button>
        </div>
      ) : setup ? (
        <div className="space-y-3 text-sm">
          <p>۱. در برنامهٔ احراز هویت (Google Authenticator، Microsoft Authenticator، Aegis و…) یک حساب جدید با «کلید دستی» بسازید و این کلید را وارد کنید:</p>
          <code dir="ltr" className="block select-all rounded-lg bg-surface-2 p-3 text-center font-mono text-base tracking-widest">
            {setup.secret.match(/.{1,4}/g)?.join(' ')}
          </code>
          <p className="text-xs text-muted">
            روی گوشی می‌توانید مستقیم{' '}
            <a href={setup.uri} className="font-bold text-brand">
              این پیوند
            </a>{' '}
            را باز کنید. این کلید را با کسی به اشتراک نگذارید.
          </p>
          <p>۲. کد شش‌رقمی که برنامه نشان می‌دهد را وارد کنید:</p>
          <div className="flex gap-2">
            <Input dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
            <Button loading={busy} disabled={code.length < 6} onClick={enable}>
              تأیید و فعال‌سازی
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p>
            با فعال کردن رمز دومرحله‌ای، حتی اگر رمز عبور شما لو برود، بدون گوشی‌تان کسی نمی‌تواند وارد حساب شود.
            {d.recommended && <b className="text-amber-700 dark:text-amber-300"> برای حساب‌های مدیریتی به‌شدت توصیه می‌شود.</b>}
          </p>
          <Button loading={busy} onClick={start}>
            راه‌اندازی رمز دومرحله‌ای
          </Button>
        </div>
      )}
    </Card>
  )
}

function SessionsCard() {
  const { logout } = useAuth()
  const nav = useNavigate()
  const { confirm } = useToast()
  const st = useAsync(() => api.get<{ sessions: { id: string; created_at: string; user_agent: string; current: boolean }[] }>('/api/auth/sessions'), [])
  const { busy, run } = useAction()
  return (
    <Card title="نشست‌های فعال">
      <Async state={st}>
        {(d) => (
          <ul className="divide-y divide-line text-sm">
            {d.sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate text-muted" dir="ltr" title={s.user_agent}>
                  {(s.user_agent || 'نامشخص').slice(0, 60)}
                </span>
                <span className="shrink-0 text-xs">{s.current ? <Badge tone="ok">همین دستگاه</Badge> : relativeFa(s.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Async>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="ghost"
          icon={<LogOut className="size-4" />}
          onClick={async () => {
            await logout()
            nav('/')
          }}
        >
          خروج
        </Button>
        <Button
          variant="ghost"
          loading={busy}
          onClick={async () => {
            if (!(await confirm('از همهٔ دستگاه‌ها (از جمله همین دستگاه) خارج می‌شوید. ادامه می‌دهید؟'))) return
            const r = await run(() => api.post('/api/auth/logout-all'))
            if (r) {
              await logout()
              nav('/login')
            }
          }}
        >
          خروج از همهٔ دستگاه‌ها
        </Button>
      </div>
    </Card>
  )
}

function MyComments() {
  const st = useAsync(() => api.get<{ comments: any[] }>('/api/me/comments'), [])
  return (
    <Card title="نظرهای من">
      <Async state={st}>
        {(d) =>
          d.comments.length ? (
            <ul className="divide-y divide-line text-sm">
              {d.comments.map((c) => {
                const s = COMMENT_STATUS[c.status] || { label: c.status, tone: 'muted' as const }
                return (
                  <li key={c.id} className="py-2">
                    <div className="flex items-center justify-between gap-2">
                      <Link to={`/post/${c.post_id}`} className="text-xs text-brand">
                        {c.publication_title}
                      </Link>
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </div>
                    <p className="mt-1 line-clamp-2">{c.body}</p>
                    {c.reject_reason && <p className="mt-1 text-xs text-danger">دلیل: {c.reject_reason}</p>}
                    <p className="mt-1 text-xs text-muted">{faDate(c.created_at, true)}</p>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted">هنوز نظری ننوشته‌اید.</p>
          )
        }
      </Async>
    </Card>
  )
}

function DangerCard() {
  const { logout } = useAuth()
  const nav = useNavigate()
  const { confirm } = useToast()
  const { busy, run } = useAction()
  return (
    <Card title="حذف حساب" className="border-red-300">
      <p className="mb-3 text-sm leading-7 text-muted">با حذف حساب، نام شما ناشناس می‌شود، همهٔ نشست‌ها بسته می‌شوند و دیگر نمی‌توانید با این شمارهٔ دانشجویی وارد شوید. این کار برگشت‌پذیر نیست.</p>
      <Button
        variant="danger"
        loading={busy}
        onClick={async () => {
          if (!(await confirm('آیا از حذف دائمی حساب خود مطمئن هستید؟', { danger: true, okLabel: 'حذف حساب' }))) return
          const r = await run(() => api.post('/api/me/delete-account'), 'حساب شما حذف شد')
          if (r) {
            await logout()
            nav('/')
          }
        }}
      >
        حذف حساب من
      </Button>
    </Card>
  )
}

export default function Settings() {
  const { user, loading } = useAuth()
  if (!loading && !user) return <Navigate to="/login?next=/settings" replace />
  if (!user) return null
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-xl font-extrabold">تنظیمات حساب</h1>
      {!!user.must_change_password && <PasswordCard />}
      <PanelsCard />
      <ProfileForm />
      <ThemeCard />
      {!user.must_change_password && <PasswordCard />}
      <RecoveryCard />
      {user.system_role !== 'student' && <TotpCard />}
      <SessionsCard />
      {user.system_role === 'student' && <MyComments />}
      {user.system_role === 'student' && <DangerCard />}
      <p className="text-center text-xs text-muted">
        <Link to="/terms" className="underline">
          قوانین و حریم خصوصی
        </Link>
      </p>
    </div>
  )
}

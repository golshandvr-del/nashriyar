// Developer console shell /system (ROADMAP phase 13). Separate from the publication admin panel:
// only the `developer` role enters; the console stays locked until the temporary password is changed
// and TOTP is enabled (the server enforces the same rules on every /api/system/* call).
import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Activity, Database, DatabaseBackup, KeyRound, LogOut, Menu, ScrollText, ShieldCheck, SlidersHorizontal, UserCog, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { isDeveloper, useAuth } from '../lib/auth'
import { api } from '../lib/api'
import { cx } from '../lib/format'
import { Button, PageLoader, useAsync } from '../components/ui'
import { ErrorBoundary } from '../public/Static'
import { PasswordCard, TotpCard } from '../public/Settings'
import { toFaDigits } from '../../shared/fa'
import { SudoProvider, minutesLeft, useSudo } from './lib'
import type { SystemStatus } from './lib'

const NAV: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '', label: 'سلامت سرور', icon: Activity, end: true },
  { to: 'settings', label: 'تنظیمات فنی', icon: SlidersHorizontal },
  { to: 'backups', label: 'پشتیبان‌ها', icon: DatabaseBackup },
  { to: 'sessions', label: 'نشست‌ها و قفل‌ها', icon: KeyRound },
  { to: 'database', label: 'پایگاه داده', icon: Database },
  { to: 'staff', label: 'کارکنان ارشد', icon: UserCog },
  { to: 'audit', label: 'گزارش فنی', icon: ScrollText }
]

export default function SystemLayout() {
  const { user, loading, logout } = useAuth()
  const st = useAsync(() => api.get<SystemStatus>('/api/system/status'), [user?.id])
  const nav = useNavigate()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login?next=/system" replace />
  if (!isDeveloper(user)) return <Navigate to="/" replace />
  if (st.loading && !st.data) return <PageLoader />
  if (st.error || !st.data) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-4 py-20 text-center">
        <ShieldCheck className="mx-auto size-12 text-amber-500" />
        <p className="text-sm">{st.error || 'خطا'}</p>
        <Button
          onClick={async () => {
            await logout()
            nav('/login?next=/system', { replace: true })
          }}
        >
          ورود دوباره
        </Button>
      </div>
    )
  }
  const s = st.data
  // Gate 1 + 2: temporary password must be changed, then 2FA enabled — nothing else is reachable before that.
  if (user.must_change_password || s.user.must_change_password || !s.totp_enabled) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 py-10">
        <header className="space-y-1 text-center">
          <ShieldCheck className="mx-auto size-10 text-brand" />
          <h1 className="text-xl font-extrabold">پنل طراح سامانه قفل است</h1>
          <p className="text-sm leading-6 text-muted">
            برای امنیت، ورود به پنل طراح فقط پس از {user.must_change_password ? 'تغییر رمز موقت و ' : ''}فعال‌سازی رمز دومرحله‌ای (TOTP) ممکن است.
          </p>
        </header>
        {user.must_change_password ? <PasswordCard /> : <TotpCard />}
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="ghost" onClick={st.reload}>
            بررسی دوباره
          </Button>
          <Button
            variant="ghost"
            icon={<LogOut className="size-4" />}
            onClick={async () => {
              await logout()
              nav('/login', { replace: true })
            }}
          >
            خروج
          </Button>
        </div>
      </div>
    )
  }
  return (
    <SudoProvider initial={s.elevated_until}>
      <Shell status={s} />
    </SudoProvider>
  )
}

function Shell({ status }: { status: SystemStatus }) {
  const { user, logout } = useAuth()
  const loc = useLocation()
  const nav = useNavigate()
  const { elevatedUntil, elevate, drop } = useSudo()
  const [drawer, setDrawer] = useState(false)
  const [now, setNow] = useState(Date.now())
  useEffect(() => setDrawer(false), [loc.pathname])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const sudoMin = minutesLeft(elevatedUntil, now)
  const sessMin = minutesLeft(status.session_expires_at, now)
  const current = NAV.find((n) => (n.to ? loc.pathname.startsWith(`/system/${n.to}`) : loc.pathname === '/system' || loc.pathname === '/system/'))
  const out = async () => {
    await logout()
    nav('/login', { replace: true })
  }

  return (
    <div className="min-h-dvh md:flex">
      <a href="#main" className="skip-link">
        پرش به محتوای اصلی
      </a>
      <header className="no-print sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-surface/95 px-2 py-2 backdrop-blur md:hidden">
        <button className="rounded-xl p-2 hover:bg-surface-2" onClick={() => setDrawer(true)} aria-label="باز کردن منو" aria-expanded={drawer} aria-controls="system-drawer">
          <Menu className="size-6" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] leading-4 text-muted">پنل طراح سامانه</div>
          <div className="truncate text-sm font-bold leading-5">{current?.label || 'پنل طراح'}</div>
        </div>
        {sudoMin > 0 && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">sudo {toFaDigits(sudoMin)}′</span>}
      </header>
      {drawer && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setDrawer(false)} aria-hidden />}
      <aside
        id="system-drawer"
        className={cx(
          'no-print fixed inset-y-0 right-0 z-50 w-72 max-w-[85vw] overflow-y-auto border-l border-line bg-surface shadow-xl transition-transform duration-200',
          drawer ? 'translate-x-0' : 'translate-x-full',
          'md:sticky md:top-0 md:z-auto md:h-dvh md:w-60 md:max-w-none md:shrink-0 md:translate-x-0 md:shadow-none'
        )}
        aria-label="منوی پنل طراح"
      >
        <div className="flex items-center justify-between gap-2 border-b border-line p-3">
          <div className="min-w-0">
            <div className="text-xs text-muted">پنل طراح سامانه</div>
            <div className="truncate text-sm font-bold">{user?.display_name}</div>
            <div className="text-[11px] text-muted" dir="ltr">
              @{user?.username}
            </div>
          </div>
          <button className="rounded-lg p-2 hover:bg-surface-2 md:hidden" onClick={() => setDrawer(false)} aria-label="بستن منو">
            <X className="size-5" />
          </button>
        </div>
        <section className="space-y-2 border-b border-line p-3 text-xs" aria-label="وضعیت امنیتی نشست">
          <div className="flex items-center justify-between">
            <span className="text-muted">پایان نشست</span>
            <b>{toFaDigits(sessMin)} دقیقه</b>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted">حالت تأییدشده</span>
            {sudoMin > 0 ? (
              <button className="font-bold text-amber-700 underline dark:text-amber-300" onClick={drop} title="پایان زودهنگام">
                فعال · {toFaDigits(sudoMin)} دقیقه
              </button>
            ) : (
              <button className="font-bold text-brand underline" onClick={() => elevate()}>
                فعال‌سازی
              </button>
            )}
          </div>
          {status.ip_restricted && <div className="text-ok">دسترسی محدود به IP مجاز</div>}
        </section>
        <nav className="flex flex-col gap-1 p-2" aria-label="منوی پنل طراح">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to ? `/system/${n.to}` : '/system'}
              end={n.end}
              className={({ isActive }) => cx('flex items-center gap-2 rounded-xl px-3 py-2 text-sm', isActive ? 'bg-brand-soft font-bold text-brand' : 'text-muted hover:bg-surface-2 hover:text-ink')}
            >
              <n.icon className="size-4" />
              {n.label}
            </NavLink>
          ))}
          <button className="mt-2 flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-ink" onClick={out}>
            <LogOut className="size-4" /> خروج
          </button>
          <Link to="/settings" className="px-3 py-1 text-xs text-muted hover:text-ink">
            تنظیمات حساب من
          </Link>
        </nav>
      </aside>
      <main id="main" className="min-w-0 flex-1 p-4 md:p-6">
        <ErrorBoundary inline key={loc.pathname}>
          <Outlet context={status} />
        </ErrorBoundary>
      </main>
    </div>
  )
}

import { createContext, useContext, useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { BarChart3, BookOpen, ClipboardCheck, House, Images, LayoutDashboard, Megaphone, Menu, MessageCircle, Settings, Ticket, Users, X } from 'lucide-react'
import { useAuth, PUB_ROLE_LABEL, isAdmin } from '../lib/auth'
import type { PubRole } from '../lib/auth'
import { cx } from '../lib/format'
import { usePublicSettings } from '../lib/features'
import { CommandPalette, PaletteButton } from '../components/CommandPalette'
import { NotificationBell } from '../components/NotificationBell'
import type { PaletteItem } from '../components/CommandPalette'
import { Empty, PageLoader } from '../components/ui'
import { ErrorBoundary } from '../public/Static'
import { PageHelpButton, Tour } from '../components/Tour'
import { TEAM_HELP, TEAM_TOUR } from './help'

interface TeamCtx {
  pubId: string
  pub: PubRole | null
  base: string
}
const Ctx = createContext<TeamCtx | null>(null)
export function useTeam(): TeamCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTeam outside TeamLayout')
  return v
}

const NAV = [
  { to: '', label: 'پیشخوان', icon: LayoutDashboard, end: true },
  { to: 'issues', label: 'شماره‌ها', icon: BookOpen },
  { to: 'members', label: 'اعضا', icon: Users },
  { to: 'posts', label: 'اکسپلور', icon: Images },
  { to: 'comments', label: 'نظرها', icon: MessageCircle },
  { to: 'sales', label: 'فروش و کد', icon: Ticket },
  { to: 'stats', label: 'آمار', icon: BarChart3 },
  { to: 'recruit', label: 'فراخوان', icon: Megaphone },
  { to: 'profile', label: 'پروفایل نشریه', icon: Settings }
]

/** /team → choose (or auto-pick) a publication. */
export function TeamSelect() {
  const { user, publications, loading } = useAuth()
  const nav = useNavigate()
  useEffect(() => {
    if (publications.length === 1) nav(`/team/${publications[0].publication_id}`, { replace: true })
  }, [publications, nav])
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login?next=/team" replace />
  if (!publications.length)
    return (
      <div className="mx-auto max-w-md p-6">
        <Empty title="شما عضو تیم هیچ نشریه‌ای نیستید" hint="حساب‌های تیم توسط مسئول نشریات ساخته می‌شوند." action={<Link to="/" className="btn-ghost">بازگشت به خانه</Link>} />
      </div>
    )
  return (
    <div className="mx-auto max-w-md space-y-3 p-6">
      <h1 className="text-xl font-extrabold">انتخاب نشریه</h1>
      {publications.map((p) => (
        <Link key={p.publication_id} to={`/team/${p.publication_id}`} className="card flex items-center justify-between p-4 hover:border-brand">
          <span className="font-bold">{p.title}</span>
          <span className="text-xs text-muted">{PUB_ROLE_LABEL[p.role] || p.role}</span>
        </Link>
      ))}
    </div>
  )
}

export default function TeamLayout() {
  const { pubId = '' } = useParams()
  const { user, publications, loading } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  // Mobile: slide-in drawer instead of an overlapping horizontal tab strip.
  const [drawer, setDrawer] = useState(false)
  useEffect(() => setDrawer(false), [loc.pathname])
  useEffect(() => {
    if (!drawer) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false)
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [drawer])
  // Hide menu items whose whole feature was switched off by the super admin (the API enforces it too).
  const ff = usePublicSettings()?.features || {}
  const off = (k: string) => (ff as Record<string, boolean | undefined>)[k] === false
  const navItems = NAV.filter(
    (n) =>
      !((n.to === 'posts' || n.to === 'comments') && off('explore')) &&
      !(n.to === 'recruit' && off('recruitment')) &&
      !(n.to === 'sales' && off('paid_content') && off('physical_sales'))
  )
  if (loading) return <PageLoader />
  if (!user) return <Navigate to={`/login?next=/team/${pubId}`} replace />
  const pub = publications.find((p) => p.publication_id === pubId) || null
  if (!pub && !isAdmin(user)) return <Navigate to="/team" replace />
  const base = `/team/${pubId}`
  const paletteItems: PaletteItem[] = [
    ...navItems.map((n) => ({ id: `nav-${n.to || 'home'}`, label: n.label, hint: 'پنل تیم', icon: <n.icon className="size-4" />, to: n.to ? `${base}/${n.to}` : base })),
    { id: 'act-new-issue', label: 'ثبت شمارهٔ جدید', hint: 'اقدام', icon: <BookOpen className="size-4" />, to: `${base}/issues/new`, keywords: 'new issue شماره' },
    ...publications
      .filter((p) => p.publication_id !== pubId)
      .map((p) => ({ id: `pub-${p.publication_id}`, label: p.title, hint: 'تغییر نشریه', icon: <BookOpen className="size-4" />, to: `/team/${p.publication_id}` })),
    ...(pub ? [{ id: 'act-public', label: 'صفحهٔ عمومی نشریه', hint: 'اقدام', icon: <ClipboardCheck className="size-4" />, to: `/p/${pub.slug}` }] : []),
    { id: 'act-settings', label: 'تنظیمات حساب من', hint: 'اقدام', icon: <Settings className="size-4" />, to: '/settings', keywords: 'password totp رمز' },
    { id: 'act-site', label: 'رفتن به سایت', hint: 'اقدام', icon: <House className="size-4" />, to: '/' }
  ]

  const current = navItems.find((n) => (n.to ? loc.pathname.startsWith(`${base}/${n.to}`) : loc.pathname === base || loc.pathname === base + '/'))

  return (
    <Ctx.Provider value={{ pubId, pub, base }}>
      <div className="min-h-dvh md:flex">
        <a href="#main" className="skip-link">پرش به محتوای اصلی</a>
        <header className="no-print sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-surface/95 px-2 py-2 backdrop-blur md:hidden">
          <button className="rounded-xl p-2 hover:bg-surface-2" onClick={() => setDrawer(true)} aria-label="باز کردن منو" aria-expanded={drawer} aria-controls="team-drawer">
            <Menu className="size-6" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] leading-4 text-muted">{pub?.title || 'پنل نشریه'}</div>
            <div className="truncate text-sm font-bold leading-5">{current?.label || 'پنل نشریه'}</div>
          </div>
          <PageHelpButton base={base} help={TEAM_HELP} compact />
          <NotificationBell />
          <Link to="/" className="rounded-xl p-2 hover:bg-surface-2" aria-label="سایت">
            <House className="size-5" />
          </Link>
        </header>
        {drawer && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setDrawer(false)} aria-hidden />}
        <aside
          id="team-drawer"
          className={cx(
            'no-print fixed inset-y-0 right-0 z-50 w-72 max-w-[85vw] overflow-y-auto border-l border-line bg-surface shadow-xl transition-transform duration-200',
            drawer ? 'translate-x-0' : 'translate-x-full',
            'md:sticky md:top-0 md:z-auto md:h-dvh md:w-60 md:max-w-none md:shrink-0 md:translate-x-0 md:shadow-none'
          )}
          aria-label="منوی پنل نشریه"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line p-3">
            <div className="min-w-0">
              <div className="text-xs text-muted">پنل نشریه</div>
              {publications.length > 1 ? (
                <select className="mt-0.5 max-w-full bg-transparent text-sm font-bold outline-none" value={pubId} onChange={(e) => nav(`/team/${e.target.value}`)} aria-label="تغییر نشریه">
                  {publications.map((p) => (
                    <option key={p.publication_id} value={p.publication_id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="truncate text-sm font-bold">{pub?.title || 'نشریه'}</div>
              )}
              {pub && <div className="text-[11px] text-muted">{PUB_ROLE_LABEL[pub.role] || pub.role}</div>}
            </div>
            <div className="flex items-center">
              <span className="hidden md:inline-flex">
                <NotificationBell />
              </span>
              <Link to="/" className="hidden rounded-lg p-2 hover:bg-surface-2 md:inline-flex" aria-label="سایت">
                <House className="size-5" />
              </Link>
              <button className="rounded-lg p-2 hover:bg-surface-2 md:hidden" onClick={() => setDrawer(false)} aria-label="بستن منو">
                <X className="size-5" />
              </button>
            </div>
          </div>
          <div className="hidden px-2 pt-2 md:block">
            <PaletteButton />
          </div>
          <nav className="flex flex-col gap-1 p-2" aria-label="منوی پنل نشریه">
            {navItems.map((n) => (
              <NavLink
                key={n.to}
                to={n.to ? `${base}/${n.to}` : base}
                end={n.end}
                className={({ isActive }) => cx('flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm', isActive ? 'bg-brand-soft font-bold text-brand' : 'text-muted hover:bg-surface-2 hover:text-ink')}
              >
                <n.icon className="size-4" />
                {n.label}
              </NavLink>
            ))}
            {pub && (
              <Link to={`/p/${pub.slug}`} className="flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted hover:bg-surface-2">
                <ClipboardCheck className="size-4" />
                صفحهٔ عمومی
              </Link>
            )}
          </nav>
          <div className="hidden border-t border-line p-2 md:block">
            <PageHelpButton base={base} help={TEAM_HELP} />
          </div>
        </aside>
        <main id="main" className="min-w-0 flex-1 p-4 md:p-6">
          {!!user.must_change_password && (
            <div className="card mb-4 border-amber-400 p-3 text-sm">
              رمز عبور شما موقت است. <Link to="/settings" className="font-bold text-brand">همین حالا تغییرش دهید</Link>
            </div>
          )}
          <ErrorBoundary inline key={loc.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
        <CommandPalette items={paletteItems} placeholder="جست‌وجو در صفحه‌های پنل تیم…" />
        <Tour scope="team" userId={user.id} steps={TEAM_TOUR} />
      </div>
    </Ctx.Provider>
  )
}

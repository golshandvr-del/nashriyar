import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Bell, Compass, House, LayoutDashboard, Library, ListChecks, LogIn, Moon, Search, Sun, User } from 'lucide-react'
import { useAuth, isDeveloper, isMonitor } from '../lib/auth'
import { api } from '../lib/api'
import { applyTheme, getTheme } from '../lib/theme'
import { cx } from '../lib/format'
import { useFeature } from '../lib/features'
import { ErrorBoundary } from './Static'

function ThemeButton() {
  const [t, setT] = useState(getTheme())
  useEffect(() => {
    const on = (e: Event) => setT((e as CustomEvent).detail)
    window.addEventListener('nsh:theme', on)
    return () => window.removeEventListener('nsh:theme', on)
  }, [])
  const dark = document.documentElement.classList.contains('dark')
  return (
    <button
      className="rounded-xl p-2 hover:bg-surface-2"
      aria-label={dark ? 'حالت روشن' : 'حالت تیره'}
      onClick={() => {
        const next = dark ? 'light' : 'dark'
        applyTheme(next, false)
        setT(next)
        api.post('/api/auth/theme', { theme: next }).catch(() => {})
      }}
      data-theme={t}
    >
      {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  )
}

export default function PublicLayout() {
  const { user, publications } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    if (!user) return setUnread(0)
    api
      .get<{ unread: number }>('/api/me/notifications')
      .then((r) => setUnread(r.unread || 0))
      .catch(() => {})
  }, [user, loc.pathname])

  // "/" focuses search (UX.md keyboard shortcut)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault()
        nav('/search')
      }
    }
    document.addEventListener('keydown', on)
    return () => document.removeEventListener('keydown', on)
  }, [nav])

  const panel = user && (isDeveloper(user) ? '/system' : isMonitor(user) ? '/admin' : publications.length ? '/team' : null)
  const exploreOn = useFeature('explore')
  const memberPortal = useFeature('member_portal')
  const panelLabel = panel === '/system' ? 'پنل طراح' : panel === '/admin' ? 'پنل مدیریت' : 'پنل نشریه'
  const items = [
    { to: '/', label: 'خانه', icon: House, end: true },
    { to: '/explore', label: 'اکسپلور', icon: Compass },
    { to: '/search', label: 'جست‌وجو', icon: Search },
    { to: '/library', label: 'کتابخانه', icon: Library },
    { to: user ? '/settings' : '/login', label: user ? 'من' : 'ورود', icon: user ? User : LogIn }
  ].filter((i) => exploreOn || i.to !== '/explore')
  // Mobile bottom bar: staff and team members always get a one-tap "my panel" entry
  // (the header link is hidden on small screens — this was why the panels looked missing on phones).
  const bottomItems = panel
    ? [...items.filter((i) => i.to !== '/search').slice(0, 3), { to: panel, label: 'پنل من', icon: LayoutDashboard }, items[items.length - 1]]
    : items
  const hideChrome = loc.pathname.startsWith('/read/')

  return (
    <div className="min-h-dvh">
      <a href="#main" className="skip-link">پرش به محتوای اصلی</a>
      {!hideChrome && (
        <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
            <Link to="/" className="flex items-center gap-2 text-lg font-extrabold text-brand">
              <img src="/favicon.svg" alt="" className="size-7" />
              نشریار
            </Link>
            <nav className="ms-6 hidden gap-1 md:flex" aria-label="ناوبری اصلی">
              {items.slice(0, 4).map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cx('rounded-xl px-3 py-1.5 text-sm', isActive ? 'bg-brand-soft font-bold text-brand' : 'text-muted hover:text-ink')}>
                  {i.label}
                </NavLink>
              ))}
              <NavLink to="/categories" className={({ isActive }) => cx('rounded-xl px-3 py-1.5 text-sm', isActive ? 'bg-brand-soft font-bold text-brand' : 'text-muted hover:text-ink')}>
                دسته‌ها
              </NavLink>
            </nav>
            <div className="ms-auto flex items-center gap-1">
              {panel && (
                <Link to={panel} className="btn-ghost hidden items-center gap-1 sm:inline-flex">
                  <LayoutDashboard className="size-4" /> {panelLabel}
                </Link>
              )}
              {panel && (
                <Link to="/search" className="rounded-xl p-2 hover:bg-surface-2 md:hidden" aria-label="جست‌وجو">
                  <Search className="size-5" />
                </Link>
              )}
              {user && memberPortal && !panel && (
                <Link to="/my-sections" className="rounded-xl p-2 hover:bg-surface-2" aria-label="بخش‌های من" title="بخش‌های من">
                  <ListChecks className="size-5" />
                </Link>
              )}
              {user && (
                <Link to="/notifications" className="relative rounded-xl p-2 hover:bg-surface-2" aria-label="اعلان‌ها">
                  <Bell className="size-5" />
                  {unread > 0 && <span className="absolute end-1 top-1 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 text-white">{unread > 9 ? '۹+' : unread.toLocaleString('fa-IR')}</span>}
                </Link>
              )}
              <ThemeButton />
              {user ? (
                <Link to="/settings" className="hidden rounded-xl px-3 py-1.5 text-sm hover:bg-surface-2 md:block">
                  {user.display_name}
                </Link>
              ) : (
                <Link to="/login" className="btn-primary hidden md:inline-flex">
                  ورود
                </Link>
              )}
            </div>
          </div>
        </header>
      )}

      <main id="main" className={cx('mx-auto max-w-6xl', hideChrome ? '' : 'px-4 pb-24 pt-4 md:pb-10')}>
        <ErrorBoundary inline key={loc.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>

      {!hideChrome && (
        <footer className="mx-auto hidden max-w-6xl justify-center gap-4 px-4 pb-8 text-xs text-muted md:flex">
          <Link to="/guide" className="hover:text-brand">راهنما</Link>
          <Link to="/terms" className="hover:text-brand">قوانین استفاده</Link>
          <Link to="/privacy" className="hover:text-brand">حریم خصوصی</Link>
          <Link to="/verify" className="hover:text-brand">استعلام گواهی</Link>
        </footer>
      )}

      {!hideChrome && (
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="ناوبری پایین">
          <div className="grid grid-cols-5">
            {bottomItems.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cx('flex flex-col items-center gap-0.5 py-2 text-[11px]', isActive ? 'font-bold text-brand' : 'text-muted')}>
                <i.icon className="size-5" />
                {i.label}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  )
}

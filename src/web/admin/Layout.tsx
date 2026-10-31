import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import {
  Activity, BarChart3, BookCopy, Building2, CheckSquare, FileText, FolderTree, House, LayoutDashboard, Lightbulb, Megaphone, Menu, ScrollText, Settings, ShieldAlert, Store, UserCog, Users, X
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ROLE_LABEL, isAdmin, isMonitor, useAuth } from '../lib/auth'
import type { SystemRole } from '../lib/auth'
import { cx } from '../lib/format'
import { PageLoader } from '../components/ui'
import { CommandPalette, PaletteButton } from '../components/CommandPalette'
import { NotificationBell } from '../components/NotificationBell'
import type { PaletteItem } from '../components/CommandPalette'
import { api } from '../lib/api'
import { ErrorBoundary } from '../public/Static'

type Access = 'monitor' | 'admin' | 'approver' | 'super'
interface NavItem { to: string; label: string; icon: LucideIcon; access: Access; end?: boolean }

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'پایش',
    items: [
      { to: '', label: 'نمای کلی', icon: LayoutDashboard, access: 'monitor', end: true },
      { to: 'live', label: 'برد زنده', icon: Activity, access: 'monitor' },
      { to: 'analytics', label: 'آمار و تحلیل', icon: BarChart3, access: 'monitor' },
      { to: 'insights', label: 'بینش‌ها', icon: Lightbulb, access: 'monitor' },
      { to: 'report', label: 'گزارش دوره‌ای', icon: FileText, access: 'monitor' }
    ]
  },
  {
    group: 'مدیریت',
    items: [
      { to: 'approvals', label: 'تأیید انتشار', icon: CheckSquare, access: 'approver' },
      { to: 'publications', label: 'نشریات', icon: BookCopy, access: 'monitor' },
      { to: 'people', label: 'پروندهٔ افراد', icon: Users, access: 'monitor' },
      { to: 'structure', label: 'ساختار دانشگاه', icon: Building2, access: 'monitor' },
      { to: 'categories', label: 'دسته‌بندی‌ها', icon: FolderTree, access: 'monitor' }
    ]
  },
  {
    group: 'محتوا و ارتباط',
    items: [
      { to: 'moderation', label: 'نظارت محتوا', icon: ShieldAlert, access: 'admin' },
      { to: 'storefront', label: 'ویترین', icon: Store, access: 'admin' },
      { to: 'announcements', label: 'اطلاعیه و مهلت', icon: Megaphone, access: 'admin' }
    ]
  },
  {
    group: 'سامانه',
    items: [
      { to: 'users', label: 'کاربران', icon: UserCog, access: 'admin' },
      { to: 'audit', label: 'گزارش رویدادها', icon: ScrollText, access: 'admin' },
      { to: 'settings', label: 'تنظیمات', icon: Settings, access: 'admin' }
    ]
  }
]

export function canAccess(role: SystemRole | undefined, a: Access): boolean {
  if (!role) return false
  if (a === 'monitor') return ['super_admin', 'pub_officer', 'faculty_supervisor', 'analyst'].includes(role)
  if (a === 'approver') return ['super_admin', 'pub_officer', 'faculty_supervisor'].includes(role)
  if (a === 'super') return role === 'super_admin'
  return role === 'super_admin' || role === 'pub_officer'
}

export function useAdminRole() {
  const { user } = useAuth()
  return { role: user?.system_role, admin: isAdmin(user), isSuper: user?.system_role === 'super_admin', user }
}

/** Live palette results: publications matching the query (scoped by the API to what the user may see). */
const searchPublications = async (q: string): Promise<PaletteItem[]> => {
  const r = await api.get<{ publications: { id: string; title: string; status: string }[] }>(`/api/admin/publications?q=${encodeURIComponent(q)}`)
  return r.publications.slice(0, 8).map((p) => ({ id: `pub-${p.id}`, label: p.title, hint: 'نشریه', icon: <BookCopy className="size-4" />, to: `/admin/publications/${p.id}` }))
}

export default function AdminLayout() {
  const { user, loading } = useAuth()
  const loc = useLocation()
  // Mobile: the menu lives in a slide-in drawer (a horizontal tab strip used to overlap on phones).
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
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login?next=/admin" replace />
  if (!isMonitor(user)) return <Navigate to="/" replace />
  const role = user.system_role
  const paletteItems: PaletteItem[] = [
    ...NAV.flatMap((g) =>
      g.items
        .filter((n) => canAccess(role, n.access))
        .map((n) => ({ id: `nav-${n.to || 'home'}`, label: n.label, hint: g.group, icon: <n.icon className="size-4" />, to: n.to ? `/admin/${n.to}` : '/admin' }))
    ),
    ...(canAccess(role, 'admin') ? [{ id: 'act-new-pub', label: 'ثبت نشریهٔ جدید', hint: 'اقدام', icon: <BookCopy className="size-4" />, to: '/admin/publications/new', keywords: 'new publication' }] : []),
    { id: 'act-settings', label: 'تنظیمات حساب من', hint: 'اقدام', icon: <Settings className="size-4" />, to: '/settings', keywords: 'password totp رمز' },
    { id: 'act-site', label: 'رفتن به سایت', hint: 'اقدام', icon: <House className="size-4" />, to: '/' }
  ]

  const current = NAV.flatMap((g) => g.items).find((n) => (n.to ? loc.pathname.startsWith(`/admin/${n.to}`) : loc.pathname === '/admin' || loc.pathname === '/admin/'))

  return (
    <div className="min-h-dvh md:flex">
      <a href="#main" className="skip-link">پرش به محتوای اصلی</a>
      {/* Mobile top bar */}
      <header className="no-print sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-surface/95 px-2 py-2 backdrop-blur md:hidden">
        <button className="rounded-xl p-2 hover:bg-surface-2" onClick={() => setDrawer(true)} aria-label="باز کردن منو" aria-expanded={drawer} aria-controls="admin-drawer">
          <Menu className="size-6" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] leading-4 text-muted">پنل مدیریت</div>
          <div className="truncate text-sm font-bold leading-5">{current?.label || 'پنل مدیریت'}</div>
        </div>
        <NotificationBell />
        <Link to="/" className="rounded-xl p-2 hover:bg-surface-2" aria-label="سایت">
          <House className="size-5" />
        </Link>
      </header>
      {drawer && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setDrawer(false)} aria-hidden />}
      <aside
        id="admin-drawer"
        className={cx(
          'no-print fixed inset-y-0 right-0 z-50 w-72 max-w-[85vw] overflow-y-auto border-l border-line bg-surface shadow-xl transition-transform duration-200',
          drawer ? 'translate-x-0' : 'translate-x-full',
          'md:sticky md:top-0 md:z-auto md:h-dvh md:w-60 md:max-w-none md:shrink-0 md:translate-x-0 md:shadow-none'
        )}
        aria-label="منوی مدیریت"
      >
        <div className="flex items-center justify-between gap-2 border-b border-line p-3">
          <div className="min-w-0">
            <div className="text-xs text-muted">پنل مدیریت</div>
            <div className="truncate text-sm font-bold">{user.display_name}</div>
            <div className="text-[11px] text-muted">{ROLE_LABEL[role]}</div>
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
        <nav className="flex flex-col gap-1 p-2" aria-label="منوی مدیریت">
          {NAV.map((g) => {
            const items = g.items.filter((n) => canAccess(role, n.access))
            if (!items.length) return null
            return (
              <div key={g.group} className="mb-2 flex flex-col gap-1">
                <div className="px-3 pt-2 pb-1 text-[11px] font-bold text-muted">{g.group}</div>
                {items.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to ? `/admin/${n.to}` : '/admin'}
                    end={n.end}
                    className={({ isActive }) => cx('flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm', isActive ? 'bg-brand-soft font-bold text-brand' : 'text-muted hover:bg-surface-2 hover:text-ink')}
                  >
                    <n.icon className="size-4" />
                    {n.label}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
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
      <CommandPalette items={paletteItems} source={searchPublications} />
    </div>
  )
}

/** Guards a page that needs a stronger role than "monitor". */
export function RequireAccess({ access, children }: { access: Access; children: React.ReactNode }) {
  const { role } = useAdminRole()
  if (!canAccess(role, access)) return <Navigate to="/admin" replace />
  return <>{children}</>
}

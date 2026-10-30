import { Link, NavLink, Navigate, Outlet } from 'react-router-dom'
import {
  Activity, BarChart3, BookCopy, Building2, CheckSquare, FileText, FolderTree, House, LayoutDashboard, Lightbulb, Megaphone, ScrollText, Settings, ShieldAlert, Store, UserCog, Users
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ROLE_LABEL, isAdmin, isMonitor, useAuth } from '../lib/auth'
import type { SystemRole } from '../lib/auth'
import { cx } from '../lib/format'
import { PageLoader } from '../components/ui'

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

export default function AdminLayout() {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login?next=/admin" replace />
  if (!isMonitor(user)) return <Navigate to="/" replace />
  const role = user.system_role

  return (
    <div className="min-h-dvh md:flex">
      <aside className="no-print border-line bg-surface md:sticky md:top-0 md:h-dvh md:w-60 md:shrink-0 md:overflow-y-auto md:border-l">
        <div className="flex items-center justify-between gap-2 border-b border-line p-3">
          <div className="min-w-0">
            <div className="text-xs text-muted">پنل مدیریت</div>
            <div className="truncate text-sm font-bold">{user.display_name}</div>
            <div className="text-[11px] text-muted">{ROLE_LABEL[role]}</div>
          </div>
          <Link to="/" className="rounded-lg p-2 hover:bg-surface-2" aria-label="سایت">
            <House className="size-5" />
          </Link>
        </div>
        <nav className="no-scrollbar flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-visible" aria-label="منوی مدیریت">
          {NAV.map((g) => {
            const items = g.items.filter((n) => canAccess(role, n.access))
            if (!items.length) return null
            return (
              <div key={g.group} className="flex gap-1 md:mb-2 md:flex-col">
                <div className="hidden px-3 pt-2 pb-1 text-[11px] font-bold text-muted md:block">{g.group}</div>
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
      <main className="min-w-0 flex-1 p-4 md:p-6">
        {!!user.must_change_password && (
          <div className="card mb-4 border-amber-400 p-3 text-sm">
            رمز عبور شما موقت است. <Link to="/settings" className="font-bold text-brand">همین حالا تغییرش دهید</Link>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  )
}

/** Guards a page that needs a stronger role than "monitor". */
export function RequireAccess({ access, children }: { access: Access; children: React.ReactNode }) {
  const { role } = useAdminRole()
  if (!canAccess(role, access)) return <Navigate to="/admin" replace />
  return <>{children}</>
}

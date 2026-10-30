import { createContext, useContext, useEffect } from 'react'
import { Link, NavLink, Navigate, Outlet, useNavigate, useParams } from 'react-router-dom'
import { BarChart3, BookOpen, ClipboardCheck, House, Images, LayoutDashboard, Megaphone, MessageCircle, Settings, Ticket, Users } from 'lucide-react'
import { useAuth, PUB_ROLE_LABEL, isAdmin } from '../lib/auth'
import type { PubRole } from '../lib/auth'
import { cx } from '../lib/format'
import { Empty, PageLoader } from '../components/ui'

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
  if (loading) return <PageLoader />
  if (!user) return <Navigate to={`/login?next=/team/${pubId}`} replace />
  const pub = publications.find((p) => p.publication_id === pubId) || null
  if (!pub && !isAdmin(user)) return <Navigate to="/team" replace />
  const base = `/team/${pubId}`

  return (
    <Ctx.Provider value={{ pubId, pub, base }}>
      <div className="min-h-dvh md:flex">
        <aside className="no-print border-line bg-surface md:sticky md:top-0 md:h-dvh md:w-60 md:shrink-0 md:overflow-y-auto md:border-l">
          <div className="flex items-center justify-between gap-2 border-b border-line p-3">
            <div className="min-w-0">
              <div className="text-xs text-muted">پنل تیم</div>
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
            <Link to="/" className="rounded-lg p-2 hover:bg-surface-2" aria-label="سایت">
              <House className="size-5" />
            </Link>
          </div>
          <nav className="no-scrollbar flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-visible">
            {NAV.map((n) => (
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
    </Ctx.Provider>
  )
}

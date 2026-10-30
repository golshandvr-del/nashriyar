// Notification bell with unread badge, shared by the admin and team panels (ROADMAP phase 9:
// notification centre for every role). Refreshes on route change; links to the common /notifications page.
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { api } from '../lib/api'

export function NotificationBell({ className }: { className?: string }) {
  const loc = useLocation()
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    api
      .get<{ unread: number }>('/api/me/notifications')
      .then((r) => setUnread(r.unread || 0))
      .catch(() => {})
  }, [loc.pathname])
  return (
    <Link to="/notifications" className={`relative rounded-lg p-2 hover:bg-surface-2 ${className || ''}`} aria-label={unread ? `اعلان‌ها (${unread} خوانده‌نشده)` : 'اعلان‌ها'}>
      <Bell className="size-5" />
      {unread > 0 && (
        <span className="absolute end-0.5 top-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 text-white">{unread > 9 ? '۹+' : unread.toLocaleString('fa-IR')}</span>
      )}
    </Link>
  )
}

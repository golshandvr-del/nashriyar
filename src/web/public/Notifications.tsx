import { useEffect } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { relativeFa, cx } from '../lib/format'
import { Async, Empty, useAsync } from '../components/ui'

interface Notif {
  id: string
  type: string
  title: string
  link: string | null
  read_at: string | null
  created_at: string
}

export default function Notifications() {
  const { user, loading } = useAuth()
  const st = useAsync(() => (user ? api.get<{ items: Notif[]; unread: number }>('/api/me/notifications') : Promise.resolve({ items: [], unread: 0 })), [user?.id])

  // mark everything read once the list has been shown
  useEffect(() => {
    if (st.data?.unread) api.post('/api/me/notifications/read-all').catch(() => {})
  }, [st.data])

  if (!loading && !user) return <Navigate to="/login?next=/notifications" replace />
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-4 text-xl font-extrabold">اعلان‌ها</h1>
      <Async state={st}>
        {(d) =>
          d.items.length ? (
            <ul className="card divide-y divide-line">
              {d.items.map((n) => {
                const body = (
                  <div className={cx('flex items-start gap-3 p-3', !n.read_at && 'bg-brand-soft/40')}>
                    <Bell className={cx('mt-0.5 size-4 shrink-0', n.read_at ? 'text-muted' : 'text-brand')} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{n.title}</p>
                      <p className="text-xs text-muted">{relativeFa(n.created_at)}</p>
                    </div>
                  </div>
                )
                return <li key={n.id}>{n.link && n.link.startsWith('/') ? <Link to={n.link}>{body}</Link> : body}</li>
              })}
            </ul>
          ) : (
            <Empty icon={<Bell className="size-10 opacity-60" />} title="اعلانی ندارید" />
          )
        }
      </Async>
    </div>
  )
}

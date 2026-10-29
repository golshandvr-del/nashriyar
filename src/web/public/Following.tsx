import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Async, Empty, Tabs, useAsync } from '../components/ui'
import { PostCard, PubCard } from '../components/cards'
import type { PostLite, PubLite } from '../components/cards'

type Tab = 'feed' | 'pubs'

export default function Following() {
  const { user, loading } = useAuth()
  const [tab, setTab] = useState<Tab>('feed')
  const feed = useAsync(() => (user ? api.get<{ posts: PostLite[] }>('/api/me/feed') : Promise.resolve({ posts: [] })), [user?.id])
  const pubs = useAsync(() => (user ? api.get<{ publications: PubLite[] }>('/api/me/follows') : Promise.resolve({ publications: [] })), [user?.id])
  if (!loading && !user) return <Navigate to="/login?next=/following" replace />
  const noFollow = (
    <Empty
      title="هنوز نشریه‌ای را دنبال نمی‌کنید"
      hint="با دنبال کردن نشریه‌ها، پست‌های تازه‌شان را اینجا می‌بینید."
      action={
        <Link to="/categories" className="btn-primary">
          یافتن نشریه
        </Link>
      }
    />
  )
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-4 text-xl font-extrabold">دنبال‌شده‌ها</h1>
      <Tabs<Tab>
        tabs={[
          { key: 'feed', label: 'تازه‌ها' },
          { key: 'pubs', label: 'نشریه‌ها' }
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'feed' ? (
        <Async state={feed}>
          {(d) =>
            d.posts.length ? (
              <div className="space-y-4">
                {d.posts.map((p) => (
                  <PostCard key={p.id} post={p} />
                ))}
              </div>
            ) : (
              noFollow
            )
          }
        </Async>
      ) : (
        <Async state={pubs}>
          {(d) =>
            d.publications.length ? (
              <div className="space-y-3">
                {d.publications.map((p) => (
                  <PubCard key={p.id} pub={p} />
                ))}
              </div>
            ) : (
              noFollow
            )
          }
        </Async>
      )}
    </div>
  )
}

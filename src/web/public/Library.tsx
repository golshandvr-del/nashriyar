import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { BookOpen, KeyRound, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFeature } from '../lib/features'
import { faDate, relativeFa, toFaDigits, cx } from '../lib/format'
import { Async, Button, Empty, Progress, Tabs, useAction, useAsync, useToast } from '../components/ui'
import { Cover, PostGrid } from '../components/cards'
import type { PostLite } from '../components/cards'

interface Item {
  id: string
  number: number
  title: string
  cover_key: string | null
  page_count: number
  pricing: string
  publication_slug: string
  publication_title: string
  theme_color: string | null
  source: 'free' | 'code' | 'gift' | string
  granted_at: string
  last_page: number | null
  percent: number | null
  read_at: string | null
}

type Tab = 'all' | 'reading' | 'saved'

export default function Library() {
  const { user, loading } = useAuth()
  const paidOn = useFeature('paid_content')
  const st = useAsync(() => (user ? api.get<{ items: Item[] }>('/api/me/library') : Promise.resolve({ items: [] })), [user?.id])
  const saved = useAsync(() => (user ? api.get<{ posts: PostLite[] }>('/api/me/saved') : Promise.resolve({ posts: [] })), [user?.id])
  const [tab, setTab] = useState<Tab>('all')
  const { confirm } = useToast()
  const act = useAction()

  if (!loading && !user) return <Navigate to="/login?next=/library" replace />

  return (
    <div>
      <header className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold">کتابخانهٔ من</h1>
        {paidOn && (
          <Link to="/redeem">
            <Button variant="ghost" icon={<KeyRound className="size-4" />}>
              ثبت کد خرید
            </Button>
          </Link>
        )}
      </header>
      <Tabs<Tab>
        tabs={[
          { key: 'all', label: 'همه' },
          { key: 'reading', label: 'در حال خواندن' },
          { key: 'saved', label: 'پست‌های ذخیره‌شده' }
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'saved' ? (
        <Async state={saved}>{(d) => (d.posts.length ? <PostGrid posts={d.posts} /> : <Empty title="پستی ذخیره نکرده‌اید" hint="با زدن نشانک روی پست‌ها، آن‌ها اینجا جمع می‌شوند." />)}</Async>
      ) : (
        <Async state={st}>
          {(d) => {
            const items = tab === 'reading' ? d.items.filter((i) => (i.percent ?? 0) > 0 && (i.percent ?? 0) < 100) : d.items
            if (!items.length)
              return (
                <Empty
                  icon={<BookOpen className="size-10 opacity-60" />}
                  title={tab === 'reading' ? 'شماره‌ای در حال خواندن ندارید' : 'کتابخانهٔ شما خالی است'}
                  hint="شماره‌های رایگان را از پیشخوان اضافه کنید یا کد خرید شماره‌های پولی را ثبت کنید."
                  action={
                    <Link to="/" className="btn-primary">
                      رفتن به پیشخوان
                    </Link>
                  }
                />
              )
            const remove = async (i: Item) => {
              if (!(await confirm(`«${i.title}» از کتابخانه حذف شود؟`, { danger: true, okLabel: 'حذف' }))) return
              const r = await act.run(() => api.del(`/api/me/library/${i.id}`), 'حذف شد')
              if (r) st.setData({ items: d.items.filter((x) => x.id !== i.id) })
            }
            return (
              <ul className="grid gap-3 sm:grid-cols-2">
                {items.map((i) => (
                  <li key={i.id} className="card flex gap-3 p-3">
                    <Link to={`/issue/${i.id}`} className="w-20 shrink-0">
                      <Cover src={i.cover_key} title={i.title} color={i.theme_color} />
                    </Link>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="truncate text-xs text-muted">{i.publication_title}</div>
                      <div className="line-clamp-2 font-bold">{i.title}</div>
                      <div className="text-xs text-muted">
                        شمارهٔ {toFaDigits(i.number)} · {i.source === 'code' ? 'خریداری‌شده' : i.source === 'free' ? 'رایگان' : 'هدیه'} · {faDate(i.granted_at)}
                      </div>
                      <div className="mt-auto pt-2">
                        <Progress value={i.percent ?? 0} />
                        <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                          <span>{i.percent ? `${toFaDigits(i.percent)}٪ خوانده‌شده` : 'خوانده‌نشده'}</span>
                          {i.read_at && <span>· {relativeFa(i.read_at)}</span>}
                          <span className="ms-auto flex gap-1">
                            {i.source === 'free' && (
                              <button className="rounded-lg p-1 hover:text-danger" onClick={() => remove(i)} aria-label="حذف از کتابخانه">
                                <Trash2 className="size-4" />
                              </button>
                            )}
                            <Link to={`/read/${i.id}${i.last_page ? `?page=${i.last_page}` : ''}`} className={cx('btn-primary px-3 py-1 text-xs')}>
                              {i.last_page ? 'ادامه' : 'خواندن'}
                            </Link>
                          </span>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )
          }}
        </Async>
      )}
    </div>
  )
}

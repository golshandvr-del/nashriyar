import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useAsync, Async, Empty } from '../components/ui'
import { Shelf } from '../components/cards'
import type { IssueLite } from '../components/cards'
import { useAuth } from '../lib/auth'

interface HomeData {
  latest: IssueLite[]
  shelves: { id: string; title: string; items: IssueLite[] }[]
  categoryShelves: { category: { id: string; name: string; slug: string; icon?: string; color?: string }; items: IssueLite[] }[]
  free: IssueLite[]
  categories: { id: string; name: string; slug: string; color?: string }[]
  banners: { title?: string; text?: string; link?: string; color?: string }[]
}

export default function Home() {
  const st = useAsync(() => api.get<HomeData>('/api/public/home'), [])
  const { user } = useAuth()
  return (
    <Async state={st}>
      {(d) => (
        <div>
          {!user && (
            <section id="hero-section" className="card mb-6 overflow-hidden bg-gradient-to-l from-brand to-teal-500 p-6 text-white">
              <h1 className="text-2xl font-extrabold">پیشخوان نشریات دانشجویی</h1>
              <p className="mt-2 max-w-xl text-sm opacity-90">همهٔ نشریه‌های دانشگاه در یک جا؛ شماره‌های رایگان را بدون ورود بخوانید و برای شماره‌های پولی کد خرید وارد کنید.</p>
              <div className="mt-4 flex gap-2">
                <Link to="/register" className="btn bg-white text-brand">
                  ثبت‌نام دانشجو
                </Link>
                <Link to="/explore" className="btn border border-white/50 text-white">
                  گشت‌وگذار
                </Link>
              </div>
            </section>
          )}

          {d.banners?.length > 0 && (
            <div className="no-scrollbar -mx-4 mb-6 flex gap-3 overflow-x-auto px-4">
              {d.banners.map((b, i) => (
                <a key={i} href={b.link || '#'} className="card min-w-72 p-4 text-white" style={{ background: b.color || 'var(--brand)' }}>
                  <div className="font-bold">{b.title}</div>
                  {b.text && <div className="text-sm opacity-90">{b.text}</div>}
                </a>
              ))}
            </div>
          )}

          {d.categories?.length > 0 && (
            <nav aria-label="دسته‌ها" className="no-scrollbar -mx-4 mb-6 flex gap-2 overflow-x-auto px-4">
              {d.categories.map((c) => (
                <Link key={c.id} to={`/c/${c.slug}`} className="chip shrink-0 hover:border-brand">
                  <span className="size-2 rounded-full" style={{ background: c.color || 'var(--brand)' }} />
                  {c.name}
                </Link>
              ))}
              <Link to="/categories" className="chip shrink-0 text-brand">
                همهٔ دسته‌ها
              </Link>
            </nav>
          )}

          {!d.latest.length && <Empty title="هنوز شماره‌ای منتشر نشده است" />}
          <Shelf title="تازه‌ترین شماره‌ها" issues={d.latest} />
          {d.shelves.map((s) => (
            <Shelf key={s.id} title={s.title} issues={s.items} />
          ))}
          <Shelf title="رایگان بخوانید" issues={d.free} />
          {d.categoryShelves.map((s) => (
            <Shelf key={s.category.id} title={s.category.name} issues={s.items} more={`/c/${s.category.slug}`} />
          ))}
        </div>
      )}
    </Async>
  )
}

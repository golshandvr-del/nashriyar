import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, qs, mediaUrl } from '../lib/api'
import { PostMasonry } from '../components/cards'
import type { PostLite } from '../components/cards'
import { Avatar, Empty, ErrorBox, Spinner } from '../components/ui'
import { cx } from '../lib/format'

interface Story extends PostLite {}

export default function Explore() {
  const [posts, setPosts] = useState<PostLite[]>([])
  const [stories, setStories] = useState<Story[]>([])
  const [cats, setCats] = useState<{ id: string; name: string }[]>([])
  const [cat, setCat] = useState('')
  const [loading, setLoading] = useState(true)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const busy = useRef(false)

  useEffect(() => {
    api.get('/api/public/stories').then((r) => setStories(r.stories || [])).catch(() => {})
    api.get('/api/public/categories').then((r) => setCats((r.categories || []).filter((c: any) => c.type === 'subject' && !c.parent_id))).catch(() => {})
    api.post('/api/public/track', { type: 'explore' }).catch(() => {})
  }, [])

  const load = async (reset = false) => {
    if (busy.current) return
    busy.current = true
    setLoading(true)
    setError(null)
    try {
      const before = reset ? undefined : posts[posts.length - 1]?.published_at
      const r = await api.get<{ posts: PostLite[] }>(`/api/public/explore${qs({ before, category: cat })}`)
      setPosts((p) => (reset ? r.posts : [...p, ...r.posts]))
      setDone(r.posts.length < 30)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
      busy.current = false
    }
  }

  useEffect(() => {
    setPosts([])
    setDone(false)
    load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((e) => e[0].isIntersecting && !done && !loading && posts.length && load())
    io.observe(el)
    return () => io.disconnect()
  })

  // group stories by publication (one bubble per publication)
  const bubbles = Object.values(
    stories.reduce<Record<string, Story>>((m, s) => {
      if (!m[s.publication_slug!]) m[s.publication_slug!] = s
      return m
    }, {})
  )

  return (
    <div>
      {bubbles.length > 0 && (
        <section aria-label="استوری‌ها" className="no-scrollbar -mx-4 mb-4 flex gap-4 overflow-x-auto px-4 pb-1">
          {bubbles.map((s) => (
            <Link key={s.id} to={`/post/${s.id}`} className="flex w-16 shrink-0 flex-col items-center gap-1">
              <span className="rounded-full bg-gradient-to-tr from-amber-400 to-brand p-0.5">
                <span className="block rounded-full bg-surface p-0.5">
                  <Avatar src={mediaUrl(s.logo_key)} name={s.publication_title} color={s.theme_color} size={56} />
                </span>
              </span>
              <span className="w-full truncate text-center text-[11px]">{s.publication_title}</span>
            </Link>
          ))}
        </section>
      )}

      {cats.length > 0 && (
        <nav className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4" aria-label="فیلتر دسته">
          {[{ id: '', name: 'همه' }, ...cats].map((c) => (
            <button key={c.id} onClick={() => setCat(c.id)} className={cx('chip shrink-0', cat === c.id && 'border-brand bg-brand-soft font-bold text-brand')}>
              {c.name}
            </button>
          ))}
        </nav>
      )}

      {error && <ErrorBox error={error} onRetry={() => load(!posts.length)} />}
      {!loading && !posts.length && !error && <Empty title="پستی یافت نشد" />}
      <PostMasonry posts={posts} />
      <div ref={sentinel} className="flex justify-center py-6">
        {loading && <Spinner />}
      </div>
    </div>
  )
}

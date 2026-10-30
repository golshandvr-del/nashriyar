import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Bookmark, BookOpen, ChevronLeft, ChevronRight, Flag, MessageCircle, Share2 } from 'lucide-react'
import { api, mediaUrl } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFeature } from '../lib/features'
import { faDate, relativeFa, toFaDigits, cx } from '../lib/format'
import { Async, Avatar, Button, Textarea, useAction, useAsync, useToast } from '../components/ui'

interface PostData {
  post: {
    id: string
    caption: string | null
    images: string[]
    alts?: string[]
    published_at: string
    publication_slug: string
    publication_title: string
    logo_key: string | null
    theme_color: string | null
    source_issue_id: string
    source_issue_title: string
    source_issue_number: number
    source_toc_title: string | null
    source_page: number | null
  }
  comments: { id: string; body: string; created_at: string; parent_id: string | null; is_team_reply: number; author: string; pending?: number }[]
  saved: boolean
}

export default function Post() {
  const { id } = useParams()
  const st = useAsync(() => api.get<PostData>(`/api/public/posts/${id}`), [id])
  const { user } = useAuth()
  const commentsOn = useFeature('comments')
  const nav = useNavigate()
  const { toast, confirm } = useToast()
  const act = useAction()
  const [idx, setIdx] = useState(0)
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)

  const needLogin = () => {
    toast('برای این کار ابتدا وارد شوید', 'info')
    nav(`/login?next=/post/${id}`)
  }

  return (
    <Async state={st}>
      {(d) => {
        const p = d.post
        const imgs = p.images || []
        const toggleSave = async () => {
          if (!user) return needLogin()
          const r = await act.run(() => (d.saved ? api.del(`/api/me/saved/${p.id}`) : api.post(`/api/me/saved/${p.id}`)))
          if (r) st.setData({ ...d, saved: !d.saved })
        }
        const share = async () => {
          const url = location.href
          try {
            if (navigator.share) await navigator.share({ title: p.publication_title, url })
            else {
              await navigator.clipboard.writeText(url)
              toast('پیوند کپی شد')
            }
          } catch {}
        }
        const report = async () => {
          if (!user) return needLogin()
          if (!(await confirm('این پست به‌عنوان محتوای نامناسب به مسئول نشریات گزارش شود؟', { danger: true, okLabel: 'گزارش' }))) return
          await act.run(() => api.post('/api/me/reports', { entity_type: 'post', entity_id: p.id }), 'گزارش ثبت شد؛ متشکریم')
        }
        const send = async () => {
          if (!user) return needLogin()
          const r = await act.run(() => api.post(`/api/me/posts/${p.id}/comments`, { body: text, parent_id: replyTo }))
          if (r) {
            toast((r as any).message || 'نظر ثبت شد')
            setText('')
            setReplyTo(null)
            st.reload() // show the author's own pending comment right away
          }
        }
        const roots = d.comments.filter((c) => !c.parent_id)
        return (
          <article className="mx-auto max-w-xl">
            <header className="mb-3 flex items-center gap-2">
              <Avatar src={mediaUrl(p.logo_key)} name={p.publication_title} color={p.theme_color} size={40} />
              <div>
                <Link to={`/p/${p.publication_slug}`} className="font-bold">
                  {p.publication_title}
                </Link>
                <div className="text-xs text-muted">{faDate(p.published_at)}</div>
              </div>
            </header>

            {imgs.length > 0 && (
              <div className="relative overflow-hidden rounded-2xl border border-line bg-surface-2">
                <img src={mediaUrl(imgs[idx])} alt={p.alts?.[idx] || ''} className="aspect-square w-full object-cover" />
                {imgs.length > 1 && (
                  <>
                    <button className="absolute start-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1 text-white disabled:opacity-30" disabled={idx === 0} onClick={() => setIdx(idx - 1)} aria-label="قبلی">
                      <ChevronRight className="size-5" />
                    </button>
                    <button className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1 text-white disabled:opacity-30" disabled={idx === imgs.length - 1} onClick={() => setIdx(idx + 1)} aria-label="بعدی">
                      <ChevronLeft className="size-5" />
                    </button>
                    <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1">
                      {imgs.map((_, i) => (
                        <span key={i} className={cx('size-1.5 rounded-full', i === idx ? 'bg-white' : 'bg-white/50')} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="mt-3 flex items-center gap-1">
              <button onClick={toggleSave} className="rounded-xl p-2 hover:bg-surface-2" aria-label={d.saved ? 'حذف از ذخیره‌ها' : 'ذخیره'} aria-pressed={d.saved}>
                <Bookmark className={cx('size-6', d.saved && 'fill-current text-brand')} />
              </button>
              <button onClick={share} className="rounded-xl p-2 hover:bg-surface-2" aria-label="اشتراک‌گذاری">
                <Share2 className="size-6" />
              </button>
              <button onClick={report} className="ms-auto rounded-xl p-2 text-muted hover:bg-surface-2" aria-label="گزارش">
                <Flag className="size-5" />
              </button>
            </div>

            {p.caption && <p className="mt-2 whitespace-pre-line text-sm leading-7">{p.caption}</p>}

            <Link to={`/issue/${p.source_issue_id}`} className="card mt-4 flex items-center gap-3 p-3 hover:bg-surface-2">
              <BookOpen className="size-6 text-brand" />
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-bold">
                  برگرفته از شمارهٔ {toFaDigits(p.source_issue_number)}: {p.source_issue_title}
                </div>
                {p.source_toc_title && (
                  <div className="truncate text-xs text-muted">
                    {p.source_toc_title}
                    {p.source_page ? ` — صفحهٔ ${toFaDigits(p.source_page)}` : ''}
                  </div>
                )}
              </div>
              <span className="text-xs text-brand">مشاهدهٔ شماره</span>
            </Link>
            {/* ROADMAP phase 6: "read full" jumps straight to the source section in the reader (paywall/preview handled there) */}
            <Link
              to={`/read/${p.source_issue_id}${p.source_page ? `?page=${p.source_page}` : ''}`}
              onClick={() => api.post('/api/public/track', { type: 'read_full', id: p.id }).catch(() => {})}
              className="btn mt-2 w-full justify-center"
            >
              <BookOpen className="size-4" /> خواندن کامل
            </Link>

            <section className="mt-6" aria-label="نظرها">
              <h2 className="mb-3 flex items-center gap-2 font-bold">
                <MessageCircle className="size-5" /> نظرها ({toFaDigits(d.comments.length)})
              </h2>
              <ul className="space-y-3">
                {roots.map((c) => (
                  <li key={c.id} className="text-sm">
                    <div className={cx('rounded-xl p-3', c.is_team_reply ? 'bg-brand-soft' : 'bg-surface-2')}>
                      <div className="mb-1 flex items-center gap-2 text-xs">
                        <b>{c.author}</b>
                        <span className="text-muted">{relativeFa(c.created_at)}</span>
                        {c.pending ? <span className="rounded bg-amber-100 px-1.5 text-[10px] text-amber-800">در انتظار تأیید — فقط شما می‌بینید</span> : null}
                        {user && commentsOn && !c.pending && (
                          <button className="ms-auto text-brand" onClick={() => setReplyTo(c.id)}>
                            پاسخ
                          </button>
                        )}
                      </div>
                      <p className="whitespace-pre-line">{c.body}</p>
                    </div>
                    {d.comments
                      .filter((r) => r.parent_id === c.id)
                      .map((r) => (
                        <div key={r.id} className={cx('ms-6 mt-2 rounded-xl p-3', r.is_team_reply ? 'bg-brand-soft' : 'bg-surface-2')}>
                          <div className="mb-1 flex gap-2 text-xs">
                            <b>{r.author}</b>
                            <span className="text-muted">{relativeFa(r.created_at)}</span>
                            {r.pending ? <span className="rounded bg-amber-100 px-1.5 text-[10px] text-amber-800">در انتظار تأیید</span> : null}
                          </div>
                          <p className="whitespace-pre-line">{r.body}</p>
                        </div>
                      ))}
                  </li>
                ))}
              </ul>
              {!commentsOn ? (
                <p className="mt-4 rounded-xl bg-surface-2 p-3 text-sm text-muted">ارسال نظر در حال حاضر توسط مدیر سامانه غیرفعال است.</p>
              ) : (
              <div className="mt-4">
                {replyTo && (
                  <div className="mb-1 flex items-center gap-2 text-xs text-muted">
                    در پاسخ به یک نظر
                    <button className="text-brand" onClick={() => setReplyTo(null)}>
                      لغو
                    </button>
                  </div>
                )}
                <Textarea rows={3} maxLength={1000} placeholder={user ? 'نظر خود را بنویسید… (پس از تأیید تیم نمایش داده می‌شود)' : 'برای نوشتن نظر وارد شوید'} value={text} onChange={(e) => setText(e.target.value)} onFocus={() => !user && needLogin()} />
                <div className="mt-2 flex justify-end">
                  <Button onClick={send} loading={act.busy} disabled={text.trim().length < 2}>
                    ارسال نظر
                  </Button>
                </div>
              </div>
              )}
            </section>
          </article>
        )
      }}
    </Async>
  )
}

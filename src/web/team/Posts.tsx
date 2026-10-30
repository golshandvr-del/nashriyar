import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Eye, EyeOff, ImagePlus, Layers, MessageCircle, Plus, Star, Trash2, X } from 'lucide-react'
import { api, mediaUrl, upload } from '../lib/api'
import { asFile, prepareImage } from '../lib/image'
import type { Aspect } from '../lib/image'
import { cx, faDate, formatNumber, relativeFa } from '../lib/format'
import { Async, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Tabs, Textarea, useAction, useAsync, useToast } from '../components/ui'
import { useTeam } from './Layout'

const POST_STATUS: Record<string, { label: string; tone: 'muted' | 'ok' | 'warn' | 'danger' }> = {
  draft: { label: 'پیش‌نویس', tone: 'muted' },
  published: { label: 'منتشرشده', tone: 'ok' },
  hidden_by_team: { label: 'پنهان', tone: 'warn' },
  hidden_by_admin: { label: 'پنهان‌شده توسط مسئول', tone: 'danger' }
}

export default function TeamPosts() {
  const { pubId } = useTeam()
  const st = useAsync(() => api.get(`/api/team/${pubId}/posts`), [pubId])
  const [tab, setTab] = useState<'posts' | 'stories' | 'highlights'>('posts')
  const [creating, setCreating] = useState<null | 'post' | 'story'>(null)
  const [open, setOpen] = useState<any | null>(null)

  return (
    <div>
      <PageHeader
        title="اکسپلور"
        subtitle="هر پست و استوری باید به بخشی از یک شمارهٔ منتشرشده ارجاع دهد."
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setCreating('story')}>
              استوری ۲۴ ساعته
            </Button>
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating('post')}>
              پست جدید
            </Button>
          </div>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'posts', label: 'پست‌ها' },
          { key: 'stories', label: 'استوری‌ها' },
          { key: 'highlights', label: 'هایلایت‌ها' }
        ]}
      />
      <div className="mt-4">
        <Async state={st}>
          {(d: any) => {
            if (tab === 'highlights') return <Highlights pubId={pubId} data={d} onChange={st.reload} />
            const rows = d.posts.filter((p: any) => (tab === 'stories' ? !!p.is_story : !p.is_story))
            if (!rows.length)
              return (
                <Empty
                  title={tab === 'stories' ? 'استوری‌ای ثبت نشده' : 'هنوز پستی ندارید'}
                  hint="از صفحه‌ها یا تصاویر یک شمارهٔ منتشرشده پست بسازید تا خوانندگان به سمت شماره هدایت شوند."
                  action={<Button onClick={() => setCreating(tab === 'stories' ? 'story' : 'post')}>ساختن</Button>}
                />
              )
            return (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {rows.map((p: any) => {
                  const s = POST_STATUS[p.status] || { label: p.status, tone: 'muted' as const }
                  const expired = p.is_story && p.expires_at && new Date(p.expires_at) < new Date()
                  const scheduled = p.status === 'published' && p.published_at && new Date(p.published_at) > new Date()
                  return (
                    <button key={p.id} onClick={() => setOpen(p)} className="card group overflow-hidden text-right hover:border-brand">
                      <div className="relative aspect-square bg-surface-2">
                        {p.images[0] && <img src={mediaUrl(p.images[0])} alt="" loading="lazy" className="size-full object-cover" />}
                        {p.images.length > 1 && <Layers className="absolute top-2 left-2 size-5 text-white drop-shadow" />}
                        {p.pending_comments > 0 && (
                          <span className="absolute right-2 bottom-2 flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-[11px] text-white">
                            <MessageCircle className="size-3" /> {formatNumber(p.pending_comments)}
                          </span>
                        )}
                      </div>
                      <div className="space-y-1 p-2">
                        <div className="flex items-center justify-between gap-1">
                          <Badge tone={expired ? 'muted' : scheduled ? 'warn' : s.tone}>{expired ? 'منقضی' : scheduled ? 'زمان‌بندی‌شده' : s.label}</Badge>
                          <span className="text-[11px] text-muted">{scheduled ? faDate(p.published_at, true) : relativeFa(p.published_at || p.created_at)}</span>
                        </div>
                        <p className="truncate text-xs text-muted">
                          ش {formatNumber(p.source_issue_number)} · {p.source_toc_title || '—'}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          }}
        </Async>
      </div>
      {creating && (
        <PostComposer
          pubId={pubId}
          story={creating === 'story'}
          onClose={() => setCreating(null)}
          onDone={() => {
            setCreating(null)
            st.reload()
          }}
        />
      )}
      {open && (
        <PostEditor
          pubId={pubId}
          post={open}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null)
            st.reload()
          }}
        />
      )}
    </div>
  )
}

// ───────── Composer ─────────
function PostComposer({ pubId, story, onClose, onDone }: { pubId: string; story: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast()
  const issues = useAsync(() => api.get(`/api/team/${pubId}/issues`), [pubId])
  const published = (issues.data?.issues || []).filter((i: any) => i.status === 'published')
  const [issueId, setIssueId] = useState('')
  const [toc, setToc] = useState<any[]>([])
  const [tocId, setTocId] = useState('')
  const [aspect, setAspect] = useState<Aspect>(story ? 'original' : '1:1')
  const [keys, setKeys] = useState<string[]>([])
  const [alts, setAlts] = useState<Record<string, string>>({}) // image alt text by media key (ROADMAP phase 6 accessibility)
  const [caption, setCaption] = useState('')
  const [publishAt, setPublishAt] = useState('') // local datetime; empty = publish now (ROADMAP phase 6 scheduling)
  const [uploading, setUploading] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { busy, run } = useAction()

  useEffect(() => {
    setTocId('')
    setToc([])
    if (!issueId) return
    api.get(`/api/team/${pubId}/issues/${issueId}`).then((d) => setToc(d.toc || []), () => setToc([]))
  }, [issueId, pubId])

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const list = Array.from(files).slice(0, 10 - keys.length)
    for (let k = 0; k < list.length; k++) {
      setUploading(`تصویر ${formatNumber(k + 1)} از ${formatNumber(list.length)}`)
      try {
        const blob = await prepareImage(list[k], { aspect })
        const r = await upload(`/api/media/upload`, { file: asFile(blob, 'post'), pub: pubId, role: 'post' })
        setKeys((s) => [...s, r.key])
      } catch (e: any) {
        toast(e?.message || 'بارگذاری ناموفق بود', 'error')
      }
    }
    setUploading(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const submit = (draft: boolean) =>
    run(async () => {
      await api.post(`/api/team/${pubId}/posts`, { images: keys, caption, source_issue_id: issueId, source_toc_item_id: tocId, is_story: story, draft, alt: keys.map((k) => alts[k] || ''),
        ...(!story && publishAt ? { publish_at: new Date(publishAt).toISOString() } : {}) })
      onDone()
    }, draft ? 'پیش‌نویس ذخیره شد' : story ? 'استوری منتشر شد' : publishAt && new Date(publishAt) > new Date() ? 'پست زمان‌بندی شد' : 'پست منتشر شد')

  const ready = keys.length > 0 && !!issueId && !!tocId && !uploading
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={story ? 'استوری جدید (۲۴ ساعت)' : 'پست جدید'}
      footer={
        <>
          {!story && (
            <Button variant="ghost" loading={busy} disabled={!ready} onClick={() => submit(true)}>
              ذخیرهٔ پیش‌نویس
            </Button>
          )}
          <Button loading={busy} disabled={!ready} onClick={() => submit(false)}>
            انتشار
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">برش:</span>
            {(['1:1', '4:5', 'original'] as Aspect[]).map((a) => (
              <button key={a} onClick={() => setAspect(a)} disabled={keys.length > 0} className={cx('chip', aspect === a && 'border-brand bg-brand-soft font-bold text-brand')}>
                {a === 'original' ? 'اصلی' : a.replace(':', '∶')}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {keys.map((k, idx) => (
              <div key={k} className="relative aspect-square overflow-hidden rounded-xl border border-line">
                <img src={mediaUrl(k)} alt="" className="size-full object-cover" />
                <button className="absolute top-1 left-1 rounded-full bg-black/60 p-1 text-white" onClick={() => setKeys((s) => s.filter((x) => x !== k))} aria-label="حذف">
                  <X className="size-3" />
                </button>
                {idx === 0 && <span className="absolute right-1 bottom-1 rounded bg-black/60 px-1 text-[10px] text-white">کاور</span>}
              </div>
            ))}
            {keys.length < (story ? 1 : 10) && (
              <button onClick={() => fileRef.current?.click()} disabled={!!uploading} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line text-xs text-muted hover:border-brand hover:text-brand">
                <ImagePlus className="size-6" />
                {uploading || 'افزودن تصویر'}
              </button>
            )}
          </div>
          {keys.length > 0 && (
            <details className="rounded-xl border border-line p-2 text-sm">
              <summary className="cursor-pointer text-xs text-muted">متن جایگزین تصاویر (برای کم‌بینایان و صفحه‌خوان‌ها)</summary>
              <div className="mt-2 space-y-2">
                {keys.map((k, idx) => (
                  <Input
                    key={k}
                    value={alts[k] || ''}
                    maxLength={300}
                    placeholder={`توصیف تصویر ${formatNumber(idx + 1)}`}
                    onChange={(e) => setAlts((a) => ({ ...a, [k]: e.target.value }))}
                  />
                ))}
              </div>
            </details>
          )}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple={!story} hidden onChange={(e) => addFiles(e.target.files)} />
          <p className="text-[11px] leading-5 text-muted">تصاویر در مرورگر فشرده می‌شوند و اطلاعات مکان/دوربین (EXIF) حذف می‌شود. حداکثر ۱۰ تصویر (کاروسل).</p>
        </div>
        <div className="space-y-3">
          <Field label="منبع: شمارهٔ منتشرشده *">
            <Select
              value={issueId}
              onChange={(e) => setIssueId(e.target.value)}
              placeholder={issues.loading ? 'در حال بارگذاری…' : published.length ? 'انتخاب شماره' : 'شمارهٔ منتشرشده‌ای ندارید'}
              options={published.map((i: any) => ({ value: i.id, label: `شمارهٔ ${formatNumber(i.number)} — ${i.title}` }))}
            />
          </Field>
          <Field label="منبع: بخش فهرست مطالب *" hint="پست زیر کارت «از بخش … شمارهٔ …» نمایش داده می‌شود.">
            <Select value={tocId} onChange={(e) => setTocId(e.target.value)} disabled={!toc.length} placeholder="انتخاب بخش" options={toc.map((t: any) => ({ value: t.id, label: t.title }))} />
          </Field>
          <Field label="متن (کپشن)">
            <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={2200} rows={6} placeholder="چند جمله دربارهٔ این بخش…" />
          </Field>
          <div className="text-left text-[11px] text-muted">{formatNumber(caption.length)}/۲۲۰۰</div>
          {!story && (
            <Field label="زمان انتشار (اختیاری)" hint="خالی = انتشار فوری. پست تا این زمان برای مخاطبان نمایش داده نمی‌شود (حداکثر ۹۰ روز بعد).">
              <Input dir="ltr" type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
            </Field>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ───────── Edit / visibility ─────────
function PostEditor({ pubId, post, onClose, onDone }: { pubId: string; post: any; onClose: () => void; onDone: () => void }) {
  const [caption, setCaption] = useState(post.caption || '')
  const { busy, run } = useAction()
  const locked = post.status === 'hidden_by_admin'
  const save = (status?: string) =>
    run(async () => {
      await api.put(`/api/team/${pubId}/posts/${post.id}`, { caption, ...(status ? { status } : {}) })
      onDone()
    }, 'ذخیره شد')
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={post.is_story ? 'استوری' : 'پست'}
      footer={
        locked ? null : (
          <>
            {post.status === 'published' ? (
              <Button variant="ghost" icon={<EyeOff className="size-4" />} loading={busy} onClick={() => save('hidden_by_team')}>
                پنهان کردن
              </Button>
            ) : (
              <Button variant="ghost" icon={<Eye className="size-4" />} loading={busy} onClick={() => save('published')}>
                انتشار
              </Button>
            )}
            <Button loading={busy} onClick={() => save()}>
              ذخیرهٔ متن
            </Button>
          </>
        )
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="no-scrollbar flex snap-x gap-2 overflow-x-auto">
          {post.images.map((k: string) => (
            <img key={k} src={mediaUrl(k)} alt="" className="w-full shrink-0 snap-center rounded-xl border border-line object-cover" />
          ))}
        </div>
        <div className="space-y-3 text-sm">
          {locked && <div className="card border-danger p-3 text-danger">این پست توسط مسئول نشریات پنهان شده و قابل تغییر نیست.</div>}
          <div className="rounded-xl bg-surface-2 p-3">
            منبع: بخش «{post.source_toc_title || '—'}»، شمارهٔ {formatNumber(post.source_issue_number)} ({post.source_issue_title})
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted">
            <Badge tone={POST_STATUS[post.status]?.tone || 'muted'}>{POST_STATUS[post.status]?.label || post.status}</Badge>
            <span>ساخته‌شده {faDate(post.created_at, true)}</span>
            {post.is_story && post.expires_at && <span>انقضا {faDate(post.expires_at, true)}</span>}
          </div>
          <Field label="متن">
            <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={6} maxLength={2200} disabled={locked} />
          </Field>
          {post.status === 'published' && (
            <Link to={`/post/${post.id}`} className="text-brand">
              مشاهدهٔ عمومی ←
            </Link>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ───────── Highlights ─────────
function Highlights({ pubId, data, onChange }: { pubId: string; data: any; onChange: () => void }) {
  const { confirm } = useToast()
  const { busy, run } = useAction()
  const [title, setTitle] = useState('')
  const [editing, setEditing] = useState<any | null>(null)
  const add = () =>
    run(async () => {
      await api.post(`/api/team/${pubId}/highlights`, { title })
      setTitle('')
      onChange()
    }, 'هایلایت ساخته شد')
  const remove = async (h: any) => {
    if (!(await confirm(`هایلایت «${h.title}» حذف شود؟ پست‌ها باقی می‌مانند.`, { danger: true, okLabel: 'حذف' }))) return
    run(async () => {
      await api.del(`/api/team/${pubId}/highlights/${h.id}`)
      onChange()
    }, 'حذف شد')
  }
  return (
    <div className="space-y-4">
      <Card title="هایلایت جدید">
        <div className="flex gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} placeholder="مثلاً «گفت‌وگوها»" />
          <Button loading={busy} disabled={!title.trim()} onClick={add}>
            ساختن
          </Button>
        </div>
      </Card>
      {!data.highlights.length ? (
        <Empty title="هایلایتی ندارید" hint="هایلایت‌ها مجموعه‌های ماندگار پست‌ها در بالای صفحهٔ نشریه هستند." icon={<Star className="size-8" />} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.highlights.map((h: any) => {
            const first = data.highlight_items.find((x: any) => x.highlight_id === h.id)
            const cover = first && data.posts.find((p: any) => p.id === first.post_id)?.images[0]
            return (
              <div key={h.id} className="card flex items-center gap-3 p-3">
                <div className="size-14 shrink-0 overflow-hidden rounded-full border-2 border-brand bg-surface-2">{cover && <img src={mediaUrl(cover)} alt="" className="size-full object-cover" />}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold">{h.title}</div>
                  <div className="text-xs text-muted">{formatNumber(h.item_count)} پست</div>
                </div>
                <Button variant="ghost" onClick={() => setEditing(h)}>
                  ویرایش
                </Button>
                <button className="rounded-lg p-2 text-danger hover:bg-surface-2" onClick={() => remove(h)} aria-label="حذف">
                  <Trash2 className="size-4" />
                </button>
              </div>
            )
          })}
        </div>
      )}
      {editing && (
        <HighlightEditor
          pubId={pubId}
          h={editing}
          posts={data.posts.filter((p: any) => p.status === 'published' || p.is_story)}
          initial={data.highlight_items.filter((x: any) => x.highlight_id === editing.id).map((x: any) => x.post_id)}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null)
            onChange()
          }}
        />
      )}
    </div>
  )
}

function HighlightEditor({ pubId, h, posts, initial, onClose, onDone }: { pubId: string; h: any; posts: any[]; initial: string[]; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(h.title)
  const [sel, setSel] = useState<string[]>(initial)
  const { busy, run } = useAction()
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="ویرایش هایلایت"
      footer={
        <Button
          loading={busy}
          onClick={() =>
            run(async () => {
              await api.put(`/api/team/${pubId}/highlights/${h.id}`, { title, post_ids: sel })
              onDone()
            }, 'ذخیره شد')
          }
        >
          ذخیره ({formatNumber(sel.length)} پست)
        </Button>
      }
    >
      <Field label="عنوان">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} />
      </Field>
      <p className="my-3 text-xs text-muted">پست‌ها و استوری‌ها را به ترتیب دلخواه انتخاب کنید (استوری‌های منقضی هم در هایلایت ماندگار می‌شوند).</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {posts.map((p) => {
          const n = sel.indexOf(p.id)
          return (
            <button key={p.id} onClick={() => toggle(p.id)} className={cx('relative aspect-square overflow-hidden rounded-xl border-2', n >= 0 ? 'border-brand' : 'border-transparent')}>
              {p.images[0] && <img src={mediaUrl(p.images[0])} alt="" className="size-full object-cover" />}
              {n >= 0 && <span className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">{formatNumber(n + 1)}</span>}
            </button>
          )
        })}
      </div>
    </Modal>
  )
}

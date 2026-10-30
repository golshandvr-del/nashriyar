import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowRight, Bookmark, ChevronLeft, ChevronRight, KeyRound, List, Maximize, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFeature } from '../lib/features'
import { toFaDigits, cx } from '../lib/format'
import { Button, ErrorBox, Modal, PageLoader, Spinner, useToast } from '../components/ui'

interface Manifest {
  issue: { id: string; title: string; number: number; page_count: number; pricing: string; publication_title: string; publication_slug: string }
  full: boolean
  allowed: number
  pages: { n: number; url: string }[]
  expires_at: number
  toc: { id: string; title: string; page_start: number | null; parent_id: string | null }[]
  progress: { last_page: number; percent: number } | null
  bookmarks: { id: string; page: number; note: string | null }[]
  watermark: string
}

/** Draws a page image + diagonal watermark onto a canvas (no <img> to right-click-save). */
function PageCanvas({ url, watermark, zoom, onError }: { url: string; watermark: string; zoom: number; onError: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    setLoading(true)
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      if (!alive || !ref.current) return
      const cv = ref.current
      cv.width = img.naturalWidth
      cv.height = img.naturalHeight
      const ctx = cv.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      if (watermark) {
        ctx.save()
        ctx.globalAlpha = 0.13
        ctx.fillStyle = '#000'
        const fs = Math.max(16, Math.round(cv.width / 26))
        ctx.font = `bold ${fs}px VazirFD, Tahoma, sans-serif`
        ctx.translate(cv.width / 2, cv.height / 2)
        ctx.rotate(-Math.PI / 6)
        ctx.textAlign = 'center'
        for (let y = -cv.height; y < cv.height; y += fs * 5) ctx.fillText(watermark, 0, y)
        ctx.restore()
      }
      setLoading(false)
    }
    img.onerror = () => alive && onError()
    img.src = url
    return () => {
      alive = false
    }
  }, [url, watermark, onError])
  return (
    <div className="relative mx-auto" style={{ width: `${zoom}%`, maxWidth: zoom > 100 ? 'none' : 900 }}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spinner />
        </div>
      )}
      <canvas ref={ref} className="reader-page h-auto w-full rounded-lg bg-white shadow-lg" onContextMenu={(e) => e.preventDefault()} aria-label="تصویر صفحه" />
    </div>
  )
}

export default function Reader() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const { user } = useAuth()
  const { toast } = useToast()
  const [m, setM] = useState<Manifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [zoom, setZoom] = useState(100)
  const [tocOpen, setTocOpen] = useState(false)
  const [hidden, setHidden] = useState(false)
  const touch = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await api.get<Manifest>(`/api/reader/${id}/manifest`)
      setM(r)
      setError(null)
      return r
    } catch (e: any) {
      setError(e.message)
      return null
    }
  }, [id])

  // initial load + start page (query ?page= or saved progress)
  useEffect(() => {
    load().then((r) => {
      if (!r) return
      const want = Number(sp.get('page')) || r.progress?.last_page || 1
      setPage(Math.min(Math.max(1, want), Math.max(1, r.allowed || 1)))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  // refresh signed URLs ~30s before they expire
  useEffect(() => {
    if (!m) return
    const ms = Math.max(10_000, (m.expires_at - 30) * 1000 - Date.now())
    const t = setTimeout(load, ms)
    return () => clearTimeout(t)
  }, [m, load])

  // persist progress (debounced)
  useEffect(() => {
    if (!user || !m || !page) return
    const t = setTimeout(() => api.post(`/api/reader/${id}/progress`, { page }).catch(() => {}), 1200)
    return () => clearTimeout(t)
  }, [page, user, m, id])

  // keyboard navigation + deterrents (PrintScreen / print / blur)
  useEffect(() => {
    const signal = (kind: string) => api.post(`/api/reader/${id}/signal`, { kind }).catch(() => {})
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setPage((p) => p + 1)
      else if (e.key === 'ArrowRight') setPage((p) => p - 1)
      else if (e.key === 'PrintScreen') {
        setHidden(true)
        signal('printscreen')
        setTimeout(() => setHidden(false), 1500)
      } else if ((e.ctrlKey || e.metaKey) && ['p', 's'].includes(e.key.toLowerCase())) {
        e.preventDefault()
        signal('print')
      }
    }
    const onBlur = () => setHidden(true)
    const onFocus = () => setHidden(false)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [id])

  if (error && !m) return <div className="p-4"><ErrorBox error={error} onRetry={load} /></div>
  if (!m) return <PageLoader />

  const total = m.issue.page_count
  const cur = Math.min(Math.max(1, page), Math.max(1, m.allowed))
  const p = m.pages.find((x) => x.n === cur)
  const locked = !m.full && cur >= m.allowed
  const go = (n: number) => setPage(Math.min(Math.max(1, n), Math.max(1, m.allowed)))
  const bm = m.bookmarks.find((b) => b.page === cur)

  const toggleBookmark = async () => {
    if (!user) return toast('برای نشانک‌گذاری وارد شوید', 'info')
    try {
      if (bm) await api.del(`/api/reader/bookmarks/${bm.id}`)
      else await api.post(`/api/reader/${id}/bookmarks`, { page: cur })
      load()
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-200 dark:bg-neutral-900">
      <header className="no-print sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-surface/95 px-3 py-2 backdrop-blur">
        <button className="rounded-lg p-2 hover:bg-surface-2" onClick={() => nav(`/issue/${m.issue.id}`)} aria-label="بازگشت">
          <ArrowRight className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{m.issue.title}</div>
          <div className="truncate text-xs text-muted">
            {m.issue.publication_title} · شمارهٔ {toFaDigits(m.issue.number)}
          </div>
        </div>
        <button className="rounded-lg p-2 hover:bg-surface-2" onClick={() => setZoom((z) => Math.max(50, z - 15))} aria-label="کوچک‌نمایی">
          <ZoomOut className="size-5" />
        </button>
        <button className="rounded-lg p-2 hover:bg-surface-2" onClick={() => setZoom((z) => Math.min(250, z + 15))} aria-label="بزرگ‌نمایی">
          <ZoomIn className="size-5" />
        </button>
        <button className="hidden rounded-lg p-2 hover:bg-surface-2 sm:block" onClick={() => document.documentElement.requestFullscreen?.()} aria-label="تمام‌صفحه">
          <Maximize className="size-5" />
        </button>
        <button className="rounded-lg p-2 hover:bg-surface-2" onClick={toggleBookmark} aria-label="نشانک" aria-pressed={!!bm}>
          <Bookmark className={cx('size-5', bm && 'fill-current text-brand')} />
        </button>
        <button className="rounded-lg p-2 hover:bg-surface-2" onClick={() => setTocOpen(true)} aria-label="فهرست">
          <List className="size-5" />
        </button>
      </header>

      <main
        className={cx('flex-1 overflow-auto px-2 py-4 transition', hidden && 'blur-2xl')}
        onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touch.current == null || zoom > 100) return
          const dx = e.changedTouches[0].clientX - touch.current
          if (Math.abs(dx) > 60) go(dx > 0 ? cur + 1 : cur - 1) // RTL: swipe right = next
          touch.current = null
        }}
      >
        {m.allowed === 0 ? (
          <Locked m={m} />
        ) : p ? (
          <PageCanvas key={p.url} url={p.url} watermark={m.watermark} zoom={zoom} onError={load} />
        ) : (
          <Locked m={m} />
        )}
        {locked && m.allowed > 0 && cur === m.allowed && (
          <div className="mx-auto mt-4 max-w-md">
            <Locked m={m} compact />
          </div>
        )}
      </main>

      <footer className="no-print sticky bottom-0 z-30 flex items-center gap-3 border-t border-line bg-surface/95 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <button className="btn-ghost px-3" disabled={cur <= 1} onClick={() => go(cur - 1)} aria-label="صفحهٔ قبل">
          <ChevronRight className="size-5" />
        </button>
        <input type="range" min={1} max={Math.max(1, m.allowed)} value={cur} onChange={(e) => go(Number(e.target.value))} className="flex-1 accent-[var(--brand)]" aria-label="انتخاب صفحه" dir="rtl" />
        <span className="w-20 shrink-0 text-center text-xs text-muted">
          {toFaDigits(cur)} / {toFaDigits(total)}
        </span>
        <button className="btn-ghost px-3" disabled={cur >= m.allowed} onClick={() => go(cur + 1)} aria-label="صفحهٔ بعد">
          <ChevronLeft className="size-5" />
        </button>
      </footer>

      <Modal open={tocOpen} onClose={() => setTocOpen(false)} title="فهرست و نشانک‌ها">
        {m.toc.length === 0 && <p className="text-sm text-muted">فهرستی ثبت نشده است.</p>}
        <ul className="divide-y divide-line">
          {m.toc.map((t) => (
            <li key={t.id}>
              <button
                disabled={!t.page_start || t.page_start > m.allowed}
                className={cx('flex w-full items-center gap-2 py-2 text-start text-sm disabled:opacity-50', t.parent_id && 'ps-4')}
                onClick={() => {
                  go(t.page_start!)
                  setTocOpen(false)
                }}
              >
                <span className="flex-1">{t.title}</span>
                {t.page_start && <span className="text-xs text-muted">{toFaDigits(t.page_start)}</span>}
              </button>
            </li>
          ))}
        </ul>
        {m.bookmarks.length > 0 && (
          <>
            <h3 className="mb-2 mt-4 text-sm font-bold">نشانک‌ها</h3>
            <ul className="space-y-1">
              {m.bookmarks.map((b) => (
                <li key={b.id} className="flex items-center gap-2 text-sm">
                  <button
                    className="flex-1 text-start hover:text-brand"
                    onClick={() => {
                      go(b.page)
                      setTocOpen(false)
                    }}
                  >
                    صفحهٔ {toFaDigits(b.page)} {b.note && `— ${b.note}`}
                  </button>
                  <button
                    className="p-1 text-muted hover:text-danger"
                    aria-label="حذف نشانک"
                    onClick={() =>
                      api
                        .del(`/api/reader/bookmarks/${b.id}`)
                        .then(load)
                        .catch(() => {})
                    }
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Modal>
    </div>
  )
}

function Locked({ m, compact }: { m: Manifest; compact?: boolean }) {
  const paidOn = useFeature('paid_content')
  return (
    <div className={cx('card mx-auto max-w-md text-center', compact ? 'p-4' : 'mt-10 p-8')}>
      <KeyRound className="mx-auto size-10 text-brand" />
      <p className="mt-3 font-bold">{m.allowed ? 'پایان پیش‌نمایش رایگان' : 'این شماره پولی است'}</p>
      <p className="mt-1 text-sm text-muted">برای خواندن کامل، کد خرید دریافتی از تیم نشریه را ثبت کنید.</p>
      <div className="mt-4 flex justify-center gap-2">
        {paidOn && (
          <Link to={`/redeem?issue=${m.issue.id}`}>
            <Button>ثبت کد خرید</Button>
          </Link>
        )}
        <Link to={`/issue/${m.issue.id}`}>
          <Button variant="ghost">جزئیات شماره</Button>
        </Link>
      </div>
    </div>
  )
}

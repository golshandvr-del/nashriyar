// Reflowable text mode for the reader (ROADMAP phase 19): the text layer of the pages the visitor may read,
// re-flowed for small screens with an adjustable font size; EPUB download for free issues.
import { useEffect, useRef, useState } from 'react'
import { BookDown, Headphones, Minus, Plus, Square } from 'lucide-react'
import { api } from '../lib/api'
import { toFaDigits, cx } from '../lib/format'
import { ErrorBox, Spinner } from '../components/ui'

interface TextData {
  issue: { id: string; title: string; number: number; page_count: number; pricing: string; publication_title: string }
  full: boolean
  allowed: number
  pages: { n: number; text: string }[]
  toc: { title: string; page_start: number }[]
  has_text: boolean
  epub: boolean
  tts_server?: boolean
}

/** pdftotext breaks lines at the column edge — blank lines separate paragraphs, other line breaks are joined. */
function paras(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

export default function ReaderText({ issueId, startPage, night, onPage }: { issueId: string; startPage: number; night: boolean; onPage: (n: number) => void }) {
  const [d, setD] = useState<TextData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [size, setSize] = useState(() => Number(localStorage.getItem('nsh-reader-text-size')) || 18)
  useEffect(() => {
    api.get<TextData>(`/api/reader/${issueId}/text`).then(setD).catch((e) => setError(e.message))
  }, [issueId])
  useEffect(() => {
    if (!d) return
    document.getElementById(`tp-${startPage}`)?.scrollIntoView({ block: 'start' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d])
  // report the page currently at the top of the viewport (keeps progress / page slider in sync)
  useEffect(() => {
    if (!d) return
    const io = new IntersectionObserver(
      (es) => {
        const top = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top) onPage(Number((top.target as HTMLElement).dataset.page))
      },
      { rootMargin: '0px 0px -70% 0px' }
    )
    document.querySelectorAll('[data-page]').forEach((el) => io.observe(el))
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d])
  // ---- audio edition (ROADMAP phase 19 TTS add-on): server MP3 when the AI add-on is configured, else browser Web Speech ----
  const [playing, setPlaying] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const runRef = useRef(0)
  const webSpeech = typeof window !== 'undefined' && 'speechSynthesis' in window
  const stop = () => {
    runRef.current++
    audioRef.current?.pause()
    audioRef.current = null
    if (webSpeech) window.speechSynthesis.cancel()
    setPlaying(null)
  }
  useEffect(() => stop, []) // eslint-disable-line react-hooks/exhaustive-deps
  const speakBrowser = (n: number, run: number, next: () => void) => {
    const text = d?.pages.find((p) => p.n === n)?.text || ''
    const chunks = paras(text).flatMap((p) => p.match(/[^.!؟?]{1,220}[.!؟?]?/g) || [p])
    if (!webSpeech || !chunks.length) return next()
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('fa'))
    chunks.forEach((t, i) => {
      const u = new SpeechSynthesisUtterance(t)
      u.lang = 'fa-IR'
      if (voice) u.voice = voice
      if (i === chunks.length - 1) u.onend = () => runRef.current === run && next()
      window.speechSynthesis.speak(u)
    })
  }
  const play = (n: number, run = ++runRef.current) => {
    if (!d) return
    const page = d.pages.find((p) => p.n >= n && p.text.trim())
    if (!page) return stop()
    setPlaying(page.n)
    document.getElementById(`tp-${page.n}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    const next = () => runRef.current === run && play(page.n + 1, run)
    if (d.tts_server) {
      const a = new Audio(`/api/reader/${d.issue.id}/speech/${page.n}`)
      audioRef.current = a
      a.onended = next
      a.onerror = () => runRef.current === run && speakBrowser(page.n, run, next)
      a.play().catch(() => runRef.current === run && speakBrowser(page.n, run, next))
    } else speakBrowser(page.n, run, next)
  }
  const setFont = (v: number) => {
    const s = Math.min(30, Math.max(14, v))
    setSize(s)
    localStorage.setItem('nsh-reader-text-size', String(s))
  }
  if (error) return <ErrorBox error={error} />
  if (!d)
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    )
  return (
    <article id="reader-text" className={cx('mx-auto max-w-2xl rounded-xl px-5 py-6 shadow', night ? 'bg-[#1b1b1b] text-neutral-200' : 'bg-white text-neutral-900')} style={{ fontSize: size, lineHeight: 1.95 }}>
      <div className="no-print mb-4 flex flex-wrap items-center gap-2 border-b border-line pb-3 text-sm" style={{ fontSize: 14 }}>
        <span className="text-muted">اندازهٔ متن</span>
        <button className="rounded-lg border border-line p-1.5" onClick={() => setFont(size - 2)} aria-label="کوچک‌تر کردن متن">
          <Minus className="size-4" />
        </button>
        <span className="w-8 text-center">{toFaDigits(size)}</span>
        <button className="rounded-lg border border-line p-1.5" onClick={() => setFont(size + 2)} aria-label="بزرگ‌تر کردن متن">
          <Plus className="size-4" />
        </button>
        <span className="flex-1" />
        {d.has_text && (d.tts_server || webSpeech) && (
          <button
            className={cx('btn-ghost inline-flex items-center gap-1 rounded-lg px-3 py-1.5', playing && 'text-brand')}
            onClick={() => (playing ? stop() : play(startPage))}
            aria-pressed={!!playing}
            title={d.tts_server ? 'نسخهٔ صوتی (هوش مصنوعی)' : 'خواندن با صدای مرورگر'}
          >
            {playing ? <Square className="size-4" /> : <Headphones className="size-4" />}
            {playing ? `توقف (صفحهٔ ${toFaDigits(playing)})` : 'شنیدن'}
          </button>
        )}
        {d.epub && (
          <a className="btn-ghost inline-flex items-center gap-1 rounded-lg px-3 py-1.5" href={`/api/reader/${d.issue.id}/epub`} download>
            <BookDown className="size-4" /> دریافت EPUB
          </a>
        )}
      </div>
      {!d.has_text && <p className="text-center text-muted">این شماره لایهٔ متنی ندارد؛ از حالت تصویری استفاده کنید.</p>}
      {d.pages.map((p) => {
        const items = paras(p.text)
        const heads = d.toc.filter((t) => t.page_start === p.n)
        return (
          <section key={p.n} id={`tp-${p.n}`} data-page={p.n} className="scroll-mt-20">
            {heads.map((h) => (
              <h2 key={h.title} className="mb-2 mt-6 font-black" style={{ fontSize: '1.2em' }}>
                {h.title}
              </h2>
            ))}
            {items.map((t, i) => (
              <p key={i} className="mb-3 text-justify">
                {t}
              </p>
            ))}
            <div className="my-4 flex items-center gap-2 text-xs text-muted" style={{ fontSize: 12 }} aria-hidden>
              <span className="h-px flex-1 bg-line" />
              صفحهٔ {toFaDigits(p.n)}
              <span className="h-px flex-1 bg-line" />
            </div>
          </section>
        )
      })}
      {!d.full && d.allowed < d.issue.page_count && <p className="mt-4 text-center text-sm text-muted">ادامهٔ متن پس از تهیهٔ شماره در دسترس است.</p>}
    </article>
  )
}

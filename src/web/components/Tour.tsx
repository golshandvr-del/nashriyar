// In-app onboarding (ROADMAP phase 14): a short step-by-step tour on the first visit to a panel and a
// «راهنمای این صفحه» button that explains the current page in two or three sentences.
// Seen-state is stored per user and per panel in localStorage; the tour never auto-opens under automation
// (navigator.webdriver) so browser tests are not blocked by the dialog.
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ChevronLeft, ChevronRight, HelpCircle, Sparkles } from 'lucide-react'
import { Modal } from './ui'
import { toFaDigits } from '../lib/format'

export interface TourStep { title: string; body: string }
export type PageHelp = { match: string; title: string; body: string }[]

const key = (scope: string, userId: string) => `nsh-tour-${scope}-${userId}`

export function tourSeen(scope: string, userId: string): boolean {
  try {
    return localStorage.getItem(key(scope, userId)) === '1'
  } catch {
    return true
  }
}

function markSeen(scope: string, userId: string) {
  try {
    localStorage.setItem(key(scope, userId), '1')
  } catch {
    /* private mode: just don't remember */
  }
}

/** First-visit tour. Re-open it any time with the `open-tour` window event (fired by the help dialog). */
export function Tour({ scope, userId, steps }: { scope: string; userId: string; steps: TourStep[] }) {
  const [open, setOpen] = useState(false)
  const [i, setI] = useState(0)
  useEffect(() => {
    const auto = typeof navigator !== 'undefined' && !(navigator as any).webdriver
    if (auto && !tourSeen(scope, userId)) setOpen(true)
    const reopen = () => (setI(0), setOpen(true))
    window.addEventListener('open-tour', reopen)
    return () => window.removeEventListener('open-tour', reopen)
  }, [scope, userId])
  const close = () => (markSeen(scope, userId), setOpen(false))
  const s = steps[i]
  if (!s) return null
  const last = i === steps.length - 1
  return (
    <Modal
      open={open}
      onClose={close}
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles className="size-5 text-brand" /> {s.title}
        </span>
      }
      footer={
        <>
          <button className="btn-ghost me-auto" onClick={close}>رد کردن</button>
          {i > 0 && (
            <button className="btn-ghost" onClick={() => setI(i - 1)}>
              <ChevronRight className="size-4" /> قبلی
            </button>
          )}
          <button className="btn-primary" onClick={() => (last ? close() : setI(i + 1))}>
            {last ? 'شروع کار' : 'بعدی'} {!last && <ChevronLeft className="size-4" />}
          </button>
        </>
      }
    >
      <p className="leading-7 text-ink">{s.body}</p>
      <div className="mt-4 flex items-center justify-center gap-1.5" aria-label={`مرحلهٔ ${toFaDigits(i + 1)} از ${toFaDigits(steps.length)}`}>
        {steps.map((_, k) => (
          <span key={k} className={k === i ? 'h-2 w-5 rounded-full bg-brand' : 'size-2 rounded-full bg-line'} />
        ))}
      </div>
    </Modal>
  )
}

/** «راهنمای این صفحه»: picks the longest `match` prefix of the current path. */
export function PageHelpButton({ base, help, compact }: { base: string; help: PageHelp; compact?: boolean }) {
  const loc = useLocation()
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [loc.pathname])
  const rel = loc.pathname.replace(base, '').replace(/^\/+|\/+$/g, '')
  const item =
    help
      .filter((h) => (h.match === '' ? rel === '' : rel === h.match || rel.startsWith(h.match + '/')))
      .sort((a, b) => b.match.length - a.match.length)[0] || null
  return (
    <>
      <button
        className={compact ? 'rounded-xl p-2 hover:bg-surface-2' : 'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-ink'}
        onClick={() => setOpen(true)}
        aria-label="راهنمای این صفحه"
      >
        <HelpCircle className="size-5" />
        {!compact && 'راهنمای این صفحه'}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={item?.title || 'راهنما'}
        footer={
          <>
            <button className="btn-ghost" onClick={() => (setOpen(false), window.dispatchEvent(new Event('open-tour')))}>تور معرفی پنل</button>
            <button className="btn-primary" onClick={() => setOpen(false)}>متوجه شدم</button>
          </>
        }
      >
        <p className="leading-7">{item?.body || 'برای جابه‌جایی سریع بین صفحه‌ها از جست‌وجوی سریع (Ctrl+K) استفاده کنید. تور معرفی پنل را هم می‌توانید دوباره ببینید.'}</p>
      </Modal>
    </>
  )
}

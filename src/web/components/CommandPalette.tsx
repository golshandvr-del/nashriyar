// Command palette (ROADMAP phase 9, UX.md): Ctrl+K / Cmd+K in the dashboards opens a quick switcher.
// Static items (menu pages, actions) come from the host layout; an optional async source adds live results
// (e.g. publications). Fully keyboard driven: ↑/↓ to move, Enter to open, Esc to close.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, Search } from 'lucide-react'
import { normalizeFa } from '../../shared/fa'
import { cx } from '../lib/format'

export interface PaletteItem {
  id: string
  label: string
  /** Secondary text (group / description). */
  hint?: string
  icon?: ReactNode
  /** Either a route to navigate to or a custom action. */
  to?: string
  run?: () => void
  /** Extra words that should match (synonyms, English names). */
  keywords?: string
}

type Source = (q: string) => Promise<PaletteItem[]>

const match = (it: PaletteItem, q: string) => !q || normalizeFa(`${it.label} ${it.hint || ''} ${it.keywords || ''}`).toLowerCase().includes(q)

/** Mount once inside a layout. Listens for Ctrl+K / Cmd+K globally. */
export function CommandPalette({ items, source, placeholder = 'جست‌وجو در صفحه‌ها و نشریات…' }: { items: PaletteItem[]; source?: Source; placeholder?: string }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [live, setLive] = useState<PaletteItem[]>([])
  const [active, setActive] = useState(0)
  const nav = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    const onOpen = () => setOpen(true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('nashriyar:palette', onOpen)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('nashriyar:palette', onOpen)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setQ('')
    setLive([])
    setActive(0)
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      clearTimeout(t)
      document.body.style.overflow = prev
    }
  }, [open])

  const nq = normalizeFa(q.trim()).toLowerCase()

  // Debounced live search; stale answers are ignored.
  useEffect(() => {
    if (!open || !source || nq.length < 2) {
      setLive([])
      return
    }
    let stale = false
    const t = setTimeout(() => {
      source(q.trim())
        .then((r) => !stale && setLive(r))
        .catch(() => !stale && setLive([]))
    }, 220)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [q, nq, open, source])

  const results = useMemo(() => [...items.filter((i) => match(i, nq)), ...live].slice(0, 40), [items, live, nq])

  useEffect(() => setActive(0), [nq, live.length])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const choose = (it?: PaletteItem) => {
    if (!it) return
    setOpen(false)
    if (it.run) it.run()
    else if (it.to) nav(it.to)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (results.length ? (a + 1) % results.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(results[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div className="no-print fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="پالت فرمان" className="card w-full max-w-xl overflow-hidden p-0 shadow-2xl" onKeyDown={onKeyDown}>
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search className="size-5 shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={placeholder}
            className="h-14 w-full bg-transparent text-base outline-none"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[active] ? `palette-${results[active].id}` : undefined}
          />
          <kbd className="hidden shrink-0 rounded border border-line px-1.5 text-[11px] text-muted sm:block">Esc</kbd>
        </div>
        <ul id="palette-list" ref={listRef} role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <li className="p-6 text-center text-sm text-muted">نتیجه‌ای پیدا نشد</li>
          ) : (
            results.map((it, idx) => (
              <li
                key={it.id}
                id={`palette-${it.id}`}
                data-idx={idx}
                role="option"
                aria-selected={idx === active}
                onMouseMove={() => idx !== active && setActive(idx)}
                onClick={() => choose(it)}
                className={cx('flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm', idx === active ? 'bg-brand-soft text-brand' : 'hover:bg-surface-2')}
              >
                <span className="shrink-0 text-muted">{it.icon}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{it.label}</span>
                {it.hint && <span className="shrink-0 text-xs text-muted">{it.hint}</span>}
                {idx === active && <CornerDownLeft className="size-4 shrink-0" />}
              </li>
            ))
          )}
        </ul>
        <footer className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-muted">
          <span>↑↓ جابه‌جایی</span>
          <span>Enter باز کردن</span>
          <span className="ms-auto" dir="ltr">Ctrl + K</span>
        </footer>
      </div>
    </div>
  )
}

/** Small header button that opens the palette (for touch / discoverability). */
export function PaletteButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event('nashriyar:palette'))}
      className={cx('flex w-full items-center gap-2 rounded-xl border border-line px-3 py-2 text-xs text-muted hover:bg-surface-2', className)}
      aria-label="جست‌وجوی سریع (Ctrl+K)"
    >
      <Search className="size-4" />
      <span className="flex-1 text-start">جست‌وجوی سریع</span>
      <kbd dir="ltr" className="rounded border border-line px-1 text-[10px]">Ctrl K</kbd>
    </button>
  )
}

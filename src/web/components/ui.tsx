import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, DependencyList, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Info, Inbox, Loader2, X } from 'lucide-react'
import { cx } from '../lib/format'

// ───────── Data loading hook ─────────
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)
  const run = useCallback(async () => {
    const my = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const d = await fn()
      if (my === seq.current) setData(d)
    } catch (e: any) {
      if (my === seq.current) setError(e?.message || 'خطا')
    } finally {
      if (my === seq.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => {
    run()
  }, [run])
  return { data, error, loading, reload: run, setData }
}

// ───────── Primitives ─────────
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; loading?: boolean; icon?: ReactNode }
export function Button({ variant = 'primary', loading, icon, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button className={cx(variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : 'btn-ghost', className)} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

export function Card({ className, children, title, action }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx('card p-4', className)}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-bold">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function Field({ label, hint, error, children }: { label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      {label && <span className="label">{label}</span>}
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  )
}

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx('input', p.className)} />
/** Rough password strength 0..4 (length + character classes); purely advisory, the server enforces the real policy. */
export function passwordScore(pw: string): number {
  if (!pw) return 0
  let s = 0
  if (pw.length >= 8) s++
  if (pw.length >= 12) s++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++
  if (/\d/.test(pw)) s++
  if (/[^A-Za-z0-9]/.test(pw)) s++
  if (pw.length < 8) s = Math.min(s, 1)
  return Math.min(4, s)
}
const STRENGTH = [
  { label: 'خیلی ضعیف', cls: 'bg-red-500' },
  { label: 'ضعیف', cls: 'bg-red-500' },
  { label: 'متوسط', cls: 'bg-amber-500' },
  { label: 'خوب', cls: 'bg-emerald-500' },
  { label: 'قوی', cls: 'bg-emerald-600' }
]

/** Password field with a show/hide (eye) toggle and an optional strength meter for new passwords. */
export function PasswordInput({ strength, className, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { strength?: boolean }) {
  const [show, setShow] = useState(false)
  const val = typeof p.value === 'string' ? p.value : ''
  const score = passwordScore(val)
  return (
    <div>
      <div className="relative">
        <input dir="ltr" {...p} type={show ? 'text' : 'password'} className={cx('input pl-10', className)} />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute inset-y-0 left-0 flex w-10 items-center justify-center rounded-l-xl text-muted hover:text-ink"
          aria-label={show ? 'پنهان کردن رمز' : 'نمایش رمز'}
          aria-pressed={show}
          tabIndex={0}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {strength && val && (
        <div className="mt-1.5 flex items-center gap-2" aria-live="polite">
          <div className="flex h-1.5 flex-1 gap-1">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={cx('flex-1 rounded-full', i < Math.max(1, score) ? STRENGTH[score].cls : 'bg-surface-2')} />
            ))}
          </div>
          <span className="shrink-0 text-[11px] text-muted">قدرت رمز: {STRENGTH[score].label}</span>
        </div>
      )}
    </div>
  )
}
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={4} {...p} className={cx('input', p.className)} />
export function Select({ options, placeholder, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select {...p} className={cx('input', p.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

const TONES = {
  muted: 'bg-surface-2 text-muted',
  brand: 'bg-brand-soft text-brand',
  warn: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  danger: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
}
export function Badge({ tone = 'muted', children, className }: { tone?: keyof typeof TONES; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium', TONES[tone], className)}>{children}</span>
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-5 animate-spin text-muted', className)} />
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} />
}

export function PageLoader() {
  return (
    <div className="space-y-3 p-4" aria-busy="true" aria-label="در حال بارگذاری">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-40" />
      <Skeleton className="h-24" />
    </div>
  )
}

export function Empty({ title = 'چیزی برای نمایش نیست', hint, icon, action }: { title?: string; hint?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted">
      {icon || <Inbox className="size-10 opacity-60" />}
      <p className="font-medium text-ink">{title}</p>
      {hint && <p className="max-w-sm text-sm">{hint}</p>}
      {action}
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="card flex items-center gap-3 border-red-300 p-4 text-sm text-danger">
      <AlertTriangle className="size-5 shrink-0" />
      <span className="flex-1">{error}</span>
      {onRetry && (
        <button className="btn-ghost" onClick={onRetry}>
          تلاش دوباره
        </button>
      )}
    </div>
  )
}

/** Standard loader wrapper for useAsync results. */
export function Async<T>({ state, children }: { state: { data: T | null; error: string | null; loading: boolean; reload: () => void }; children: (d: T) => ReactNode }) {
  if (state.error && !state.data) return <ErrorBox error={state.error} onRetry={state.reload} />
  if (!state.data) return <PageLoader />
  return <>{children(state.data)}</>
}

export function Tabs<K extends string>({ tabs, value, onChange }: { tabs: { key: K; label: ReactNode }[]; value: K; onChange: (k: K) => void }) {
  return (
    <div role="tablist" className="no-scrollbar -mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-line px-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cx('shrink-0 border-b-2 px-3 py-2 text-sm transition-colors', value === t.key ? 'border-brand font-bold text-brand' : 'border-transparent text-muted hover:text-ink')}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {back}
        <h1 className="text-xl font-extrabold">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  )
}

export function Stat({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'danger' | 'muted' }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-extrabold">{value}</div>
      {sub && <div className={cx('mt-1 text-xs', tone === 'ok' ? 'text-ok' : tone === 'danger' ? 'text-danger' : 'text-muted')}>{sub}</div>}
    </div>
  )
}

export function Progress({ value, className }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(100, value || 0))
  return (
    <div className={cx('h-2 overflow-hidden rounded-full bg-surface-2', className)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${v}%` }} />
    </div>
  )
}

// ───────── Modal ─────────
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={cx('card max-h-[92dvh] w-full overflow-y-auto rounded-b-none p-5 sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <header className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="rounded-lg p-1 hover:bg-surface-2" onClick={onClose} aria-label="بستن">
            <X className="size-5" />
          </button>
        </header>
        {children}
        {footer && <footer className="mt-5 flex flex-wrap justify-end gap-2">{footer}</footer>}
      </div>
    </div>
  )
}

// ───────── Toasts + confirm ─────────
type Toast = { id: number; kind: 'ok' | 'error' | 'info'; text: string; action?: { label: string; run: () => void } }
type ConfirmReq = { text: ReactNode; danger?: boolean; okLabel?: string; resolve: (v: boolean) => void }
const ToastCtx = createContext<{ toast: (text: string, kind?: Toast['kind'], action?: Toast['action']) => void; confirm: (text: ReactNode, opts?: { danger?: boolean; okLabel?: string }) => Promise<boolean> } | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const [conf, setConf] = useState<ConfirmReq | null>(null)
  const toast = useCallback((text: string, kind: Toast['kind'] = 'ok', action?: Toast['action']) => {
    const id = Date.now() + Math.random()
    setItems((s) => [...s.slice(-3), { id, kind, text, action }])
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), action ? 7000 : 4000)
  }, [])
  const confirm = useCallback((text: ReactNode, opts: { danger?: boolean; okLabel?: string } = {}) => new Promise<boolean>((resolve) => setConf({ text, ...opts, resolve })), [])
  const close = (v: boolean) => {
    conf?.resolve(v)
    setConf(null)
  }
  return (
    <ToastCtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="card pointer-events-auto flex max-w-md items-center gap-3 px-4 py-3 text-sm shadow-lg">
            {t.kind === 'ok' ? <CheckCircle2 className="size-5 text-ok" /> : t.kind === 'error' ? <AlertTriangle className="size-5 text-danger" /> : <Info className="size-5 text-brand" />}
            <span className="flex-1">{t.text}</span>
            {t.action && (
              <button
                className="font-bold text-brand"
                onClick={() => {
                  t.action!.run()
                  setItems((s) => s.filter((x) => x.id !== t.id))
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
      <Modal
        open={!!conf}
        onClose={() => close(false)}
        title="تأیید"
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              انصراف
            </Button>
            <Button variant={conf?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
              {conf?.okLabel || 'تأیید'}
            </Button>
          </>
        }
      >
        <div className="text-sm leading-7">{conf?.text}</div>
      </Modal>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  const v = useContext(ToastCtx)
  if (!v) throw new Error('useToast outside ToastProvider')
  return v
}

/** Wraps an async action with loading state + error toast. */
export function useAction() {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
      setBusy(true)
      try {
        const r = await fn()
        if (okMsg) toast(okMsg)
        return r
      } catch (e: any) {
        toast(e?.message || 'خطا', 'error')
        return undefined
      } finally {
        setBusy(false)
      }
    },
    [toast]
  )
  return { busy, run }
}

export function Avatar({ src, name, size = 40, color }: { src?: string; name?: string; size?: number; color?: string | null }) {
  const letter = (name || '؟').trim().charAt(0)
  return src ? (
    <img src={src} alt="" width={size} height={size} loading="lazy" className="shrink-0 rounded-full border border-line object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white" style={{ width: size, height: size, background: color || 'var(--brand)', fontSize: size * 0.42 }}>
      {letter}
    </span>
  )
}

// Shared helpers for the developer console /system (ROADMAP phase 13).
// `useSudo().guard(fn)` runs a sensitive call; when the server answers 403 sudo_required it opens the
// re-authentication dialog (password + TOTP), elevates for 10 minutes and retries the call once.
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'
import { ApiError, api } from '../lib/api'
import { Button, Field, Input, Modal, PasswordInput, useToast } from '../components/ui'
import { toFaDigits } from '../../shared/fa'

export interface SystemStatus {
  user: { id: string; username: string; display_name: string; must_change_password: boolean }
  totp_enabled: boolean
  elevated_until: string | null
  session_expires_at: string | null
  ip_restricted: boolean
  ops_available: boolean
}

export function fmtBytes(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n) || n <= 0) return '۰'
  if (n >= 1024 ** 3) return toFaDigits((n / 1024 ** 3).toFixed(1)) + ' گیگابایت'
  if (n >= 1024 ** 2) return toFaDigits((n / 1024 ** 2).toFixed(1)) + ' مگابایت'
  return toFaDigits(Math.max(1, Math.round(n / 1024))) + ' کیلوبایت'
}

/** Remaining minutes until an ISO time (never negative). */
export function minutesLeft(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return 0
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 60_000))
}

type SudoCtx = {
  elevatedUntil: string | null
  setElevatedUntil: (v: string | null) => void
  /** Runs `fn`; on sudo_required asks for password + TOTP, elevates and retries once. Errors are toasted. */
  guard: <T>(fn: () => Promise<T>, okMsg?: string) => Promise<T | undefined>
  elevate: () => Promise<boolean>
  drop: () => Promise<void>
}
const Ctx = createContext<SudoCtx | null>(null)

export function SudoProvider({ initial, children }: { initial: string | null; children: ReactNode }) {
  const { toast } = useToast()
  const [elevatedUntil, setElevatedUntil] = useState<string | null>(initial)
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const pending = useRef<((ok: boolean) => void) | null>(null)

  const elevate = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        pending.current = resolve
        setPw('')
        setCode('')
        setErr(null)
        setOpen(true)
      }),
    []
  )
  const close = (ok: boolean) => {
    setOpen(false)
    pending.current?.(ok)
    pending.current = null
  }
  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await api.post<{ elevated_until: string }>('/api/system/elevate', { password: pw, totp: code })
      setElevatedUntil(r.elevated_until)
      toast('حالت تأییدشده تا ۱۰ دقیقه فعال شد')
      close(true)
    } catch (e: any) {
      setErr(e?.message || 'خطا')
    } finally {
      setBusy(false)
    }
  }
  const guard = useCallback(
    async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await fn()
          if (okMsg) toast(okMsg)
          return r
        } catch (e: any) {
          if (e instanceof ApiError && e.code === 'sudo_required' && attempt === 0) {
            setElevatedUntil(null)
            if (await elevate()) continue
            return undefined
          }
          toast(e?.message || 'خطا', 'error')
          return undefined
        }
      }
      return undefined
    },
    [elevate, toast]
  )
  const drop = useCallback(async () => {
    await api.post('/api/system/elevate/drop', {}).catch(() => {})
    setElevatedUntil(null)
  }, [])

  return (
    <Ctx.Provider value={{ elevatedUntil, setElevatedUntil, guard, elevate, drop }}>
      {children}
      <Modal
        open={open}
        onClose={() => close(false)}
        title={
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-brand" /> تأیید دوبارهٔ هویت
          </span>
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              انصراف
            </Button>
            <Button loading={busy} disabled={!pw || code.length < 6} onClick={submit}>
              تأیید
            </Button>
          </>
        }
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (pw && code.length >= 6) submit()
          }}
        >
          <p className="text-sm leading-6 text-muted">
            این عملیات حساس است. رمز عبور و کد شش‌رقمی برنامهٔ احراز هویت را وارد کنید؛ تأیید شما ۱۰ دقیقه معتبر می‌ماند و در گزارش فنی ثبت می‌شود.
          </p>
          <Field label="رمز عبور">
            <PasswordInput autoFocus autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <Field label="کد دومرحله‌ای" error={err}>
            <Input dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
      </Modal>
    </Ctx.Provider>
  )
}

export function useSudo() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSudo outside SudoProvider')
  return v
}

// Site-wide maintenance banner (ROADMAP phase 13). Polls GET /api/maintenance; while maintenance mode is on,
// writes are refused by the server (503) and this banner explains why. Hidden inside the developer console.
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Wrench } from 'lucide-react'

export function MaintenanceBanner() {
  const loc = useLocation()
  const [m, setM] = useState<{ on: boolean; message: string } | null>(null)
  useEffect(() => {
    let alive = true
    const load = () =>
      fetch('/api/maintenance', { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && setM(d))
        .catch(() => {})
    load()
    const t = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])
  if (!m?.on || loc.pathname.startsWith('/system')) return null
  return (
    <div role="status" className="no-print sticky top-0 z-[70] flex items-center justify-center gap-2 bg-amber-500 px-3 py-2 text-center text-sm font-bold text-black">
      <Wrench className="size-4 shrink-0" />
      <span>{m.message || 'سامانه در حال تعمیرات است؛ فعلاً فقط مشاهده ممکن است و تغییرات ذخیره نمی‌شوند.'}</span>
    </div>
  )
}

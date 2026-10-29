// Theme handling: light | dark | system. Stored in localStorage (anti-flash script in index.html reads it)
// and, for signed-in users, synced to the server (POST /api/auth/theme).

export type Theme = 'light' | 'dark' | 'system'
const KEY = 'nsh_theme'

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

function isDark(t: Theme) {
  return t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
}

export function applyTheme(t: Theme, sync = true) {
  try {
    localStorage.setItem(KEY, t)
  } catch {}
  document.documentElement.classList.toggle('dark', isDark(t))
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', isDark(t) ? '#0b0f14' : '#0f766e')
  if (sync) {
    fetch('/api/auth/theme', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: t })
    }).catch(() => {})
  }
  window.dispatchEvent(new CustomEvent('nsh:theme', { detail: t }))
}

// follow OS changes while in "system" mode
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (getTheme() === 'system') document.documentElement.classList.toggle('dark', isDark('system'))
  })
}

const LARGE = 'nsh_large_text'
export function getLargeText(): boolean {
  try {
    return localStorage.getItem(LARGE) === '1'
  } catch {
    return false
  }
}
export function setLargeText(on: boolean) {
  try {
    localStorage.setItem(LARGE, on ? '1' : '0')
  } catch {}
  document.documentElement.classList.toggle('text-lg-mode', on)
}

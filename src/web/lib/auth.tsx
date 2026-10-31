import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api'
import { applyTheme } from './theme'
import { PUB_ROLE_LABEL as SHARED_PUB_ROLE_LABEL } from '../../shared/roles'
import type { PubRoleKey } from '../../shared/roles'

export type SystemRole = 'super_admin' | 'pub_officer' | 'faculty_supervisor' | 'analyst' | 'team' | 'student'

export interface User {
  id: string
  username: string
  display_name: string
  student_number: string | null
  system_role: SystemRole
  scope_faculty_id: string | null
  must_change_password: number
  faculty_id: string | null
  theme: string | null
}

export interface PubRole {
  publication_id: string
  role: PubRoleKey
  title: string
  slug: string
  status: string
}

interface AuthState {
  user: User | null
  publications: PubRole[]
  home: string
  loading: boolean
  refresh: () => Promise<void>
  login: (username: string, password: string, totp?: string) => Promise<string>
  logout: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export const ROLE_LABEL: Record<SystemRole, string> = {
  super_admin: 'مدیر کل سامانه',
  pub_officer: 'مسئول نشریات',
  faculty_supervisor: 'ناظر دانشکده',
  analyst: 'تحلیلگر',
  team: 'تیم نشریه',
  student: 'دانشجو'
}
/** Re-exported from shared/roles.ts (keys match the API: managing_director / editor_in_chief / license_holder). */
export const PUB_ROLE_LABEL: Record<string, string> = SHARED_PUB_ROLE_LABEL

export const isAdmin = (u: User | null) => !!u && (u.system_role === 'super_admin' || u.system_role === 'pub_officer')
export const isMonitor = (u: User | null) => !!u && ['super_admin', 'pub_officer', 'faculty_supervisor', 'analyst'].includes(u.system_role)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [publications, setPubs] = useState<PubRole[]>([])
  const [home, setHome] = useState('/')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ user: User | null; publications: PubRole[]; home?: string }>('/api/auth/me')
      setUser(r.user)
      setPubs(r.publications || [])
      setHome(r.home || '/')
      if (r.user?.theme) applyTheme(r.user.theme as any, false)
    } catch {
      setUser(null)
      setPubs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const onUnauth = () => {
      setUser(null)
      setPubs([])
    }
    window.addEventListener('nsh:unauthorized', onUnauth)
    return () => window.removeEventListener('nsh:unauthorized', onUnauth)
  }, [refresh])

  const login = useCallback(
    async (username: string, password: string, totp?: string) => {
      const r = await api.post<{ home: string }>('/api/auth/login', totp ? { username, password, totp } : { username, password })
      await refresh()
      return r.home || '/'
    },
    [refresh]
  )

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => {})
    setUser(null)
    setPubs([])
    setHome('/')
  }, [])

  const value = useMemo(() => ({ user, publications, home, loading, refresh, login, logout }), [user, publications, home, loading, refresh, login, logout])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}

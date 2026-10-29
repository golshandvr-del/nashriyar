import type { Db } from './adapters/db'
import type { Storage } from './adapters/storage'

export type SystemRole = 'super_admin' | 'pub_officer' | 'faculty_supervisor' | 'analyst' | 'team' | 'student'
export type PubRole = 'managing_director' | 'editor_in_chief' | 'license_holder'

export interface SessionUser {
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

export interface Deps {
  db: Db
  storage: Storage
  /** Server secret for HMAC signing (page URLs, viewer hashes). */
  secret: string
  /** Optional AI config (feature is fully optional). */
  ai?: { baseUrl?: string; apiKey?: string; model?: string }
}

export type AppEnv = {
  Variables: {
    deps: Deps
    db: Db
    user: SessionUser | null
    sessionId: string | null
  }
}

export const ADMIN_ROLES: SystemRole[] = ['super_admin', 'pub_officer']
export const MONITOR_ROLES: SystemRole[] = ['super_admin', 'pub_officer', 'faculty_supervisor', 'analyst']

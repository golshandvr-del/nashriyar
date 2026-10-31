import type { Db } from './adapters/db'
import type { Storage } from './adapters/storage'

// `developer` = technical maintainer (ROADMAP phase 13): only the /system console, created from the CLI only.
export type SystemRole = 'developer' | 'super_admin' | 'pub_officer' | 'faculty_supervisor' | 'analyst' | 'team' | 'student'
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

/** One rendered PDF page (server-side conversion, ROADMAP phase 11). */
export interface RenderedPage {
  page_number: number
  bytes: Uint8Array
  mime: string
  ext: string
  text: string | null
}

/**
 * Optional server-side PDF → page images converter (self-hosted only, e.g. poppler's pdftoppm).
 * On Cloudflare it is absent and the browser (pdf.js) converts instead.
 */
export interface PdfRenderer {
  name: string
  render(pdf: Uint8Array, opts: { width: number; onPage: (p: RenderedPage) => Promise<void> }): Promise<{ page_count: number }>
}

/** Disk usage report on self-hosted Node installs (ROADMAP phase 11 monitoring). */
export interface DiskStatus {
  total_bytes: number
  free_bytes: number
  used_bytes: number
  used_pct: number
  warn_pct: number
  warn: boolean
}

/** Self-hosted operations exposed to the developer console (ROADMAP phase 13). Node entry only; absent on Cloudflare. */
export interface SystemOps {
  listBackups(): { name: string; size: number; mtime: string; kind: 'db' | 'files' }[]
  backupDb(): { file: string; offsite: string | null }
  backupFiles(): { file: string; offsite: string | null }
  restoreTest(): unknown
  /** Bytes of one backup file (name must come from listBackups; never a path). */
  readBackup(name: string): Uint8Array | null
  vacuum(): void
  analyze(): void
  dbFileBytes(): number | null
  version: { app: string; commit: string | null; node: string; started_at: string }
}

export interface Deps {
  db: Db
  storage: Storage
  /** Server secret for HMAC signing (page URLs, viewer hashes). */
  secret: string
  /** Optional AI config (feature is fully optional). */
  ai?: { baseUrl?: string; apiKey?: string; model?: string }
  /** Optional server-side PDF converter (Node entry only, when poppler-utils is installed). */
  pdf?: PdfRenderer
  /** Optional disk space probe (Node entry only, via fs.statfsSync). */
  disk?: () => DiskStatus | null
  /** Optional backup/maintenance operations for the /system console (Node entry only). */
  ops?: SystemOps
  /** Optional IP allowlist for /api/system/* (env SYSTEM_IP_ALLOWLIST, comma-separated). Empty = no restriction. */
  systemIpAllowlist?: string[]
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

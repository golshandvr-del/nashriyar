// Self-hosted backups (ROADMAP phase 11): daily DB snapshot, weekly files archive, 30-day retention,
// optional off-server copy (BACKUP_OFFSITE_DIR — e.g. an NFS / rclone mount) and an automated restore test.
// Node-only (fs, child_process); used by entry/node.ts.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'

const DAY = 86400_000
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

function prune(dir: string, re: RegExp, keepDays: number) {
  const cutoff = Date.now() - keepDays * DAY
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const full = path.join(dir, f)
    if (re.test(f) && fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { force: true })
  }
}

function offsite(file: string) {
  const dir = process.env.BACKUP_OFFSITE_DIR
  if (!dir) return null
  fs.mkdirSync(dir, { recursive: true })
  const dst = path.join(dir, path.basename(file))
  fs.copyFileSync(file, dst)
  prune(dir, /^nashriyar-(files-)?.*\.(db|tar\.gz)$/, Number(process.env.BACKUP_KEEP_DAYS || 30))
  return dst
}

/** Consistent DB snapshot (VACUUM INTO works while the server runs in WAL mode) + retention + off-site copy. */
export function backupDb(sqlite: DatabaseSync, dataDir: string): { file: string; offsite: string | null } {
  const dir = path.join(dataDir, 'backups')
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, `nashriyar-${stamp()}.db`)
  sqlite.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`)
  prune(dir, /^nashriyar-\d.*\.db$/, Number(process.env.BACKUP_KEEP_DAYS || 30))
  return { file: out, offsite: offsite(out) }
}

/** Weekly archive of uploaded files (tar.gz via the system `tar`) + retention + off-site copy. */
export function backupFiles(dataDir: string): { file: string; offsite: string | null } {
  const dir = path.join(dataDir, 'backups')
  fs.mkdirSync(dir, { recursive: true })
  fs.mkdirSync(path.join(dataDir, 'files'), { recursive: true })
  const out = path.join(dir, `nashriyar-files-${stamp()}.tar.gz`)
  execFileSync('tar', ['-czf', out, '-C', dataDir, 'files'], { stdio: 'ignore' })
  prune(dir, /^nashriyar-files-.*\.tar\.gz$/, Number(process.env.BACKUP_KEEP_DAYS || 30))
  return { file: out, offsite: offsite(out) }
}

export interface RestoreTest {
  ok: boolean
  backup: string | null
  integrity: string
  tables: Record<string, { backup: number; live: number }>
  missing_files: number
  checked_files: number
  problems: string[]
}

/**
 * Restore test: opens the newest DB snapshot read-only, runs PRAGMA integrity_check, compares row counts with
 * the live database (the snapshot may only be behind, never ahead) and checks that the files it references exist.
 */
export function restoreTest(live: DatabaseSync, dataDir: string): RestoreTest {
  const dir = path.join(dataDir, 'backups')
  const files = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => /^nashriyar-\d.*\.db$/.test(f)).sort()
  const res: RestoreTest = { ok: false, backup: null, integrity: 'n/a', tables: {}, missing_files: 0, checked_files: 0, problems: [] }
  if (!files.length) {
    res.problems.push('هیچ پشتیبانی از پایگاه داده پیدا نشد')
    return res
  }
  res.backup = path.join(dir, files[files.length - 1])
  const snap = new DatabaseSync(res.backup, { readOnly: true })
  try {
    res.integrity = String((snap.prepare('PRAGMA integrity_check').get() as any)?.integrity_check ?? 'unknown')
    if (res.integrity !== 'ok') res.problems.push(`integrity_check: ${res.integrity}`)
    for (const t of ['users', 'publications', 'issues', 'issue_pages', 'media_assets', 'posts', 'access_codes', 'entitlements']) {
      const b = Number((snap.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as any).n)
      const l = Number((live.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as any).n)
      res.tables[t] = { backup: b, live: l }
      if (l > 0 && b === 0) res.problems.push(`جدول ${t} در پشتیبان خالی است`)
    }
    const keys = snap
      .prepare(
        `SELECT image_key AS k FROM issue_pages UNION SELECT storage_key FROM media_assets
         UNION SELECT cover_key FROM issues WHERE cover_key IS NOT NULL UNION SELECT main_pdf_key FROM issues WHERE main_pdf_key IS NOT NULL`
      )
      .all() as { k: string }[]
    for (const { k } of keys) {
      res.checked_files++
      if (!fs.existsSync(path.join(dataDir, 'files', k))) res.missing_files++
    }
    if (res.missing_files) res.problems.push(`${res.missing_files} فایلِ ارجاع‌شده روی دیسک نیست`)
  } finally {
    snap.close()
  }
  res.ok = res.problems.length === 0
  fs.writeFileSync(path.join(dir, 'restore-test.json'), JSON.stringify({ at: new Date().toISOString(), ...res }, null, 2))
  return res
}

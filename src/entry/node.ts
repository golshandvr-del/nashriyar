// Self-hosted entry (university server / VPS) -> bundled to server-dist/node.mjs by scripts/build-server.mjs.
// Usage:
//   node server-dist/node.mjs              start the server (PORT, HOST, DATA_DIR, APP_SECRET, STATIC_DIR)
//   node server-dist/node.mjs --seed       reset the database and load demo data, then exit
//   node server-dist/node.mjs --migrate    apply migrations, then exit
//   node server-dist/node.mjs --create-admin [username]   create (or reset, incl. 2FA) a super admin with a random one-time password
//   PDF_RENDERER=browser                    disable server-side PDF conversion (default: pdftoppm when installed)
//   node server-dist/node.mjs --maintenance  run the periodic job once (rollup, reminders, purges), then exit
//   CRON=off / BACKUP_HOUR=3                 in-process scheduler: maintenance every 15 min, daily backup at BACKUP_HOUR (-1 = off)
//   node server-dist/node.mjs --backup     consistent DB snapshot to DATA_DIR/backups (+ BACKUP_OFFSITE_DIR), prune > BACKUP_KEEP_DAYS (30)
//   node server-dist/node.mjs --backup-files   weekly files tar.gz to DATA_DIR/backups (+ BACKUP_OFFSITE_DIR)
//   node server-dist/node.mjs --restore-test   verify newest DB snapshot (integrity_check, row counts, referenced files)
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from '../server/app'
import { nodeSqliteDb } from '../server/adapters/db'
import { diskStorage } from '../server/adapters/storage'
import { ensureMigrated } from '../server/migrate'
import { popplerRenderer } from '../server/adapters/pdf-poppler'
import { runMaintenance } from '../server/lib/maintenance'
import { backupDb, backupFiles, restoreTest } from './backup'
import { resolveSecret } from '../server/secret'
import type { Deps } from '../server/context'
import { hashPassword, newId, randomId } from '../server/lib/crypto'

const args = new Set(process.argv.slice(2))
const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data')
const STATIC_DIR = process.env.STATIC_DIR || 'dist'
const PORT = Number(process.env.PORT || 3000)
const HOST = process.env.HOST || '0.0.0.0'
const DB_FILE = path.join(DATA_DIR, 'nashriyar.db')

fs.mkdirSync(DATA_DIR, { recursive: true })

async function main() {
  if (args.has('--seed')) {
    for (const f of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) fs.rmSync(f, { force: true })
    fs.rmSync(path.join(DATA_DIR, 'files'), { recursive: true, force: true })
  }

  const sqlite = new DatabaseSync(DB_FILE)
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF; PRAGMA busy_timeout = 5000;')
  const db = nodeSqliteDb(sqlite)
  const storage = diskStorage(path.join(DATA_DIR, 'files'), fs, path)
  await ensureMigrated(db)
  const deps: Deps = {
    db,
    storage,
    secret: await resolveSecret(db, process.env.APP_SECRET),
    ai: { baseUrl: process.env.AI_BASE_URL, apiKey: process.env.AI_API_KEY, model: process.env.AI_MODEL },
    // Server-side PDF conversion (ROADMAP phase 11) when poppler-utils is installed; PDF_RENDERER=browser disables it.
    pdf: process.env.PDF_RENDERER === 'browser' ? undefined : (await popplerRenderer()) ?? undefined
  }

  if (args.has('--create-admin')) {
    // First-install bootstrap from the command line (never from the UI). Prints a one-time password;
    // the account must change it on first login. Re-running for an existing super admin resets the password.
    const argv = process.argv.slice(2)
    const next = argv[argv.indexOf('--create-admin') + 1]
    const username = (next && !next.startsWith('--') ? next : 'admin').toLowerCase()
    const password = randomId(14)
    const hash = await hashPassword(password)
    const existing = await db.first<{ id: string; system_role: string }>('SELECT id, system_role FROM users WHERE username = ?', [username])
    if (existing && existing.system_role !== 'super_admin') {
      console.error(`[nashriyar] user "${username}" exists and is not a super admin — choose another username`)
      process.exitCode = 1
      return
    }
    if (existing) {
      // Also clears 2FA: this is the recovery path for a super admin who lost their authenticator.
      await db.run(
        "UPDATE users SET password_hash = ?, must_change_password = 1, status = 'active', totp_enabled = 0, totp_secret = NULL, totp_last_step = NULL WHERE id = ?",
        [hash, existing.id]
      )
      await db.run('DELETE FROM sessions WHERE user_id = ?', [existing.id])
    } else {
      await db.run(
        "INSERT INTO users (id, username, display_name, password_hash, must_change_password, system_role, created_at) VALUES (?,?,?,?,1,'super_admin',?)",
        [newId(), username, 'مدیر سامانه', hash, new Date().toISOString()]
      )
    }
    console.log(`[nashriyar] super admin ${existing ? 'password reset' : 'created'}\n  username: ${username}\n  password: ${password}\n  (one-time — change it on first login)`)
    return
  }

  if (args.has('--backup')) {
    const r = backupDb(sqlite, DATA_DIR)
    console.log(`[nashriyar] backup written: ${r.file}${r.offsite ? ` (offsite: ${r.offsite})` : ''}`)
    return
  }

  if (args.has('--backup-files')) {
    const r = backupFiles(DATA_DIR)
    console.log(`[nashriyar] files archive written: ${r.file}${r.offsite ? ` (offsite: ${r.offsite})` : ''}`)
    return
  }

  if (args.has('--restore-test')) {
    const r = restoreTest(sqlite, DATA_DIR)
    console.log('[nashriyar] restore-test', JSON.stringify(r))
    if (!r.ok) process.exitCode = 1
    return
  }

  if (args.has('--maintenance')) {
    console.log('[nashriyar] maintenance', JSON.stringify(await runMaintenance(db)))
    return
  }

  if (args.has('--migrate')) {
    console.log('[nashriyar] migrations applied')
    return
  }
  if (args.has('--seed')) {
    const { seed } = await import('../server/seed')
    await seed(deps, { log: (m: string) => console.log('[seed]', m) })
    console.log('[nashriyar] demo data loaded')
    return
  }

  const api = createApp(() => deps)
  const root = new Hono()
  root.route('/', api)
  root.use('/*', serveStatic({ root: STATIC_DIR }))
  // SPA fallback for client-side routes
  root.get('*', serveStatic({ root: STATIC_DIR, rewriteRequestPath: () => '/index.html' }))

  serve({ fetch: root.fetch, port: PORT, hostname: HOST }, (info) => {
    console.log(`[nashriyar] listening on http://${HOST}:${info.port} (data: ${DATA_DIR})`)
  })

  // In-process scheduler (ROADMAP phase 11 — replaces the lazy, request-driven jobs on self-hosted installs).
  // Maintenance every 15 minutes (idempotent, cheap); DB backup once a day at BACKUP_HOUR (server local time, default 3).
  // CRON=off disables it (e.g. when the host crontab runs --maintenance / --backup instead).
  if (process.env.CRON !== 'off') {
    const backupHour = Number(process.env.BACKUP_HOUR ?? 3)
    let lastBackupDay = ''
    const tick = async () => {
      try {
        await runMaintenance(db)
      } catch (e) {
        console.error('[nashriyar] maintenance failed', e)
      }
      const now = new Date()
      const day = now.toISOString().slice(0, 10)
      if (backupHour >= 0 && now.getHours() === backupHour && lastBackupDay !== day) {
        lastBackupDay = day
        try {
          const dbSnap = backupDb(sqlite, DATA_DIR)
          // Fridays (day 5 in Iran's weekend) also archive uploaded files and run the automated restore test.
          const filesSnap = now.getDay() === 5 ? backupFiles(DATA_DIR) : null
          const check = restoreTest(sqlite, DATA_DIR)
          console.log('[nashriyar] daily backup', JSON.stringify({ db: dbSnap.file, files: filesSnap?.file ?? null, restore_ok: check.ok }))
        } catch (e) {
          console.error('[nashriyar] daily backup failed', e)
        }
      }
    }
    setTimeout(tick, 15_000).unref()
    setInterval(tick, 15 * 60_000).unref()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

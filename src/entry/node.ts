// Self-hosted entry (university server / VPS) -> bundled to server-dist/node.mjs by scripts/build-server.mjs.
// Usage:
//   node server-dist/node.mjs              start the server (PORT, HOST, DATA_DIR, APP_SECRET, STATIC_DIR)
//   node server-dist/node.mjs --seed       reset the database and load demo data, then exit
//   node server-dist/node.mjs --migrate    apply migrations, then exit
//   node server-dist/node.mjs --create-admin [username]   create (or reset, incl. 2FA) a super admin with a random one-time password
//   node server-dist/node.mjs --backup     consistent DB snapshot to DATA_DIR/backups (VACUUM INTO), prune > BACKUP_KEEP_DAYS (30)
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
    ai: { baseUrl: process.env.AI_BASE_URL, apiKey: process.env.AI_API_KEY, model: process.env.AI_MODEL }
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
    // VACUUM INTO produces a consistent, compacted copy even while the server is running (WAL mode).
    const dir = path.join(DATA_DIR, 'backups')
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const out = path.join(dir, `nashriyar-${stamp}.db`)
    sqlite.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`)
    const keepDays = Number(process.env.BACKUP_KEEP_DAYS || 30)
    const cutoff = Date.now() - keepDays * 86400000
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f)
      if (/^nashriyar-.*\.db$/.test(f) && fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { force: true })
    }
    console.log(`[nashriyar] backup written: ${out}`)
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
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

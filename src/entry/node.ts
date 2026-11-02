// Self-hosted entry (university server / VPS) -> bundled to server-dist/node.mjs by scripts/build-server.mjs.
// Usage:
//   node server-dist/node.mjs              start the server (PORT, HOST, DATA_DIR, APP_SECRET, STATIC_DIR)
//   node server-dist/node.mjs --seed       reset the database and load demo data, then exit
//   node server-dist/node.mjs --migrate    apply migrations, then exit
//   node server-dist/node.mjs --create-admin [username]   create (or reset, incl. 2FA) a super admin with a random one-time password
//   PDF_RENDERER=browser                    disable server-side PDF conversion (default: pdftoppm when installed)
//   VIDEO_TRANSCODE=off                     disable ffmpeg normalisation/HLS of explore videos (default: on when ffmpeg is installed)
//   node server-dist/node.mjs --maintenance  run the periodic job once (rollup, reminders, purges), then exit
//   CRON=off / BACKUP_HOUR=3                 in-process scheduler: maintenance every 15 min, daily backup at BACKUP_HOUR (-1 = off)
//   node server-dist/node.mjs --backup     consistent DB snapshot to DATA_DIR/backups (+ BACKUP_OFFSITE_DIR), prune > BACKUP_KEEP_DAYS (30)
//   node server-dist/node.mjs --backup-files   weekly files tar.gz to DATA_DIR/backups (+ BACKUP_OFFSITE_DIR)
//   node server-dist/node.mjs --restore-test   verify newest DB snapshot (integrity_check, row counts, referenced files)
// Multi-university (ROADMAP phase 19, src/server/tenancy.ts): with DATA_DIR/tenants.json (or TENANTS_FILE) every
// university gets its own database/files/backups under DATA_DIR/tenants/<slug>, chosen by the Host header.
//   node server-dist/node.mjs --list-tenants                    print slug, hosts and name of every university
//   node server-dist/node.mjs --create-admin admin --tenant ut   per-university commands need --tenant <slug>
//   --migrate / --maintenance / --backup / --backup-files        run for every university unless --tenant is given
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
import { ffmpegTranscoder } from '../server/adapters/video-ffmpeg'
import { resumePendingVideos } from '../server/lib/video-jobs'
import { runMaintenance } from '../server/lib/maintenance'
import { backupDb, backupFiles, restoreTest } from './backup'
import { resolveSecret } from '../server/secret'
import { parseTenantConfig, resolveTenant, tenantSecret, type TenantConfig } from '../server/tenancy'
import { HttpError } from '../server/lib/util'
import type { Deps } from '../server/context'
import { hashPassword, newId, randomId } from '../server/lib/crypto'

const args = new Set(process.argv.slice(2))
const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data')
const STATIC_DIR = process.env.STATIC_DIR || 'dist'
const PORT = Number(process.env.PORT || 3000)
const HOST = process.env.HOST || '0.0.0.0'

fs.mkdirSync(DATA_DIR, { recursive: true })

const BACKUP_RE = /^nashriyar-(files-)?\d[\w-]*\.(db|tar\.gz)$/

function appVersion(): string {
  try {
    return String(JSON.parse(fs.readFileSync('package.json', 'utf8')).version || 'unknown')
  } catch {
    return 'unknown'
  }
}

interface Site {
  slug: string | null
  dataDir: string
  dbFile: string
  sqlite: DatabaseSync
  db: ReturnType<typeof nodeSqliteDb>
  deps: Deps
}

/**
 * Opens one site (one university): its SQLite database, file store, backups and console operations, all under
 * `dataDir`. Single-tenant installs have exactly one site at DATA_DIR; multi-university installs (ROADMAP phase 19,
 * src/server/tenancy.ts) have one per university at DATA_DIR/tenants/<slug>.
 */
async function openSite(dataDir: string, slug: string | null, opts: { reset?: boolean } = {}): Promise<Site> {
  fs.mkdirSync(dataDir, { recursive: true })
  const dbFile = path.join(dataDir, 'nashriyar.db')
  if (opts.reset) {
    for (const f of [dbFile, dbFile + '-wal', dbFile + '-shm']) fs.rmSync(f, { force: true })
    fs.rmSync(path.join(dataDir, 'files'), { recursive: true, force: true })
  }
  const sqlite = new DatabaseSync(dbFile)
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF; PRAGMA busy_timeout = 5000;')
  // SQL_LOG=<file>: append every distinct statement once (query-plan audit, tests/query-plan.mjs). Off by default.
  const sqlLog = process.env.SQL_LOG
  const db = nodeSqliteDb(sqlite, sqlLog ? (sql) => fs.appendFileSync(sqlLog, sql.replace(/\s+/g, ' ').trim() + '\n') : undefined)
  const storage = diskStorage(path.join(dataDir, 'files'), fs, path)
  await ensureMigrated(db)
  const deps: Deps = {
    db,
    storage,
    // each university signs with its own secret (a shared APP_SECRET is derived per tenant)
    secret: await resolveSecret(db, slug ? tenantSecret(process.env.APP_SECRET, slug) : process.env.APP_SECRET),
    ai: { baseUrl: process.env.AI_BASE_URL, apiKey: process.env.AI_API_KEY, model: process.env.AI_MODEL },
    // Server-side PDF conversion (ROADMAP phase 11) when poppler-utils is installed; PDF_RENDERER=browser disables it.
    pdf: process.env.PDF_RENDERER === 'browser' ? undefined : (await popplerRenderer()) ?? undefined,
    // Short explore videos (ROADMAP phase 19): MP4 normalisation + HLS + poster when ffmpeg is installed.
    video: process.env.VIDEO_TRANSCODE === 'off' ? undefined : (await ffmpegTranscoder()) ?? undefined,
    disk: () => {
      try {
        const st = fs.statfsSync(dataDir)
        const total = Number(st.blocks) * Number(st.bsize)
        const free = Number(st.bavail) * Number(st.bsize)
        const used = Math.max(0, total - free)
        const usedPct = total > 0 ? Math.round((used / total) * 1000) / 10 : 0
        const warnPct = Number(process.env.DISK_WARN_PCT || 85)
        return { total_bytes: total, free_bytes: free, used_bytes: used, used_pct: usedPct, warn_pct: warnPct, warn: usedPct >= warnPct }
      } catch {
        return null
      }
    },
    // Developer console operations (ROADMAP phase 13). Backup names are validated against the directory listing,
    // so a request can never read an arbitrary path.
    ops: {
      listBackups: () => {
        const dir = path.join(dataDir, 'backups')
        return (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
          .filter((f) => BACKUP_RE.test(f))
          .map((f) => {
            const st = fs.statSync(path.join(dir, f))
            return { name: f, size: st.size, mtime: st.mtime.toISOString(), kind: (f.startsWith('nashriyar-files-') ? 'files' : 'db') as 'db' | 'files' }
          })
          .sort((a, b) => b.mtime.localeCompare(a.mtime))
      },
      backupDb: () => backupDb(sqlite, dataDir),
      backupFiles: () => backupFiles(dataDir),
      restoreTest: () => restoreTest(sqlite, dataDir),
      readBackup: (name: string) => {
        if (!BACKUP_RE.test(name) || name.includes('/') || name.includes('..')) return null
        const full = path.join(dataDir, 'backups', name)
        return fs.existsSync(full) ? new Uint8Array(fs.readFileSync(full)) : null
      },
      vacuum: () => sqlite.exec('VACUUM'),
      analyze: () => sqlite.exec('ANALYZE'),
      dbFileBytes: () => {
        try {
          return fs.statSync(dbFile).size
        } catch {
          return null
        }
      },
      version: { app: appVersion(), commit: process.env.GIT_COMMIT || null, node: process.version, started_at: new Date().toISOString() }
    },
    systemIpAllowlist: (process.env.SYSTEM_IP_ALLOWLIST || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return { slug, dataDir, dbFile, sqlite, db, deps }
}

/** Multi-university configuration (TENANTS_FILE or DATA_DIR/tenants.json); null = classic single-tenant install. */
function loadTenants(): TenantConfig | null {
  const file = process.env.TENANTS_FILE ? path.resolve(process.env.TENANTS_FILE) : path.join(DATA_DIR, 'tenants.json')
  if (!fs.existsSync(file)) {
    if (process.env.TENANTS_FILE) throw new Error(`TENANTS_FILE not found: ${file}`)
    return null
  }
  return parseTenantConfig(JSON.parse(fs.readFileSync(file, 'utf8')))
}

const tenantDir = (slug: string) => path.join(DATA_DIR, 'tenants', slug)

/** Value after a CLI flag (`--tenant ut`), or null. */
function argAfter(flag: string): string | null {
  const argv = process.argv.slice(2)
  const i = argv.indexOf(flag)
  const v = i >= 0 ? argv[i + 1] : undefined
  return v && !v.startsWith('--') ? v : null
}

const CLI_ONE_SITE = ['--seed', '--create-admin', '--create-developer', '--restore-test']
const CLI_EVERY_SITE = ['--migrate', '--maintenance', '--backup', '--backup-files']

async function main() {
  const tenants = loadTenants()
  if (args.has('--list-tenants')) {
    if (!tenants) console.log('[nashriyar] single-tenant install (no tenants.json)')
    else for (const t of tenants.tenants) console.log(`${t.slug}\t${t.hosts.join(',')}\t${t.name}${tenants.default === t.slug ? '\t(default)' : ''}`)
    return
  }
  const cli = [...CLI_ONE_SITE, ...CLI_EVERY_SITE].some((f) => args.has(f))
  if (tenants && cli) {
    // multi-university CLI: --tenant <slug> picks one university; maintenance-type jobs default to all of them
    const want = argAfter('--tenant')
    if (want && !tenants.tenants.some((t) => t.slug === want)) throw new Error(`unknown tenant "${want}" (see --list-tenants)`)
    if (!want && CLI_ONE_SITE.some((f) => args.has(f))) throw new Error('multi-university install: add --tenant <slug> (see --list-tenants)')
    for (const t of tenants.tenants.filter((x) => !want || x.slug === want)) {
      console.log(`[nashriyar] tenant ${t.slug}`)
      await runCli(await openSite(tenantDir(t.slug), t.slug, { reset: args.has('--seed') }))
    }
    return
  }
  if (tenants) return serveTenants(tenants)
  const site = await openSite(DATA_DIR, null, { reset: args.has('--seed') })
  if (cli) return runCli(site)
  return serveSites(() => site, [site])
}

async function runCli(site: Site) {
  const { db, deps, sqlite } = site
  const dataDirOf = site.dataDir
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

  if (args.has('--create-developer')) {
    // ROADMAP phase 13: the developer (technical maintainer) account can ONLY be created/reset from the server CLI.
    // TOTP is mandatory: the console stays locked until 2FA is enabled. Re-running resets password + 2FA (recovery path).
    const argv = process.argv.slice(2)
    const next = argv[argv.indexOf('--create-developer') + 1]
    const username = (next && !next.startsWith('--') ? next : 'developer').toLowerCase()
    const password = randomId(18)
    const hash = await hashPassword(password)
    const existing = await db.first<{ id: string; system_role: string }>('SELECT id, system_role FROM users WHERE username = ?', [username])
    if (existing && existing.system_role !== 'developer') {
      console.error(`[nashriyar] user "${username}" exists and is not a developer — choose another username`)
      process.exitCode = 1
      return
    }
    const now = new Date().toISOString()
    if (existing) {
      await db.run(
        "UPDATE users SET password_hash = ?, must_change_password = 1, status = 'active', totp_enabled = 0, totp_secret = NULL, totp_last_step = NULL WHERE id = ?",
        [hash, existing.id]
      )
      await db.run('DELETE FROM sessions WHERE user_id = ?', [existing.id])
    } else {
      await db.run(
        "INSERT INTO users (id, username, display_name, password_hash, must_change_password, system_role, created_at) VALUES (?,?,?,?,1,'developer',?)",
        [newId(), username, 'طراح سامانه', hash, now]
      )
    }
    await db.run('INSERT INTO system_audit (id, actor_user_id, action, detail_json, ip, created_at) VALUES (?,?,?,?,?,?)', [
      newId(),
      null,
      existing ? 'system.developer_reset' : 'system.developer_create',
      JSON.stringify({ username, via: 'cli' }),
      'cli',
      now
    ])
    console.log(
      `[nashriyar] developer ${existing ? 'password + 2FA reset' : 'created'}\n  username: ${username}\n  password: ${password}\n  (one-time — change it on first login, then enable 2FA to unlock /system)`
    )
    return
  }

  if (args.has('--backup')) {
    const r = backupDb(sqlite, dataDirOf)
    console.log(`[nashriyar] backup written: ${r.file}${r.offsite ? ` (offsite: ${r.offsite})` : ''}`)
    return
  }

  if (args.has('--backup-files')) {
    const r = backupFiles(dataDirOf)
    console.log(`[nashriyar] files archive written: ${r.file}${r.offsite ? ` (offsite: ${r.offsite})` : ''}`)
    return
  }

  if (args.has('--restore-test')) {
    const r = restoreTest(sqlite, dataDirOf)
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

}

/** Starts the HTTP server. `pick` maps a request to its university's site (null → 404); `sites` = every site. */
function serveSites(pick: (host: string | undefined) => Site | null, sites: Site[], label = DATA_DIR) {
  const api = createApp((c) => {
    const site = pick(c.req.header('host'))
    if (!site) throw new HttpError(404, 'این دامنه به هیچ دانشگاهی متصل نیست', 'unknown_host')
    return site.deps
  })
  const root = new Hono()
  // multi-university: a host that belongs to no university gets a plain 404 (static files included)
  root.use('*', async (c, next) => {
    if (!pick(c.req.header('host'))) return c.text('unknown host', 404)
    return next()
  })
  root.route('/', api)
  root.use('/*', serveStatic({ root: STATIC_DIR }))
  // SPA fallback for client-side routes
  root.get('*', serveStatic({ root: STATIC_DIR, rewriteRequestPath: () => '/index.html' }))

  serve({ fetch: root.fetch, port: PORT, hostname: HOST }, (info) => {
    console.log(`[nashriyar] listening on http://${HOST}:${info.port} (data: ${label})`)
  })
  for (const site of sites) {
    // explore videos left half-processed by a restart are transcoded again (ROADMAP phase 19)
    resumePendingVideos(site.deps)
      .then((n) => n && console.log(`[nashriyar] ${site.slug ? site.slug + ': ' : ''}resumed ${n} pending video transcode(s)`))
      .catch(() => {})
  }

  // In-process scheduler (ROADMAP phase 11 — replaces the lazy, request-driven jobs on self-hosted installs).
  // Maintenance every 15 minutes (idempotent, cheap); DB backup once a day at BACKUP_HOUR (server local time, default 3).
  // CRON=off disables it (e.g. when the host crontab runs --maintenance / --backup instead). Every university's
  // database is maintained and backed up separately (into its own backups/ folder).
  if (process.env.CRON !== 'off') {
    const backupHour = Number(process.env.BACKUP_HOUR ?? 3)
    let lastBackupDay = ''
    const tick = async () => {
      const now = new Date()
      const day = now.toISOString().slice(0, 10)
      const backupNow = backupHour >= 0 && now.getHours() === backupHour && lastBackupDay !== day
      if (backupNow) lastBackupDay = day
      for (const site of sites) {
        const tag = site.slug ? ` (${site.slug})` : ''
        try {
          await runMaintenance(site.db)
        } catch (e) {
          console.error(`[nashriyar] maintenance failed${tag}`, e)
        }
        if (!backupNow) continue
        try {
          const dbSnap = backupDb(site.sqlite, site.dataDir)
          // Fridays (day 5 in Iran's weekend) also archive uploaded files and run the automated restore test.
          const filesSnap = now.getDay() === 5 ? backupFiles(site.dataDir) : null
          const check = restoreTest(site.sqlite, site.dataDir)
          console.log(`[nashriyar] daily backup${tag}`, JSON.stringify({ db: dbSnap.file, files: filesSnap?.file ?? null, restore_ok: check.ok }))
        } catch (e) {
          console.error(`[nashriyar] daily backup failed${tag}`, e)
        }
      }
    }
    setTimeout(tick, 15_000).unref()
    setInterval(tick, 15 * 60_000).unref()
  }
}

/** Multi-university server: every university in tenants.json is opened at start (adding one needs a restart). */
async function serveTenants(cfg: TenantConfig) {
  const bySlug = new Map<string, Site>()
  for (const t of cfg.tenants) bySlug.set(t.slug, await openSite(tenantDir(t.slug), t.slug))
  console.log(`[nashriyar] multi-university mode: ${cfg.tenants.map((t) => `${t.slug} → ${t.hosts.join(', ')}`).join(' | ')}`)
  serveSites(
    (host) => {
      const t = resolveTenant(cfg, host)
      return t ? bySlug.get(t.slug) || null : null
    },
    [...bySlug.values()],
    `${DATA_DIR}/tenants/*`
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

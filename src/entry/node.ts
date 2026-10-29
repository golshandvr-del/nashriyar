// Self-hosted entry (university server / VPS) -> bundled to server-dist/node.mjs by scripts/build-server.mjs.
// Usage:
//   node server-dist/node.mjs              start the server (PORT, HOST, DATA_DIR, APP_SECRET, STATIC_DIR)
//   node server-dist/node.mjs --seed       reset the database and load demo data, then exit
//   node server-dist/node.mjs --migrate    apply migrations, then exit
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

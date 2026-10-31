// Data transfer: Cloudflare (D1 + R2) → self-hosted Node (SQLite + disk). ROADMAP phase 11.
//
// 1) Export on any machine with wrangler + rclone:
//      npx wrangler d1 export nashriyar-production --remote --output=d1.sql
//      rclone copy r2:nashriyar-media ./r2-files          # R2 via its S3-compatible endpoint
// 2) Import on the new server (the app must be stopped; DATA_DIR must not contain a database yet):
//      node scripts/import-cf.mjs --sql d1.sql --files ./r2-files --data /data [--force]
//
// What it does:
//   - builds DATA_DIR/nashriyar.db from the D1 SQL export (WAL mode),
//   - copies every object into DATA_DIR/files/<key> with the `.meta` content-type sidecar the disk adapter uses,
//   - verifies: row counts of the main tables, every storage key referenced by the database exists,
//     and SHA-256 of each copied file equals the source,
//   - writes DATA_DIR/import-report.json and exits non-zero on any mismatch.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const argv = process.argv.slice(2)
const opt = (name, def = null) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def
}
const flag = (name) => argv.includes(`--${name}`)

const SQL_FILE = opt('sql')
const FILES_DIR = opt('files')
const DATA_DIR = path.resolve(opt('data', process.env.DATA_DIR || 'data'))
if (!SQL_FILE || !FILES_DIR) {
  console.error('usage: node scripts/import-cf.mjs --sql d1.sql --files ./r2-files [--data DATA_DIR] [--force]')
  process.exit(2)
}

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  pdf: 'application/pdf', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm'
}
const mimeOf = (f) => MIME[path.extname(f).slice(1).toLowerCase()] || 'application/octet-stream'
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

function* walk(dir, base = dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(full, base)
    else if (!e.name.endsWith('.meta')) yield path.relative(base, full).split(path.sep).join('/')
  }
}

const DB_FILE = path.join(DATA_DIR, 'nashriyar.db')
const DEST_FILES = path.join(DATA_DIR, 'files')
fs.mkdirSync(DATA_DIR, { recursive: true })
if (fs.existsSync(DB_FILE)) {
  if (!flag('force')) {
    console.error(`[import] ${DB_FILE} already exists — refusing to overwrite (use --force after taking a backup)`)
    process.exit(1)
  }
  for (const f of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) fs.rmSync(f, { force: true })
}

// ---- 1) database ----
console.log(`[import] database ← ${SQL_FILE}`)
const sql = fs.readFileSync(SQL_FILE, 'utf8')
const db = new DatabaseSync(DB_FILE)
db.exec('PRAGMA foreign_keys = OFF;')
db.exec(sql)
db.exec('PRAGMA journal_mode = WAL;')
// Cloudflare-internal tables are meaningless on the new host.
for (const t of ['_cf_KV', '_cf_METADATA', 'd1_migrations']) {
  try {
    db.exec(`DROP TABLE IF EXISTS "${t}"`)
  } catch {}
}

const tables = ['users', 'faculties', 'associations', 'publications', 'issues', 'issue_pages', 'issue_toc_items', 'media_assets', 'posts', 'comments', 'access_codes', 'library_items', 'view_events', '_migrations']
const counts = {}
for (const t of tables) {
  try {
    counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n
  } catch {
    counts[t] = null // table absent in this export (older schema) — the app adds it on first start
  }
}

// ---- 2) files ----
console.log(`[import] files ← ${FILES_DIR}`)
const problems = []
let copied = 0
let bytes = 0
for (const key of walk(FILES_DIR)) {
  if (key.includes('..')) {
    problems.push({ key, error: 'unsafe key skipped' })
    continue
  }
  const src = path.join(FILES_DIR, key)
  const dst = path.join(DEST_FILES, key)
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
  fs.writeFileSync(dst + '.meta', JSON.stringify({ contentType: mimeOf(key) }))
  if (sha256(src) !== sha256(dst)) problems.push({ key, error: 'checksum mismatch' })
  copied++
  bytes += fs.statSync(dst).size
}

// ---- 3) every key referenced by the database must exist ----
const refs = [
  ['publications', 'logo_key'],
  ['issues', 'cover_key'],
  ['issues', 'main_pdf_key'],
  ['media_assets', 'storage_key'],
  ['issue_pages', 'image_key']
]
let referenced = 0
for (const [t, col] of refs) {
  let rows = []
  try {
    rows = db.prepare(`SELECT DISTINCT "${col}" AS k FROM "${t}" WHERE "${col}" IS NOT NULL AND "${col}" <> ''`).all()
  } catch {
    continue
  }
  for (const { k } of rows) {
    referenced++
    if (!fs.existsSync(path.join(DEST_FILES, k))) problems.push({ key: k, error: `missing file referenced by ${t}.${col}` })
  }
}
db.close()

const report = { at: new Date().toISOString(), data_dir: DATA_DIR, counts, files: { copied, bytes, referenced }, problems }
fs.writeFileSync(path.join(DATA_DIR, 'import-report.json'), JSON.stringify(report, null, 2))
console.log('[import] row counts', counts)
console.log(`[import] files copied: ${copied} (${(bytes / 1048576).toFixed(1)} MB), referenced keys: ${referenced}`)
if (problems.length) {
  console.error(`[import] ${problems.length} problem(s) — see ${path.join(DATA_DIR, 'import-report.json')}`)
  for (const p of problems.slice(0, 20)) console.error('  -', p.error, p.key)
  process.exit(1)
}
console.log('[import] OK — start the server; it applies any newer migrations on boot')

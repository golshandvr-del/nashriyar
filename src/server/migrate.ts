import type { Db } from './adapters/db'
// esbuild/vite load .sql files as text (see scripts/build-server.mjs and src/sql.d.ts)
import m0001 from '../../migrations/0001_init.sql'
import m0002 from '../../migrations/0002_totp.sql'
import m0003 from '../../migrations/0003_shelf_rules.sql'
import m0004 from '../../migrations/0004_registration_modes.sql'
import m0005 from '../../migrations/0005_post_alt_text.sql'
import m0006 from '../../migrations/0006_analytics_rollup.sql'
import m0007 from '../../migrations/0007_developer_console.sql'
import m0008 from '../../migrations/0008_events_calendar.sql'

export const MIGRATIONS: { name: string; sql: string }[] = [
  { name: '0001_init', sql: m0001 },
  { name: '0002_totp', sql: m0002 },
  { name: '0003_shelf_rules', sql: m0003 },
  { name: '0004_registration_modes', sql: m0004 },
  { name: '0005_post_alt_text', sql: m0005 },
  { name: '0006_analytics_rollup', sql: m0006 },
  { name: '0007_developer_console', sql: m0007 },
  { name: '0008_events_calendar', sql: m0008 }
]

/** Split a SQL script into single statements (strips `--` comments). */
export function splitSql(sql: string): string[] {
  return sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean)
}

let migrated = false

/** Idempotent: applies pending migrations once per process / isolate. */
export async function ensureMigrated(db: Db): Promise<void> {
  if (migrated) return
  await db.run('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  const done = new Set((await db.all<{ name: string }>('SELECT name FROM _migrations')).map((r) => r.name))
  for (const m of MIGRATIONS) {
    if (done.has(m.name)) continue
    for (const stmt of splitSql(m.sql)) await db.run(stmt)
    await db.run('INSERT OR IGNORE INTO _migrations (name, applied_at) VALUES (?, ?)', [m.name, new Date().toISOString()])
  }
  migrated = true
}

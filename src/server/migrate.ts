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
import m0009 from '../../migrations/0009_festivals.sql'
import m0010 from '../../migrations/0010_profiles_membership.sql'
import m0011 from '../../migrations/0011_query_plan_indexes.sql'
import m0012 from '../../migrations/0012_query_plan_indexes_2.sql'
import m0013 from '../../migrations/0013_sessions_purge_indexes.sql'
import m0014 from '../../migrations/0014_academic_year_archive.sql'
import m0015 from '../../migrations/0015_open_api_keys.sql'
import m0016 from '../../migrations/0016_article_index.sql'

export const MIGRATIONS: { name: string; sql: string }[] = [
  { name: '0001_init', sql: m0001 },
  { name: '0002_totp', sql: m0002 },
  { name: '0003_shelf_rules', sql: m0003 },
  { name: '0004_registration_modes', sql: m0004 },
  { name: '0005_post_alt_text', sql: m0005 },
  { name: '0006_analytics_rollup', sql: m0006 },
  { name: '0007_developer_console', sql: m0007 },
  { name: '0008_events_calendar', sql: m0008 },
  { name: '0009_festivals', sql: m0009 },
  { name: '0010_profiles_membership', sql: m0010 },
  { name: '0011_query_plan_indexes', sql: m0011 },
  { name: '0012_query_plan_indexes_2', sql: m0012 },
  { name: '0013_sessions_purge_indexes', sql: m0013 },
  { name: '0014_academic_year_archive', sql: m0014 },
  { name: '0015_open_api_keys', sql: m0015 },
  { name: '0016_article_index', sql: m0016 }
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

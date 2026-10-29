import type { Db } from './adapters/db'
import { randomId } from './lib/crypto'

/**
 * Resolves the HMAC signing secret. Preference: explicit env value (APP_SECRET) -> value persisted in
 * the settings table -> newly generated random secret (persisted so all isolates/processes agree).
 */
export async function resolveSecret(db: Db, envSecret?: string): Promise<string> {
  if (envSecret && envSecret.length >= 16) return envSecret
  await db.run('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)')
  const row = await db.first<{ value: string }>("SELECT value FROM settings WHERE key = '_app_secret'")
  if (row?.value) {
    try {
      const v = JSON.parse(row.value)
      if (typeof v === 'string' && v.length >= 16) return v
    } catch {}
  }
  const fresh = randomId(48)
  await db.run("INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('_app_secret', ?, ?)", [JSON.stringify(fresh), new Date().toISOString()])
  const again = await db.first<{ value: string }>("SELECT value FROM settings WHERE key = '_app_secret'")
  return again ? JSON.parse(again.value) : fresh
}

// Admin domain module: registration allowlist (SECURITY.md §2, migration 0004).
// Mounted by routes/admin.ts (ROADMAP phase 17 split; parent middleware applies).
import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { sha256 } from '../../lib/crypto'
import { normalizeSecret } from '../../routes/auth'
import { audit, bad, body, getSetting, nowIso } from '../../lib/util'
import { toEnDigits } from '../../../shared/fa'
import { admin } from './service'

export const allowlistRoutes = new Hono<AppEnv>()

// ───────── Registration allowlist (SECURITY.md §2, migration 0004) ─────────
allowlistRoutes.get('/registration-allowlist', async (c) => {
  admin(c)
  const db = c.get('db')
  const items = await db.all(
    'SELECT student_number, secret_kind, note, used_at, created_at FROM registration_allowlist ORDER BY created_at DESC, student_number LIMIT 2000'
  )
  const stats = await db.first<{ total: number; used: number }>(
    'SELECT COUNT(*) AS total, SUM(CASE WHEN used_at IS NOT NULL THEN 1 ELSE 0 END) AS used FROM registration_allowlist'
  )
  return c.json({ items, total: stats?.total ?? 0, used: stats?.used ?? 0, mode: await getSetting(db, 'registration_mode', 'open') })
})

/**
 * POST /api/admin/registration-allowlist { csv: "student_number[,national_id]\n…", activation_codes?: boolean }
 * Adds/updates rows. With activation_codes=true each row gets a random code (returned ONCE; only its hash is stored).
 */
allowlistRoutes.post('/registration-allowlist', async (c) => {
  const u = admin(c)
  const db = c.get('db')
  const b = await body<{ csv?: string; activation_codes?: boolean }>(c)
  const lines = String(b.csv || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5000)
  if (!lines.length) throw bad('فهرست خالی است')
  const codes: { student_number: string; code: string }[] = []
  let added = 0
  let skipped = 0
  const now = nowIso()
  const stmts: { sql: string; params: unknown[] }[] = []
  for (const line of lines) {
    const [rawSn, rawSecret] = line.split(/[,;\t]/).map((x) => (x || '').trim().replace(/^"|"$/g, ''))
    const sn = toEnDigits(rawSn || '')
    if (!/^\d{6,14}$/.test(sn)) {
      skipped++ // header row or invalid number
      continue
    }
    let secretHash: string | null = null
    let kind: string | null = null
    if (b.activation_codes) {
      const raw = Array.from(crypto.getRandomValues(new Uint8Array(8)), (x) => '23456789ABCDEFGHJKMNPQRSTUVWXYZ'[x % 31]).join('')
      const code = `${raw.slice(0, 4)}-${raw.slice(4)}`
      codes.push({ student_number: sn, code })
      secretHash = await sha256(normalizeSecret(code))
      kind = 'activation_code'
    } else if (rawSecret) {
      secretHash = await sha256(normalizeSecret(rawSecret))
      kind = 'national_id'
    }
    stmts.push({
      sql: `INSERT INTO registration_allowlist (student_number, secret_hash, secret_kind, created_by, created_at) VALUES (?,?,?,?,?)
            ON CONFLICT(student_number) DO UPDATE SET secret_hash = excluded.secret_hash, secret_kind = excluded.secret_kind`,
      params: [sn, secretHash, kind, u.id, now]
    })
    added++
  }
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100))
  await audit(db, u.id, 'allowlist.import', 'registration_allowlist', null, null, { added, skipped, activation_codes: !!b.activation_codes })
  return c.json({ ok: true, added, skipped, codes })
})

allowlistRoutes.delete('/registration-allowlist/:sn', async (c) => {
  const u = admin(c)
  const sn = toEnDigits(c.req.param('sn'))
  await c.get('db').run('DELETE FROM registration_allowlist WHERE student_number = ?', [sn])
  await audit(c.get('db'), u.id, 'allowlist.delete', 'registration_allowlist', sn)
  return c.json({ ok: true })
})

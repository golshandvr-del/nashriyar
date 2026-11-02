// Outbound notification channels (ROADMAP phase 19): email, Bale bot and Eitaa, next to the in-app notifications.
//  - email: any HTTP mail API with the Resend-compatible shape (POST {url} JSON {from,to,subject,text,html}, Bearer key)
//    — works on Cloudflare (no SMTP sockets) and on Node; an SMTP relay with an HTTP front-end works the same way.
//  - bale:  Bale bot API (Telegram-compatible): POST {api}/bot<token>/sendMessage {chat_id,text}. The user links the chat
//    by sending `/start <code>` to the bot (webhook or getUpdates polling).
//  - eitaa: Eitaayar API: POST {api}/<token>/sendMessage (form: chat_id,text). The user enters their Eitaa id and
//    confirms it with a code sent there.
// notify() enqueues one row per verified, non-muted channel of the recipient; flushOutbound() delivers them after the
// request and from the maintenance job, with exponential backoff. Nothing here ever throws into the caller.
import type { Db } from '../adapters/db'
import { newId, sha256 } from './crypto'

export const CHANNELS = ['email', 'bale', 'eitaa'] as const
export type Channel = (typeof CHANNELS)[number]
export const CHANNEL_LABEL: Record<Channel, string> = { email: 'ایمیل', bale: 'بله', eitaa: 'ایتا' }

/** User-facing categories a channel can be muted for (derived from the notification type prefix). */
export const CATEGORIES = {
  issue: 'شماره‌های تازهٔ نشریه‌های دنبال‌شده',
  post: 'پست‌ها',
  comment: 'نظرها',
  membership: 'عضویت',
  approval: 'تأیید و گردش‌کار',
  festival: 'جشنواره‌ها',
  publication: 'وضعیت نشریه',
  announcement: 'اطلاعیه‌ها',
  reminder: 'یادآوری مهلت‌ها',
  system: 'سایر'
} as const
export type Category = keyof typeof CATEGORIES

export function categoryOf(type: string): Category {
  const head = String(type || '').split('.')[0]
  if (head === 'deadline' || head === 'license') return 'reminder'
  return (Object.prototype.hasOwnProperty.call(CATEGORIES, head) ? head : 'system') as Category
}

export interface ChannelConfig {
  email: { url: string; key: string; from: string } | null
  bale: { api: string; token: string; bot: string } | null
  eitaa: { api: string; token: string } | null
  /** Absolute site URL used in message links (setting `site_url`, else the origin of the triggering request). */
  site: string
}

const MAX_ATTEMPTS = 5
const SEND_TIMEOUT_MS = 10_000

function parse(v: string | undefined): any {
  if (v == null) return undefined
  try {
    return JSON.parse(v)
  } catch {
    return undefined
  }
}

export async function channelConfig(db: Db): Promise<ChannelConfig> {
  const rows = await db.all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key LIKE 'notify\\_%' ESCAPE '\\' OR key = 'site_url'")
  const s: Record<string, any> = {}
  for (const r of rows) s[r.key] = parse(r.value)
  const str = (k: string) => (typeof s[k] === 'string' ? s[k].trim() : '')
  return {
    email: str('notify_email_key') && str('notify_email_from') ? { url: str('notify_email_url') || 'https://api.resend.com/emails', key: str('notify_email_key'), from: str('notify_email_from') } : null,
    bale: str('notify_bale_token') ? { api: (str('notify_bale_api') || 'https://tapi.bale.ai').replace(/\/+$/, ''), token: str('notify_bale_token'), bot: str('notify_bale_bot').replace(/^@/, '') } : null,
    eitaa: str('notify_eitaa_token') ? { api: (str('notify_eitaa_api') || 'https://eitaayar.ir/api').replace(/\/+$/, ''), token: str('notify_eitaa_token') } : null,
    site: str('site_url').replace(/\/+$/, '')
  }
}

export function channelOn(cfg: ChannelConfig, ch: Channel): boolean {
  return !!cfg[ch]
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

/** Delivers one message; throws a short (non-personal) error string on failure. */
export async function sendVia(cfg: ChannelConfig, ch: Channel, address: string, title: string, body: string, url?: string | null): Promise<void> {
  const text = [title, body, url].filter(Boolean).join('\n\n')
  const signal = AbortSignal.timeout(SEND_TIMEOUT_MS)
  let res: Response
  if (ch === 'email') {
    const c = cfg.email
    if (!c) throw new Error('channel_off')
    const html = `<div dir="rtl" style="font-family:Tahoma,sans-serif;line-height:1.9"><h3>${escHtml(title)}</h3>${body ? `<p>${escHtml(body)}</p>` : ''}${url ? `<p><a href="${escHtml(url)}">مشاهده در نشریار</a></p>` : ''}</div>`
    res = await fetch(c.url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` }, body: JSON.stringify({ from: c.from, to: [address], subject: title, text, html }) })
  } else if (ch === 'bale') {
    const c = cfg.bale
    if (!c) throw new Error('channel_off')
    res = await fetch(`${c.api}/bot${c.token}/sendMessage`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: address, text }) })
  } else {
    const c = cfg.eitaa
    if (!c) throw new Error('channel_off')
    res = await fetch(`${c.api}/${c.token}/sendMessage`, { method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ chat_id: address, title, text }).toString() })
  }
  if (!res.ok) throw new Error(`http_${res.status}`)
  if (ch !== 'email') {
    const j: any = await res.json().catch(() => ({}))
    if (j && j.ok === false) throw new Error(`api_${String(j.error_code || j.description || 'error').slice(0, 40)}`)
  }
}

// ───────── queue ─────────
let pending = false
/** True once since the last call when notify() queued something (the app schedules a flush after the response). */
export function takeOutboundPending(): boolean {
  const p = pending
  pending = false
  return p
}

export async function enqueueOutbound(db: Db, msg: { userId: string; type: string; title: string; link?: string | null }): Promise<number> {
  try {
    const rows = await db.all<{ channel: Channel; address: string; muted_json: string | null }>(
      'SELECT channel, address, muted_json FROM notify_channels WHERE user_id = ? AND verified_at IS NOT NULL AND address IS NOT NULL',
      [msg.userId]
    )
    if (!rows.length) return 0
    const cat = categoryOf(msg.type)
    const now = new Date().toISOString()
    let n = 0
    for (const r of rows) {
      const muted: string[] = parse(r.muted_json ?? undefined) || []
      if (muted.includes(cat)) continue
      await db.run('INSERT INTO outbound_queue (id, user_id, channel, address, type, title, link, attempts, next_at, created_at) VALUES (?,?,?,?,?,?,?,0,?,?)', [
        newId(),
        msg.userId,
        r.channel,
        r.address,
        msg.type,
        String(msg.title).slice(0, 300),
        msg.link ?? null,
        now,
        now
      ])
      n++
    }
    if (n) pending = true
    return n
  } catch {
    return 0 // before migration 0018 or any DB hiccup: in-app delivery is unaffected
  }
}

let flushing = false
export interface FlushReport { sent: number; failed: number; retry: number }

/** Delivers due queue rows (bounded batch). Safe to call concurrently (single flight per isolate/process). */
export async function flushOutbound(db: Db, origin?: string | null, limit = 25): Promise<FlushReport> {
  const rep: FlushReport = { sent: 0, failed: 0, retry: 0 }
  if (flushing) return rep
  flushing = true
  try {
    const now = new Date().toISOString()
    const rows = await db.all<{ id: string; channel: Channel; address: string; title: string; link: string | null; attempts: number }>(
      'SELECT id, channel, address, title, link, attempts FROM outbound_queue WHERE sent_at IS NULL AND failed_at IS NULL AND next_at <= ? ORDER BY next_at LIMIT ?',
      [now, limit]
    )
    if (!rows.length) return rep
    const cfg = await channelConfig(db)
    const site = cfg.site || (origin || '').replace(/\/+$/, '')
    for (const r of rows) {
      const url = r.link ? (/^https?:\/\//.test(r.link) ? r.link : site ? site + r.link : null) : null
      try {
        if (!channelOn(cfg, r.channel)) throw new Error('channel_off')
        await sendVia(cfg, r.channel, r.address, r.title, '', url)
        await db.run('UPDATE outbound_queue SET sent_at = ?, attempts = attempts + 1, error = NULL WHERE id = ?', [new Date().toISOString(), r.id])
        rep.sent++
      } catch (e: any) {
        const err = String(e?.message || e).slice(0, 120)
        const attempts = r.attempts + 1
        if (attempts >= MAX_ATTEMPTS || err === 'channel_off') {
          await db.run('UPDATE outbound_queue SET attempts = ?, failed_at = ?, error = ? WHERE id = ?', [attempts, new Date().toISOString(), err, r.id])
          rep.failed++
        } else {
          const next = new Date(Date.now() + 2 ** attempts * 60_000).toISOString()
          await db.run('UPDATE outbound_queue SET attempts = ?, next_at = ?, error = ? WHERE id = ?', [attempts, next, err, r.id])
          rep.retry++
        }
      }
    }
    return rep
  } catch {
    return rep
  } finally {
    flushing = false
  }
}

export async function outboundStats(db: Db) {
  try {
    const r = await db.first<{ pending: number; sent: number; failed: number }>(
      `SELECT SUM(CASE WHEN sent_at IS NULL AND failed_at IS NULL THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN sent_at IS NOT NULL THEN 1 ELSE 0 END) AS sent,
              SUM(CASE WHEN failed_at IS NOT NULL THEN 1 ELSE 0 END) AS failed FROM outbound_queue`
    )
    return { pending: r?.pending || 0, sent: r?.sent || 0, failed: r?.failed || 0 }
  } catch {
    return { pending: 0, sent: 0, failed: 0 }
  }
}

/** Maintenance: deliver what is due and drop delivered/failed rows older than 30 days. */
export async function maintainOutbound(db: Db): Promise<FlushReport & { purged: number }> {
  const rep = await flushOutbound(db, null, 200)
  const old = new Date(Date.now() - 30 * 86400_000).toISOString()
  let purged = 0
  try {
    purged = (await db.run('DELETE FROM outbound_queue WHERE (sent_at IS NOT NULL AND sent_at < ?) OR (failed_at IS NOT NULL AND failed_at < ?)', [old, old])).changes
  } catch {}
  return { ...rep, purged }
}

// ───────── verification / linking ─────────
export const codeHash = (ch: Channel, code: string) => sha256(`notify|${ch}|${code.trim().toUpperCase()}`)

/** Bale: `/start <code>` (from the deep link) or the bare code links that chat to the waiting account. */
export async function handleBaleUpdate(db: Db, cfg: ChannelConfig, update: any): Promise<boolean> {
  const m = update?.message
  const chatId = m?.chat?.id
  const text = String(m?.text || '').trim()
  const code = /^\/start\s+([A-Za-z0-9]{6,16})$/.exec(text)?.[1] || /^([A-Za-z0-9]{8})$/.exec(text)?.[1]
  if (chatId == null || !code) return false
  const row = await db.first<{ user_id: string }>("SELECT user_id FROM notify_channels WHERE channel = 'bale' AND code_hash = ? AND code_expires > ?", [await codeHash('bale', code), new Date().toISOString()])
  if (!row) {
    if (cfg.bale) await sendVia(cfg, 'bale', String(chatId), 'کد اتصال نامعتبر یا منقضی است', 'از صفحهٔ تنظیمات نشریار کد تازه بگیرید.').catch(() => {})
    return false
  }
  const now = new Date().toISOString()
  await db.run("UPDATE notify_channels SET address = ?, verified_at = ?, code_hash = NULL, code_expires = NULL, updated_at = ? WHERE user_id = ? AND channel = 'bale'", [String(chatId), now, now, row.user_id])
  if (cfg.bale) await sendVia(cfg, 'bale', String(chatId), 'حساب نشریار شما به این گفت‌وگو متصل شد ✅', 'اعلان‌ها از این پس اینجا هم می‌رسند. برای قطع اتصال به تنظیمات حساب بروید.').catch(() => {})
  return true
}

/** Bale without a webhook: read pending updates (getUpdates) and process the link codes. Returns how many linked. */
export async function pollBale(db: Db, cfg: ChannelConfig): Promise<number> {
  const c = cfg.bale
  if (!c) return 0
  const offRow = await db.first<{ value: string }>("SELECT value FROM settings WHERE key = 'notify_bale_offset'")
  const offset = Number(parse(offRow?.value) || 0)
  const res = await fetch(`${c.api}/bot${c.token}/getUpdates?offset=${offset}&timeout=0`, { signal: AbortSignal.timeout(SEND_TIMEOUT_MS) }).catch(() => null)
  if (!res || !res.ok) return 0
  const j: any = await res.json().catch(() => ({}))
  const updates: any[] = Array.isArray(j?.result) ? j.result : []
  let linked = 0
  let max = offset - 1
  for (const u of updates) {
    if (typeof u?.update_id === 'number') max = Math.max(max, u.update_id)
    if (await handleBaleUpdate(db, cfg, u)) linked++
  }
  if (max + 1 > offset)
    await db.run('INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', [
      'notify_bale_offset',
      JSON.stringify(max + 1),
      new Date().toISOString()
    ])
  return linked
}

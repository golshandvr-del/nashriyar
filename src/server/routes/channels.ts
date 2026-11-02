// Outbound notification channels for the signed-in user (ROADMAP phase 19): connect email / Bale / Eitaa, verify,
// mute categories per channel, send a test, disconnect. Plus the Bale bot webhook (link codes) and a developer status.
import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { checkRateLimit, clearFailures, recordFailure, requireUser } from '../auth'
import { hmac, randomId, timingSafeEqual } from '../lib/crypto'
import { body, HttpError, nowIso } from '../lib/util'
import { CATEGORIES, CHANNEL_LABEL, CHANNELS, channelConfig, channelOn, codeHash, handleBaleUpdate, outboundStats, sendVia } from '../lib/channels'
import type { Channel } from '../lib/channels'

export const channelRoutes = new Hono<AppEnv>()

const CODE_TTL_MS = 15 * 60_000
const EMAIL_RE = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[A-Za-z]{2,24}$/
const EITAA_RE = /^(@?[A-Za-z][A-Za-z0-9_]{2,63}|-?\d{3,20})$/

const isChannel = (v: string): v is Channel => (CHANNELS as readonly string[]).includes(v)
const newCode = () => randomId(8).toUpperCase()

async function webhookSecret(c: any) {
  return (await hmac(c.get('deps').secret, 'notify|bale-webhook')).slice(0, 32)
}

/** Bale bot webhook: `setWebhook` to {site}/api/channels/bale/webhook/<secret> (shown in the developer status). */
channelRoutes.post('/bale/webhook/:secret', async (c) => {
  if (!timingSafeEqual(c.req.param('secret'), await webhookSecret(c))) throw new HttpError(404, 'یافت نشد', 'not_found')
  const db = c.get('db')
  const update = await c.req.json().catch(() => null)
  await handleBaleUpdate(db, await channelConfig(db), update).catch(() => false)
  return c.json({ ok: true })
})

channelRoutes.use('*', async (c, next) => {
  requireUser(c)
  await next()
})

/** Developer view: which channels are configured, queue counters and the Bale webhook path. */
channelRoutes.get('/status', async (c) => {
  const u = requireUser(c)
  if (u.system_role !== 'developer' && u.system_role !== 'super_admin') throw new HttpError(403, 'دسترسی ندارید')
  const db = c.get('db')
  const cfg = await channelConfig(db)
  const linked = await db.all<{ channel: string; n: number }>('SELECT channel, COUNT(*) AS n FROM notify_channels WHERE verified_at IS NOT NULL GROUP BY channel')
  return c.json({
    channels: Object.fromEntries(CHANNELS.map((ch) => [ch, { on: channelOn(cfg, ch), linked: linked.find((l) => l.channel === ch)?.n || 0 }])),
    queue: await outboundStats(db),
    bale_webhook_path: cfg.bale ? `/api/channels/bale/webhook/${await webhookSecret(c)}` : null,
    site_url: cfg.site || null
  })
})

channelRoutes.get('/', async (c) => {
  const u = requireUser(c)
  const db = c.get('db')
  const cfg = await channelConfig(db)
  const rows = await db.all<{ channel: string; address: string | null; verified_at: string | null; code_expires: string | null; muted_json: string | null }>(
    'SELECT channel, address, verified_at, code_expires, muted_json FROM notify_channels WHERE user_id = ?',
    [u.id]
  )
  const now = nowIso()
  return c.json({
    categories: CATEGORIES,
    channels: CHANNELS.map((ch) => {
      const r = rows.find((x) => x.channel === ch)
      let muted: string[] = []
      try {
        muted = JSON.parse(r?.muted_json || '[]')
      } catch {}
      return {
        channel: ch,
        label: CHANNEL_LABEL[ch],
        available: channelOn(cfg, ch),
        address: r?.address ? (ch === 'email' ? r.address : r.address) : null,
        verified: !!r?.verified_at,
        verified_at: r?.verified_at || null,
        pending: !!(r && !r.verified_at && r.code_expires && r.code_expires > now),
        muted,
        bot: ch === 'bale' ? cfg.bale?.bot || null : undefined
      }
    })
  })
})

async function upsertPending(c: any, userId: string, ch: Channel, address: string | null, code: string) {
  const now = nowIso()
  await c.get('db').run(
    `INSERT INTO notify_channels (user_id, channel, address, verified_at, code_hash, code_expires, muted_json, created_at, updated_at)
     VALUES (?,?,?,NULL,?,?,NULL,?,?)
     ON CONFLICT(user_id, channel) DO UPDATE SET address = excluded.address, verified_at = NULL, code_hash = excluded.code_hash,
       code_expires = excluded.code_expires, updated_at = excluded.updated_at`,
    [userId, ch, address, await codeHash(ch, code), new Date(Date.now() + CODE_TTL_MS).toISOString(), now, now]
  )
}

/** Email / Eitaa: store the address unverified and send a confirmation code there. Bale: create a link code. */
channelRoutes.post('/:ch/connect', async (c) => {
  const u = requireUser(c)
  const ch = c.req.param('ch')
  if (!isChannel(ch)) throw new HttpError(404, 'کانال نامعتبر', 'not_found')
  const db = c.get('db')
  const cfg = await channelConfig(db)
  if (!channelOn(cfg, ch)) throw new HttpError(400, `کانال ${CHANNEL_LABEL[ch]} هنوز توسط مدیر سامانه راه‌اندازی نشده است`, 'channel_off')
  const rk = `notify-send:${u.id}`
  await checkRateLimit(c, rk)
  await recordFailure(c, rk) // counts sends, so a user cannot flood an address (8 per 15 minutes)
  const code = newCode()
  if (ch === 'bale') {
    await upsertPending(c, u.id, 'bale', null, code)
    const bot = cfg.bale?.bot || ''
    return c.json({ ok: true, code, link: bot ? `https://ble.ir/${bot}?start=${code}` : null, expires_in: CODE_TTL_MS / 1000 })
  }
  const b = await body<{ address?: string }>(c)
  let address = String(b.address || '').trim()
  if (ch === 'email') {
    address = address.toLowerCase()
    if (!EMAIL_RE.test(address)) throw new HttpError(400, 'نشانی ایمیل معتبر نیست', 'validation')
  } else if (!EITAA_RE.test(address)) throw new HttpError(400, 'شناسهٔ ایتا معتبر نیست (نام کاربری یا شناسهٔ عددی)', 'validation')
  await upsertPending(c, u.id, ch, address, code)
  try {
    await sendVia(cfg, ch, address, `کد تأیید نشریار: ${code}`, 'این کد را در صفحهٔ تنظیمات حساب وارد کنید. اگر شما درخواست نداده‌اید، این پیام را نادیده بگیرید.')
  } catch {
    throw new HttpError(502, 'ارسال کد ممکن نشد؛ نشانی را بررسی کنید یا کمی بعد دوباره تلاش کنید', 'send_failed')
  }
  return c.json({ ok: true, expires_in: CODE_TTL_MS / 1000 })
})

channelRoutes.post('/:ch/verify', async (c) => {
  const u = requireUser(c)
  const ch = c.req.param('ch')
  if (!isChannel(ch) || ch === 'bale') throw new HttpError(404, 'کانال نامعتبر', 'not_found')
  const rk = `notify-verify:${u.id}`
  await checkRateLimit(c, rk)
  const b = await body<{ code?: string }>(c)
  const code = String(b.code || '').trim()
  const db = c.get('db')
  const row = await db.first<{ code_hash: string | null; code_expires: string | null }>('SELECT code_hash, code_expires FROM notify_channels WHERE user_id = ? AND channel = ?', [u.id, ch])
  const okCode = !!row?.code_hash && !!row.code_expires && row.code_expires > nowIso() && code.length > 0 && timingSafeEqual(row.code_hash, await codeHash(ch, code))
  if (!okCode) {
    await recordFailure(c, rk)
    throw new HttpError(400, 'کد نادرست یا منقضی است', 'bad_code')
  }
  await clearFailures(c, rk)
  const now = nowIso()
  await db.run('UPDATE notify_channels SET verified_at = ?, code_hash = NULL, code_expires = NULL, updated_at = ? WHERE user_id = ? AND channel = ?', [now, now, u.id, ch])
  return c.json({ ok: true })
})

channelRoutes.post('/:ch/mute', async (c) => {
  const u = requireUser(c)
  const ch = c.req.param('ch')
  if (!isChannel(ch)) throw new HttpError(404, 'کانال نامعتبر', 'not_found')
  const b = await body<{ muted?: unknown }>(c)
  const muted = (Array.isArray(b.muted) ? b.muted : []).map(String).filter((k) => Object.prototype.hasOwnProperty.call(CATEGORIES, k))
  const r = await c.get('db').run('UPDATE notify_channels SET muted_json = ?, updated_at = ? WHERE user_id = ? AND channel = ?', [JSON.stringify([...new Set(muted)]), nowIso(), u.id, ch])
  if (!r.changes) throw new HttpError(404, 'این کانال هنوز متصل نشده است', 'not_found')
  return c.json({ ok: true, muted })
})

channelRoutes.post('/:ch/test', async (c) => {
  const u = requireUser(c)
  const ch = c.req.param('ch')
  if (!isChannel(ch)) throw new HttpError(404, 'کانال نامعتبر', 'not_found')
  const rk = `notify-send:${u.id}`
  await checkRateLimit(c, rk)
  await recordFailure(c, rk)
  const db = c.get('db')
  const row = await db.first<{ address: string | null; verified_at: string | null }>('SELECT address, verified_at FROM notify_channels WHERE user_id = ? AND channel = ?', [u.id, ch])
  if (!row?.verified_at || !row.address) throw new HttpError(400, 'این کانال هنوز تأیید نشده است', 'not_verified')
  try {
    await sendVia(await channelConfig(db), ch, row.address, 'پیام آزمایشی نشریار', 'اعلان‌های شما از این کانال هم می‌رسد.')
  } catch {
    throw new HttpError(502, 'ارسال پیام آزمایشی ممکن نشد', 'send_failed')
  }
  return c.json({ ok: true })
})

channelRoutes.delete('/:ch', async (c) => {
  const u = requireUser(c)
  const ch = c.req.param('ch')
  if (!isChannel(ch)) throw new HttpError(404, 'کانال نامعتبر', 'not_found')
  const db = c.get('db')
  await db.run('DELETE FROM notify_channels WHERE user_id = ? AND channel = ?', [u.id, ch])
  // drop undelivered messages for that channel
  await db.run('DELETE FROM outbound_queue WHERE user_id = ? AND channel = ? AND sent_at IS NULL', [u.id, ch])
  return c.json({ ok: true })
})

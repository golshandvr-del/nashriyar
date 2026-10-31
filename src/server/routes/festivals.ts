// Publications festival (ROADMAP phase 14, proposed module): call for entries → judging with a score form → results.
// Lifecycle: draft → open (teams submit published issues until submit_until) → judging (assigned judges score each
// entry against the festival criteria) → announced (ranked results become public).
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../context'
import { ADMIN_ROLES, MONITOR_ROLES } from '../context'
import { requirePubAccess, requireRole, requireUser } from '../auth'
import { newId } from '../lib/crypto'
import { audit, bad, body, forbidden, inList, notFound, notify, nowIso, oneOf, parseJson, str } from '../lib/util'

export const festivalRoutes = new Hono<AppEnv>()

const STATUS = ['draft', 'open', 'judging', 'announced'] as const
type Criterion = { key: string; label: string; max: number }
export const DEFAULT_CRITERIA: Criterion[] = [
  { key: 'content', label: 'محتوا و عمق مطالب', max: 10 },
  { key: 'writing', label: 'نگارش و ویرایش', max: 10 },
  { key: 'design', label: 'طراحی و صفحه‌آرایی', max: 10 },
  { key: 'creativity', label: 'خلاقیت و نوآوری', max: 10 }
]

const admin = (c: Context<AppEnv>) => requireRole(c, ADMIN_ROLES)

function parseCriteria(v: unknown): Criterion[] {
  if (v == null) return DEFAULT_CRITERIA
  if (!Array.isArray(v) || !v.length || v.length > 12) throw bad('معیارهای داوری نامعتبر است')
  const seen = new Set<string>()
  return v.map((x: any, i) => {
    const label = str(x?.label, 'عنوان معیار', { max: 60 })
    const max = Number(x?.max)
    if (!Number.isInteger(max) || max < 1 || max > 100) throw bad('بیشینهٔ امتیاز هر معیار باید بین ۱ تا ۱۰۰ باشد')
    let key = typeof x?.key === 'string' && /^[a-z0-9_]{1,24}$/.test(x.key) ? x.key : `c${i + 1}`
    while (seen.has(key)) key += '_'
    seen.add(key)
    return { key, label, max }
  })
}

function dateOpt(v: unknown): string | null {
  const s = str(v, 'مهلت ارسال', { max: 10, optional: true })
  if (!s) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw bad('مهلت ارسال نامعتبر است')
  return s
}

async function loadFestival(c: Context<AppEnv>, id: string) {
  const f = await c.get('db').first<any>('SELECT * FROM festivals WHERE id = ?', [id])
  if (!f) throw notFound('جشنواره یافت نشد')
  return { ...f, criteria: parseJson<Criterion[]>(f.criteria_json, DEFAULT_CRITERIA) }
}

/** Entries with publication/issue labels and the average judge total (ranked). */
async function rankedEntries(c: Context<AppEnv>, festivalId: string) {
  const db = c.get('db')
  const rows = await db.all<any>(
    `SELECT e.id, e.publication_id, e.issue_id, e.note, e.created_at,
            p.title AS publication_title, p.slug AS publication_slug, i.title AS issue_title, i.number AS issue_number,
            (SELECT AVG(s.total) FROM festival_scores s WHERE s.entry_id = e.id) AS avg_total,
            (SELECT COUNT(*) FROM festival_scores s WHERE s.entry_id = e.id) AS score_count
     FROM festival_entries e
     JOIN publications p ON p.id = e.publication_id
     JOIN issues i ON i.id = e.issue_id
     WHERE e.festival_id = ?
     ORDER BY e.created_at`,
    [festivalId]
  )
  const sorted = [...rows].sort((a, b) => (b.avg_total ?? -1) - (a.avg_total ?? -1))
  let rank = 0
  let prev: number | null = null
  sorted.forEach((r, i) => {
    const t = r.avg_total == null ? null : Math.round(r.avg_total * 100) / 100
    if (t !== prev) rank = i + 1
    prev = t
    r.avg_total = t
    r.rank = t == null ? null : rank
  })
  return sorted
}

// ───────── Admin: manage festivals ─────────
festivalRoutes.get('/', async (c) => {
  requireRole(c, MONITOR_ROLES)
  const rows = await c.get('db').all<any>(
    `SELECT f.*, (SELECT COUNT(*) FROM festival_entries e WHERE e.festival_id = f.id) AS entry_count,
            (SELECT COUNT(*) FROM festival_judges j WHERE j.festival_id = f.id) AS judge_count
     FROM festivals f ORDER BY f.created_at DESC`
  )
  return c.json({ festivals: rows.map((f) => ({ ...f, criteria: parseJson(f.criteria_json, DEFAULT_CRITERIA), criteria_json: undefined })) })
})

festivalRoutes.post('/', async (c) => {
  const u = admin(c)
  const b = await body(c)
  const id = newId()
  const criteria = parseCriteria(b.criteria)
  await c.get('db').run(
    'INSERT INTO festivals (id, title, description, status, submit_until, criteria_json, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [id, str(b.title, 'عنوان', { max: 120 }), str(b.description, 'توضیح', { max: 2000, optional: true }) || null, 'draft', dateOpt(b.submit_until), JSON.stringify(criteria), u.id, nowIso()]
  )
  await audit(c.get('db'), u.id, 'festival.create', 'festival', id)
  return c.json({ ok: true, id })
})

// ───────── Public: announced results (before /:id so the literal path wins) ─────────
festivalRoutes.get('/public/results', async (c) => {
  const fests = await c.get('db').all<any>(
    "SELECT id, title, description, announced_at, criteria_json FROM festivals WHERE status = 'announced' ORDER BY announced_at DESC LIMIT 10"
  )
  const out = []
  for (const f of fests) {
    const entries = (await rankedEntries(c, f.id)).filter((e) => e.rank != null && e.rank <= 10)
    out.push({
      id: f.id,
      title: f.title,
      description: f.description,
      announced_at: f.announced_at,
      results: entries.map((e) => ({ rank: e.rank, avg_total: e.avg_total, publication_title: e.publication_title, publication_slug: e.publication_slug, issue_title: e.issue_title, issue_number: e.issue_number }))
    })
  }
  return c.json({ festivals: out })
})

// ───────── Team: open calls and own entries ─────────
festivalRoutes.get('/team/:pubId', async (c) => {
  const pubId = c.req.param('pubId')
  await requirePubAccess(c, pubId)
  const db = c.get('db')
  const fests = await db.all<any>("SELECT id, title, description, status, submit_until, criteria_json FROM festivals WHERE status != 'draft' ORDER BY created_at DESC LIMIT 20")
  const entries = await db.all<any>(
    `SELECT e.id, e.festival_id, e.issue_id, e.note, i.title AS issue_title, i.number AS issue_number
     FROM festival_entries e JOIN issues i ON i.id = e.issue_id WHERE e.publication_id = ?`,
    [pubId]
  )
  const issues = await db.all<any>(
    "SELECT id, title, number FROM issues WHERE publication_id = ? AND status = 'published' AND deleted_at IS NULL ORDER BY number DESC",
    [pubId]
  )
  const results: Record<string, any[]> = {}
  for (const f of fests.filter((x) => x.status === 'announced')) {
    results[f.id] = (await rankedEntries(c, f.id)).filter((e) => e.publication_id === pubId).map((e) => ({ entry_id: e.id, rank: e.rank, avg_total: e.avg_total }))
  }
  return c.json({
    festivals: fests.map((f) => ({ ...f, criteria: parseJson(f.criteria_json, DEFAULT_CRITERIA), criteria_json: undefined, accepting: acceptsEntries(f) })),
    entries,
    issues,
    results
  })
})

function acceptsEntries(f: { status: string; submit_until: string | null }) {
  return f.status === 'open' && (!f.submit_until || nowIso().slice(0, 10) <= f.submit_until)
}

festivalRoutes.post('/:id/entries', async (c) => {
  const b = await body(c)
  const pubId = str(b.publication_id, 'نشریه', { max: 40 })
  const { user } = await requirePubAccess(c, pubId, { write: true })
  const f = await loadFestival(c, c.req.param('id'))
  if (!acceptsEntries(f)) throw bad('مهلت ارسال اثر به این جشنواره به پایان رسیده یا فراخوان باز نیست')
  const db = c.get('db')
  const issue = await db.first<any>("SELECT id FROM issues WHERE id = ? AND publication_id = ? AND status = 'published' AND deleted_at IS NULL", [str(b.issue_id, 'شماره', { max: 40 }), pubId])
  if (!issue) throw bad('فقط شماره‌های منتشرشدهٔ همین نشریه قابل ارسال است')
  const dup = await db.first('SELECT id FROM festival_entries WHERE festival_id = ? AND issue_id = ?', [f.id, issue.id])
  if (dup) throw bad('این شماره قبلاً به جشنواره ارسال شده است')
  const count = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM festival_entries WHERE festival_id = ? AND publication_id = ?', [f.id, pubId])
  if ((count?.n ?? 0) >= 3) throw bad('هر نشریه حداکثر ۳ اثر می‌تواند ارسال کند')
  const id = newId()
  await db.run('INSERT INTO festival_entries (id, festival_id, publication_id, issue_id, note, submitted_by, created_at) VALUES (?,?,?,?,?,?,?)', [
    id, f.id, pubId, issue.id, str(b.note, 'توضیح', { max: 500, optional: true }) || null, user.id, nowIso()
  ])
  await audit(db, user.id, 'festival.entry.submit', 'festival', f.id, null, { entry: id, issue: issue.id })
  return c.json({ ok: true, id })
})

festivalRoutes.delete('/:id/entries/:entryId', async (c) => {
  const db = c.get('db')
  const e = await db.first<any>('SELECT * FROM festival_entries WHERE id = ? AND festival_id = ?', [c.req.param('entryId'), c.req.param('id')])
  if (!e) throw notFound('اثر یافت نشد')
  const { user } = await requirePubAccess(c, e.publication_id, { write: true })
  const f = await loadFestival(c, e.festival_id)
  if (!acceptsEntries(f)) throw bad('پس از پایان مهلت ارسال، اثر قابل پس‌گرفتن نیست')
  await db.run('DELETE FROM festival_entries WHERE id = ?', [e.id])
  await audit(db, user.id, 'festival.entry.withdraw', 'festival', f.id, { entry: e.id }, null)
  return c.json({ ok: true })
})

// ───────── Judges: score form ─────────
festivalRoutes.get('/judging/mine', async (c) => {
  const u = requireUser(c)
  const db = c.get('db')
  const fests = await db.all<any>(
    `SELECT f.id, f.title, f.description, f.status, f.criteria_json FROM festivals f
     JOIN festival_judges j ON j.festival_id = f.id WHERE j.user_id = ? AND f.status IN ('judging','announced') ORDER BY f.created_at DESC`,
    [u.id]
  )
  const out = []
  for (const f of fests) {
    const entries = await db.all<any>(
      `SELECT e.id, e.note, p.title AS publication_title, i.title AS issue_title, i.number AS issue_number, i.id AS issue_id, p.slug AS publication_slug,
              s.scores_json, s.total, s.comment
       FROM festival_entries e JOIN publications p ON p.id = e.publication_id JOIN issues i ON i.id = e.issue_id
       LEFT JOIN festival_scores s ON s.entry_id = e.id AND s.judge_id = ?
       WHERE e.festival_id = ? ORDER BY p.title`,
      [u.id, f.id]
    )
    out.push({
      ...f,
      criteria: parseJson(f.criteria_json, DEFAULT_CRITERIA),
      criteria_json: undefined,
      entries: entries.map((e) => ({ ...e, scores: parseJson(e.scores_json, null), scores_json: undefined }))
    })
  }
  return c.json({ festivals: out })
})

festivalRoutes.put('/:id/entries/:entryId/score', async (c) => {
  const u = requireUser(c)
  const db = c.get('db')
  const f = await loadFestival(c, c.req.param('id'))
  const judge = await db.first('SELECT 1 AS ok FROM festival_judges WHERE festival_id = ? AND user_id = ?', [f.id, u.id])
  if (!judge) throw forbidden('شما داور این جشنواره نیستید')
  if (f.status !== 'judging') throw bad('داوری این جشنواره باز نیست')
  const entry = await db.first('SELECT id FROM festival_entries WHERE id = ? AND festival_id = ?', [c.req.param('entryId'), f.id])
  if (!entry) throw notFound('اثر یافت نشد')
  const b = await body(c)
  const scores: Record<string, number> = {}
  let total = 0
  for (const cr of f.criteria) {
    const v = Number(b.scores?.[cr.key])
    if (!Number.isFinite(v) || v < 0 || v > cr.max) throw bad(`امتیاز «${cr.label}» باید بین ۰ تا ${cr.max} باشد`)
    scores[cr.key] = Math.round(v * 10) / 10
    total += scores[cr.key]
  }
  await db.run('DELETE FROM festival_scores WHERE entry_id = ? AND judge_id = ?', [c.req.param('entryId'), u.id])
  await db.run('INSERT INTO festival_scores (entry_id, judge_id, scores_json, total, comment, updated_at) VALUES (?,?,?,?,?,?)', [
    c.req.param('entryId'), u.id, JSON.stringify(scores), Math.round(total * 10) / 10, str(b.comment, 'نظر داور', { max: 1000, optional: true }) || null, nowIso()
  ])
  return c.json({ ok: true, total: Math.round(total * 10) / 10 })
})

// ───────── Admin: festival detail, update, judges ─────────
festivalRoutes.get('/:id', async (c) => {
  requireRole(c, MONITOR_ROLES)
  const f = await loadFestival(c, c.req.param('id'))
  const db = c.get('db')
  const judges = await db.all<any>(
    `SELECT u.id, u.display_name, u.username,
            (SELECT COUNT(*) FROM festival_scores s JOIN festival_entries e ON e.id = s.entry_id WHERE s.judge_id = u.id AND e.festival_id = ?) AS scored
     FROM festival_judges j JOIN users u ON u.id = j.user_id WHERE j.festival_id = ? ORDER BY u.display_name`,
    [f.id, f.id]
  )
  return c.json({ festival: { ...f, criteria_json: undefined }, judges, entries: await rankedEntries(c, f.id) })
})

festivalRoutes.patch('/:id', async (c) => {
  const u = admin(c)
  const db = c.get('db')
  const f = await loadFestival(c, c.req.param('id'))
  const b = await body(c)
  const status = b.status == null ? f.status : oneOf(b.status, STATUS, 'وضعیت')
  const order = STATUS.indexOf(status) - STATUS.indexOf(f.status)
  if (order < 0) throw bad('بازگشت به مرحلهٔ قبلی جشنواره مجاز نیست')
  if (order > 1) throw bad('مراحل جشنواره باید به ترتیب طی شود')
  if (status === 'judging' && f.status === 'open') {
    const j = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM festival_judges WHERE festival_id = ?', [f.id])
    if (!j?.n) throw bad('پیش از شروع داوری دست‌کم یک داور تعیین کنید')
  }
  const criteria = b.criteria !== undefined ? (f.status === 'draft' || f.status === 'open' ? parseCriteria(b.criteria) : (() => { throw bad('پس از شروع داوری، معیارها قابل تغییر نیست') })()) : f.criteria
  await db.run('UPDATE festivals SET title = ?, description = ?, submit_until = ?, criteria_json = ?, status = ?, announced_at = ? WHERE id = ?', [
    b.title !== undefined ? str(b.title, 'عنوان', { max: 120 }) : f.title,
    b.description !== undefined ? str(b.description, 'توضیح', { max: 2000, optional: true }) || null : f.description,
    b.submit_until !== undefined ? dateOpt(b.submit_until) : f.submit_until,
    JSON.stringify(criteria),
    status,
    status === 'announced' && f.status !== 'announced' ? nowIso() : f.announced_at,
    f.id
  ])
  if (status !== f.status) {
    await audit(db, u.id, 'festival.status', 'festival', f.id, { status: f.status }, { status })
    if (status === 'judging') {
      const js = await db.all<{ user_id: string }>('SELECT user_id FROM festival_judges WHERE festival_id = ?', [f.id])
      for (const j of js) await notify(db, j.user_id, 'festival.judging', `داوری جشنوارهٔ «${f.title}» آغاز شد`, '/judging')
    }
    if (status === 'open' || status === 'announced') {
      const leads = await db.all<{ user_id: string }>(
        `SELECT DISTINCT r.user_id FROM publication_roles r JOIN publications p ON p.id = r.publication_id
         WHERE r.ended_at IS NULL AND r.role IN ('managing_director','editor_in_chief') AND p.status = 'active' AND p.deleted_at IS NULL`
      )
      const msg = status === 'open' ? `فراخوان جشنوارهٔ «${f.title}» منتشر شد` : `نتایج جشنوارهٔ «${f.title}» اعلام شد`
      for (const l of leads) await notify(db, l.user_id, 'festival.' + status, msg, '/festivals')
    }
  } else await audit(db, u.id, 'festival.update', 'festival', f.id)
  return c.json({ ok: true })
})

festivalRoutes.delete('/:id', async (c) => {
  const u = admin(c)
  const f = await loadFestival(c, c.req.param('id'))
  if (f.status !== 'draft') throw bad('فقط جشنوارهٔ پیش‌نویس قابل حذف است')
  await c.get('db').batch([
    { sql: 'DELETE FROM festival_judges WHERE festival_id = ?', params: [f.id] },
    { sql: 'DELETE FROM festivals WHERE id = ?', params: [f.id] }
  ])
  await audit(c.get('db'), u.id, 'festival.delete', 'festival', f.id, { title: f.title }, null)
  return c.json({ ok: true })
})

festivalRoutes.put('/:id/judges', async (c) => {
  const u = admin(c)
  const f = await loadFestival(c, c.req.param('id'))
  if (f.status === 'announced') throw bad('پس از اعلام نتایج، داوران قابل تغییر نیستند')
  const b = await body(c)
  const ids: string[] = Array.isArray(b.user_ids) ? [...new Set(b.user_ids.filter((x: unknown) => typeof x === 'string'))].slice(0, 30) as string[] : []
  const db = c.get('db')
  const found = ids.length ? await db.all<{ id: string }>(`SELECT id FROM users WHERE status = 'active' AND id IN (${inList(ids)})`, ids) : []
  if (found.length !== ids.length) throw bad('برخی از داوران انتخاب‌شده یافت نشدند')
  await db.batch([
    { sql: 'DELETE FROM festival_judges WHERE festival_id = ?', params: [f.id] },
    ...ids.map((id) => ({ sql: 'INSERT INTO festival_judges (festival_id, user_id) VALUES (?,?)', params: [f.id, id] }))
  ])
  await audit(db, u.id, 'festival.judges', 'festival', f.id, null, { judges: ids })
  return c.json({ ok: true, count: ids.length })
})

// Team service layer (ROADMAP phase 17 — route files split into domain modules + service layer).
// Shared constants and access helpers for every /api/team/:pubId/* domain module: `pub` enforces that the user holds
// one of the three main roles of THIS publication (docs/ROLES.md); follower data is never returned from team modules.
import type { Context } from 'hono'
import type { AppEnv } from '../../context'
import { requirePubAccess } from '../../auth'
import { bad, notFound, nowIso } from '../../lib/util'
import { normalizeFa } from '../../../shared/fa'

export const DEFAULT_STAGES = [
  { key: 'writing', title: 'نویسندگی' },
  { key: 'editing', title: 'ویراستاری' },
  { key: 'graphics', title: 'گرافیک و تصویرسازی' },
  { key: 'layout', title: 'صفحه‌آرایی' },
  { key: 'review', title: 'بازبینی نهایی' },
  { key: 'publish', title: 'انتشار' }
]
export const STAGE_STATUS = ['pending', 'in_progress', 'done', 'skipped'] as const
export const TOC_STATUS = ['todo', 'writing', 'written', 'editing', 'edited', 'done'] as const
export const EDITABLE_ISSUE = ['planning', 'in_production', 'changes_requested']

export async function pub(c: Context<AppEnv>, write = false) {
  const id = c.req.param('pubId')!
  const access = await requirePubAccess(c, id, { write })
  const p = await c.get('db').first<any>('SELECT * FROM publications WHERE id = ? AND deleted_at IS NULL', [id])
  if (!p) throw notFound('نشریه یافت نشد')
  return { ...access, pub: p }
}

export async function issueOf(c: Context<AppEnv>, pubId: string, issueId: string) {
  const i = await c.get('db').first<any>('SELECT * FROM issues WHERE id = ? AND publication_id = ? AND deleted_at IS NULL', [issueId, pubId])
  if (!i) throw notFound('شماره یافت نشد')
  return i
}

export function assertEditable(i: any) {
  if (!EDITABLE_ISSUE.includes(i.status)) throw bad('این شماره در انتظار تأیید یا منتشرشده است و قابل ویرایش ساختاری نیست')
}

export async function refreshIssueSearch(c: Context<AppEnv>, issueId: string) {
  const db = c.get('db')
  const i = await db.first<any>('SELECT i.title, i.summary, i.keywords, i.number, p.title AS pt FROM issues i JOIN publications p ON p.id = i.publication_id WHERE i.id = ?', [issueId])
  if (!i) return
  await db.run('UPDATE issues SET search_text = ?, updated_at = ? WHERE id = ?', [normalizeFa([i.title, i.summary, i.keywords, i.pt, 'شماره ' + i.number].join(' ')), nowIso(), issueId])
}

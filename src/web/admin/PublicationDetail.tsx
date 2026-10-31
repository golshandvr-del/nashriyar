import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { KeyRound, Pencil, UserRoundCog } from 'lucide-react'
import { api, mediaUrl } from '../lib/api'
import { FREQUENCY, ISSUE_STATUS, PUB_STATUS, faDate, faMonthLabel, formatNumber, relativeFa, toFaDigits } from '../lib/format'
import { Async, Avatar, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Progress, Select, Tabs, Textarea, useAction, useAsync, useToast } from '../components/ui'
import { Chart } from '../components/Chart'
import { CredentialsSheet } from './PublicationNew'
import type { Credential } from './PublicationNew'
import { useAdminRole } from './Layout'
import { LicenseTab, SalesTab, StatsTab, licenseState } from './PublicationTabs'

import { PUB_ROLES } from '../../shared/roles'

const ROLE_FA: Record<string, string> = Object.fromEntries(PUB_ROLES.map((r) => [r.key, r.label]))
type Tab = 'summary' | 'issues' | 'roles' | 'members' | 'license' | 'stats' | 'sales' | 'followers' | 'activity'
const TAB_KEYS: Tab[] = ['summary', 'issues', 'roles', 'members', 'license', 'stats', 'sales', 'followers', 'activity']

export default function AdminPublicationDetail() {
  const { id = '' } = useParams()
  const { admin } = useAdminRole()
  const st = useAsync(() => api.get(`/api/admin/publications/${id}`), [id])
  // ROADMAP phase 14: the tab lives in the URL so «کارهای امروز» can deep-link (e.g. ?tab=license)
  const [sp, setSp] = useSearchParams()
  const tab: Tab = TAB_KEYS.includes(sp.get('tab') as Tab) ? (sp.get('tab') as Tab) : 'summary'
  const setTab = (t: Tab) => setSp((prev) => { const n = new URLSearchParams(prev); if (t === 'summary') n.delete('tab'); else n.set('tab', t); return n }, { replace: true })
  const [editing, setEditing] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)

  return (
    <Async state={st}>
      {(d: any) => {
        const p = d.publication
        return (
          <div className="space-y-4">
            <PageHeader
              back={<Link to="/admin/publications" className="text-sm text-muted">← نشریات</Link>}
              title={
                <span className="flex items-center gap-2">
                  <Avatar src={mediaUrl(p.logo_key)} name={p.title} size={36} color={p.theme_color} />
                  {p.title}
                  <Badge tone={p.status === 'active' ? 'ok' : p.status === 'suspended' ? 'danger' : 'muted'}>{PUB_STATUS[p.status]}</Badge>
                </span>
              }
              subtitle={p.tagline}
              actions={
                <div className="flex flex-wrap gap-2">
                  <Link to={`/p/${p.slug}`} className="btn-ghost">صفحهٔ عمومی</Link>
                  <Link to={`/admin/publications/${p.id}/scorecard`} className="btn-ghost">کارنامهٔ قابل چاپ</Link>
                  {admin && <Button variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>ویرایش</Button>}
                  {admin && <Button variant="ghost" onClick={() => setStatusOpen(true)}>تغییر وضعیت</Button>}
                </div>
              }
            />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Info label="دورهٔ انتشار" value={FREQUENCY[p.frequency] || p.frequency} />
              <Info label="شمارهٔ مجوز" value={p.license_number ? toFaDigits(p.license_number) : '—'} />
              <Info label="انقضای مجوز" value={faDate(p.license_expires_at)} danger={!!p.license_expires_at && new Date(p.license_expires_at) < new Date()} />
              <Info label="دنبال‌کننده" value={formatNumber(d.followers)} />
            </div>
            <Tabs<Tab>
              value={tab}
              onChange={setTab}
              tabs={[
                { key: 'summary', label: 'نمای کلی' },
                { key: 'issues', label: `شماره‌ها (${toFaDigits(d.issues.length)})` },
                { key: 'roles', label: 'ارکان' },
                { key: 'members', label: `تیم (${toFaDigits(d.members.length)})` },
                { key: 'license', label: licenseState(p).key === 'expired' || licenseState(p).key === 'expiring' ? 'مجوز ⚠' : 'مجوز' },
                { key: 'stats', label: 'آمار' },
                { key: 'sales', label: 'فروش' },
                ...(admin ? [{ key: 'followers' as Tab, label: 'دنبال‌کنندگان' }] : []),
                { key: 'activity', label: 'سابقه' }
              ]}
            />
            {tab === 'summary' && <SummaryTab d={d} />}
            {tab === 'issues' && <IssuesTab issues={d.issues} stages={d.stages} />}
            {tab === 'roles' && <RolesTab pubId={p.id} roles={d.roles} admin={admin} onChange={st.reload} />}
            {tab === 'members' && <MembersTab members={d.members} />}
            {tab === 'license' && <LicenseTab p={p} roles={d.roles} admin={admin} onEdit={() => setEditing(true)} />}
            {tab === 'stats' && <StatsTab pubId={p.id} />}
            {tab === 'sales' && <SalesTab pubId={p.id} />}
            {tab === 'followers' && <FollowersTab pubId={p.id} />}
            {tab === 'activity' && (
              <Card>
                {!d.activity.length ? (
                  <Empty title="فعالیتی ثبت نشده" />
                ) : (
                  <ol className="space-y-2 text-sm">
                    {d.activity.map((a: any, i: number) => (
                      <li key={i} className="flex justify-between gap-2 border-b border-line pb-2 last:border-0">
                        <span>
                          <span className="font-mono text-xs text-muted" dir="ltr">{a.type}</span>
                          {a.issue_number ? ` · شمارهٔ ${toFaDigits(a.issue_number)}` : ''} {a.actor_name ? ` · ${a.actor_name}` : ''}
                        </span>
                        <span className="shrink-0 text-xs text-muted">{relativeFa(a.created_at)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            )}
            {editing && <EditModal pub={p} categories={d.categories} onClose={() => setEditing(false)} onDone={() => (setEditing(false), st.reload())} />}
            {statusOpen && <StatusModal pub={p} onClose={() => setStatusOpen(false)} onDone={() => (setStatusOpen(false), st.reload())} />}
          </div>
        )
      }}
    </Async>
  )
}

/** Dossier summary (ROADMAP phase 7): issues, sales, explore and the audit trail at a glance. */
function SummaryTab({ d }: { d: any }) {
  const published = d.issues.filter((i: any) => i.status === 'published' || i.status === 'archived')
  const pages = published.reduce((a: number, i: any) => a + Number(i.page_count || 0), 0)
  const director = d.roles.find((r: any) => r.role === 'managing_director' && !r.ended_at)
  const s = d.sales || {}
  const e = d.explore || {}
  const toman = (n: unknown) => `${formatNumber(Number(n || 0))} تومان`
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Info label="شمارهٔ منتشرشده" value={formatNumber(published.length)} />
        <Info label="مجموع صفحات" value={formatNumber(pages)} />
        <Info label="اعضای فعال" value={formatNumber(d.members.filter((m: any) => m.is_active).length)} />
        <Info label="مدیرمسئول فعلی" value={director?.display_name || '—'} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="فروش (کل دوره)">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted">کد ساخته/استفاده‌شده</dt><dd>{formatNumber(Number(s.codes_created || 0))} / {formatNumber(Number(s.codes_redeemed || 0))}</dd>
            <dt className="text-muted">درآمد دیجیتال</dt><dd>{toman(s.revenue_digital)}</dd>
            <dt className="text-muted">فروش چاپی</dt><dd>{formatNumber(Number(s.print_sold || 0))} نسخه</dd>
            <dt className="text-muted">درآمد اعلامی چاپی</dt><dd>{toman(s.revenue_print)}</dd>
          </dl>
        </Card>
        <Card title="اکسپلور">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted">پست منتشرشده</dt><dd>{formatNumber(Number(e.posts || 0))}</dd>
            <dt className="text-muted">بازدید پست (۹۰ روز)</dt><dd>{formatNumber(Number(e.post_views_90d || 0))}</dd>
            <dt className="text-muted">«خواندن کامل» (۹۰ روز)</dt><dd>{formatNumber(Number(e.read_full_90d || 0))}</dd>
            <dt className="text-muted">ذخیره / نظر تأییدشده</dt><dd>{formatNumber(Number(e.saves || 0))} / {formatNumber(Number(e.comments || 0))}</dd>
          </dl>
        </Card>
      </div>
      <Card title="ممیزی (آخرین ۵۰ رویداد)">
        {!d.audit?.length ? (
          <Empty title="رویدادی ثبت نشده" />
        ) : (
          <ol className="space-y-2 text-sm">
            {d.audit.map((a: any, i: number) => (
              <li key={i} className="flex justify-between gap-2 border-b border-line pb-2 last:border-0">
                <span>
                  <span className="font-mono text-xs text-muted" dir="ltr">{a.action}</span>
                  {a.actor_name ? ` · ${a.actor_name}` : ''}
                </span>
                <span className="shrink-0 text-xs text-muted">{relativeFa(a.created_at)}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  )
}

function Info({ label, value, danger }: { label: string; value: React.ReactNode; danger?: boolean }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={danger ? 'font-bold text-danger' : 'font-bold'}>{value}</div>
    </div>
  )
}

/** Time-based stage Gantt for one issue: each bar spans started_at → completed_at (or now); a tick marks the deadline. */
function StageGantt({ stages }: { stages: any[] }) {
  const now = Date.now()
  const t = (x: string | null) => (x ? new Date(x).getTime() : NaN)
  const pts = stages.flatMap((s) => [t(s.started_at), t(s.completed_at), t(s.due_at)]).filter((x) => !Number.isNaN(x))
  if (!stages.some((s) => s.started_at) || !pts.length) return null
  const min = Math.min(...pts)
  const max = Math.max(...pts, stages.some((s) => s.started_at && !s.completed_at) ? now : 0)
  const span = Math.max(max - min, 86400_000)
  const pos = (x: number) => `${(((x - min) / span) * 100).toFixed(2)}%`
  return (
    <div className="mt-2 space-y-1" role="img" aria-label="گانت مراحل تولید">
      {stages.map((s) => {
        const a = t(s.started_at)
        const b = Number.isNaN(t(s.completed_at)) ? now : t(s.completed_at)
        const due = t(s.due_at)
        const late = !Number.isNaN(due) && b > due
        return (
          <div key={s.key} className="flex items-center gap-2 text-[10px]">
            <span className="w-20 shrink-0 truncate text-muted">{s.title}</span>
            <div className="relative h-2 flex-1 rounded-full bg-surface-2">
              {!Number.isNaN(a) && (
                <span
                  className={`absolute inset-y-0 rounded-full ${late ? 'bg-danger' : s.status === 'done' ? 'bg-ok' : 'bg-brand'}`}
                  style={{ insetInlineStart: pos(a), width: `max(3px, ${(((b - a) / span) * 100).toFixed(2)}%)` }}
                  title={`${s.title}: ${faDate(s.started_at)}${s.completed_at ? ' ← ' + faDate(s.completed_at) : ' (در جریان)'}`}
                />
              )}
              {!Number.isNaN(due) && <span className="absolute -inset-y-0.5 w-0.5 bg-ink/60" style={{ insetInlineStart: pos(due) }} title={`مهلت: ${faDate(s.due_at)}`} />}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function IssuesTab({ issues, stages }: { issues: any[]; stages: any[] }) {
  if (!issues.length) return <Empty title="هنوز شماره‌ای تعریف نشده" />
  const byIssue: Record<string, any[]> = {}
  for (const s of stages) (byIssue[s.issue_id] ||= []).push(s)
  return (
    <div className="space-y-2">
      {issues.map((i) => {
        const st = ISSUE_STATUS[i.status]
        const pct = i.toc_total ? Math.round((i.toc_done / i.toc_total) * 100) : 0
        return (
          <Link key={i.id} to={`/admin/issues/${i.id}`} className="card block p-3 hover:border-brand">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-bold">
                شمارهٔ {toFaDigits(i.number)} — {i.title}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted">
                {i.published_at ? `انتشار: ${faDate(i.published_at)}` : i.planned_publish_at ? `برنامه: ${faDate(i.planned_publish_at)}` : `آغاز: ${faDate(i.created_at)}`}
                {st && <Badge tone={st.tone}>{st.label}</Badge>}
              </div>
            </div>
            {i.status !== 'published' && i.status !== 'archived' && <Progress value={pct} className="mt-2" />}
            {!!byIssue[i.id]?.length && i.status !== 'published' && i.status !== 'archived' && <StageGantt stages={byIssue[i.id]} />}
            {!!byIssue[i.id]?.length && (
              <div className="mt-2 flex gap-0.5" title="مراحل تولید">
                {byIssue[i.id].map((s) => (
                  <span
                    key={s.key}
                    title={`${s.title}: ${s.status === 'done' ? 'انجام‌شده' : s.status === 'in_progress' ? 'در جریان' : s.status === 'skipped' ? 'ردشده' : 'در انتظار'}`}
                    className={`h-1.5 flex-1 rounded-full ${s.status === 'done' ? 'bg-ok' : s.status === 'in_progress' ? 'bg-brand' : s.status === 'skipped' ? 'bg-line' : 'bg-surface-2'}`}
                  />
                ))}
              </div>
            )}
          </Link>
        )
      })}
    </div>
  )
}

function RolesTab({ pubId, roles, admin, onChange }: { pubId: string; roles: any[]; admin: boolean; onChange: () => void }) {
  const [replace, setReplace] = useState<string | null>(null)
  const [creds, setCreds] = useState<Credential[] | null>(null)
  const { run } = useAction()
  const { confirm } = useToast()
  const current = roles.filter((r) => !r.ended_at)
  const past = roles.filter((r) => r.ended_at)
  const reset = async (r: any) => {
    if (!(await confirm(`رمز «${r.display_name}» بازنشانی شود؟ نشست‌های فعال او بسته می‌شود.`))) return
    const res = await run(() => api.post(`/api/admin/users/${r.user_id}/reset-password`), 'رمز بازنشانی شد')
    if (res) setCreds([{ ...res.credentials, role_fa: ROLE_FA[r.role] }])
  }
  if (creds) return <CredentialsSheet title="رمز موقت جدید" items={creds} onDone={() => setCreds(null)} />
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        {Object.keys(ROLE_FA).map((role) => {
          const r = current.find((x) => x.role === role)
          return (
            <Card key={role} title={ROLE_FA[role]}>
              {r ? (
                <div className="space-y-1 text-sm">
                  <div className="font-bold">{r.display_name}</div>
                  <div className="font-mono text-xs text-muted" dir="ltr">{r.username}</div>
                  <div className="text-xs text-muted">از {faDate(r.started_at)} · آخرین ورود: {r.last_login_at ? relativeFa(r.last_login_at) : 'هرگز'}</div>
                  {!!r.must_change_password && <Badge tone="warn">رمز موقت تغییر نکرده</Badge>}
                </div>
              ) : (
                <div className="text-sm text-muted">خالی</div>
              )}
              {admin && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="ghost" className="!px-3 !py-1.5" icon={<UserRoundCog className="size-4" />} onClick={() => setReplace(role)}>جایگزینی</Button>
                  {r && <Button variant="ghost" className="!px-3 !py-1.5" icon={<KeyRound className="size-4" />} onClick={() => reset(r)}>بازنشانی رمز</Button>}
                </div>
              )}
            </Card>
          )
        })}
      </div>
      <Card title="سابقهٔ ارکان">
        {!past.length ? (
          <Empty title="سابقه‌ای ثبت نشده" />
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {past.map((r) => (
                <tr key={r.id} className="border-t border-line first:border-0">
                  <td className="p-2">{ROLE_FA[r.role]}</td>
                  <td className="p-2">{r.display_name}</td>
                  <td className="p-2 text-xs text-muted">
                    {faDate(r.started_at)} تا {faDate(r.ended_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {replace && (
        <ReplaceModal
          pubId={pubId}
          role={replace}
          onClose={() => setReplace(null)}
          onDone={(c) => {
            setReplace(null)
            onChange()
            if (c) setCreds([c])
          }}
        />
      )}
    </div>
  )
}

function ReplaceModal({ pubId, role, onClose, onDone }: { pubId: string; role: string; onClose: () => void; onDone: (c: Credential | null) => void }) {
  const tu = useAsync(() => api.get('/api/admin/team-users'), [])
  const { busy, run } = useAction()
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [f, setF] = useState({ display_name: '', username: '', existing_user_id: '' })
  const submit = async () => {
    const r = await run(() => api.post(`/api/admin/publications/${pubId}/roles`, mode === 'existing' ? { role, existing_user_id: f.existing_user_id } : { role, display_name: f.display_name, username: f.username }), 'جایگزینی انجام شد')
    if (r) onDone(r.credentials)
  }
  return (
    <Modal open onClose={onClose} title={`جایگزینی ${ROLE_FA[role]}`} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={busy} onClick={submit}>ثبت</Button></>}>
      <p className="mb-3 text-xs text-muted">دورهٔ فرد قبلی بسته می‌شود و در سابقه می‌ماند (مبنای سنجش عملکرد هر مدیر).</p>
      <div className="mb-3 flex gap-3 text-sm">
        <label className="flex items-center gap-1"><input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> حساب جدید</label>
        <label className="flex items-center gap-1"><input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} /> حساب موجود</label>
      </div>
      {mode === 'new' ? (
        <div className="space-y-3">
          <Field label="نام و نام خانوادگی"><Input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
          <Field label="نام کاربری" hint="حروف لاتین، عدد و . _ -"><Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} dir="ltr" /></Field>
        </div>
      ) : (
        <Async state={tu}>
          {(d: any) => (
            <Field label="حساب تیمی">
              <Select value={f.existing_user_id} onChange={(e) => setF({ ...f, existing_user_id: e.target.value })} placeholder="انتخاب کنید" options={d.users.map((u: any) => ({ value: u.id, label: `${u.display_name} (${u.username})` }))} />
            </Field>
          )}
        </Async>
      )}
    </Modal>
  )
}

function MembersTab({ members }: { members: any[] }) {
  if (!members.length) return <Empty title="عضوی ثبت نشده" />
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-xs text-muted">
          <tr>
            <th className="p-3 text-right">نام</th>
            <th className="p-3 text-right">نقش</th>
            <th className="p-3 text-center">شماره‌ها</th>
            <th className="p-3 text-center">بخش‌ها</th>
            <th className="hidden p-3 text-right sm:table-cell">پیوستن</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} className={`border-t border-line ${m.is_active ? '' : 'opacity-50'}`}>
              <td className="p-3">
                <Link to={`/admin/people/${encodeURIComponent(m.student_number || m.full_name)}`} className="font-medium hover:text-brand">{m.full_name}</Link>
              </td>
              <td className="p-3 text-xs">{m.default_role || '—'}</td>
              <td className="p-3 text-center">{toFaDigits(m.issue_count)}</td>
              <td className="p-3 text-center">{toFaDigits(m.section_count)}</td>
              <td className="hidden p-3 text-xs text-muted sm:table-cell">{faDate(m.joined_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FollowersTab({ pubId }: { pubId: string }) {
  const st = useAsync(() => api.get(`/api/admin/publications/${pubId}/followers`), [pubId])
  return (
    <Async state={st}>
      {(d: any) => (
        <div className="space-y-4">
          <p className="text-xs text-muted">این فهرست فقط برای مسئول نشریات قابل مشاهده است و هرگز به تیم نشریه نشان داده نمی‌شود.</p>
          {d.summary && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                ['دنبال‌کنندهٔ فعلی', d.summary.current],
                ['جدید (۳۰ روز)', d.summary.new_30d],
                ['لغو (۳۰ روز)', d.summary.unfollowed_30d],
                ['کل لغوها', d.summary.unfollowed_total]
              ].map(([l, v]) => (
                <div key={l as string} className="card p-3">
                  <div className="text-xs text-muted">{l}</div>
                  <div className="text-xl font-extrabold">{toFaDigits(Number(v || 0))}</div>
                </div>
              ))}
            </div>
          )}
          {!!d.monthly.length && (
            <Card title="روند دنبال‌کردن (ماهانه)">
              <Chart
                height={220}
                csvName="followers-monthly"
                option={{ legend: {}, xAxis: { type: 'category', data: d.monthly.map((m: any) => faMonthLabel(m.month)) }, yAxis: { type: 'value', minInterval: 1 }, series: [...(d.unfollowMonthly ? [{ name: 'لغو', type: 'line', data: d.monthly.map((m: any) => d.unfollowMonthly.find((u: any) => u.month === m.month)?.n ?? 0) }] : []), { name: 'دنبال‌کنندهٔ جدید', type: 'bar', data: d.monthly.map((m: any) => m.n) }] }}
              />
            </Card>
          )}
          {!d.followers.length ? (
            <Empty title="دنبال‌کننده‌ای ندارد" />
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-xs text-muted">
                  <tr>
                    <th className="p-3 text-right">نام</th>
                    <th className="p-3 text-right">شمارهٔ دانشجویی</th>
                    <th className="hidden p-3 text-right sm:table-cell">دانشکده</th>
                    <th className="p-3 text-right">از</th>
                  </tr>
                </thead>
                <tbody>
                  {d.followers.map((f: any, i: number) => (
                    <tr key={i} className="border-t border-line">
                      <td className="p-3">{f.display_name}</td>
                      <td className="p-3 font-mono text-xs" dir="ltr">{f.student_number ? toFaDigits(f.student_number) : '—'}</td>
                      <td className="hidden p-3 text-xs sm:table-cell">{f.faculty_name || '—'}</td>
                      <td className="p-3 text-xs text-muted">{faDate(f.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Async>
  )
}

function EditModal({ pub, categories, onClose, onDone }: { pub: any; categories: string[]; onClose: () => void; onDone: () => void }) {
  const st = useAsync(() => Promise.all([api.get('/api/admin/structure'), api.get('/api/admin/categories')]), [])
  const { busy, run } = useAction()
  const [f, setF] = useState({
    title: pub.title || '', tagline: pub.tagline || '', description: pub.description || '', association_id: pub.association_id || '', faculty_id: pub.faculty_id || '',
    license_number: pub.license_number || '', license_issued_at: (pub.license_issued_at || '').slice(0, 10), license_expires_at: (pub.license_expires_at || '').slice(0, 10),
    frequency: pub.frequency, theme_color: pub.theme_color || '#0f766e', keywords: pub.keywords || ''
  })
  const [cats, setCats] = useState<string[]>(categories)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const submit = async () => {
    const r = await run(() => api.put(`/api/admin/publications/${pub.id}`, { ...f, category_ids: cats }), 'ذخیره شد')
    if (r) onDone()
  }
  return (
    <Modal open wide onClose={onClose} title="ویرایش نشریه" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={busy} onClick={submit}>ذخیره</Button></>}>
      <Async state={st}>
        {([s, c]: any) => (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="نام"><Input value={f.title} onChange={set('title')} /></Field>
              <Field label="شعار"><Input value={f.tagline} onChange={set('tagline')} /></Field>
              <Field label="صاحب امتیاز"><Select value={f.association_id} onChange={set('association_id')} options={s.associations.map((a: any) => ({ value: a.id, label: a.name }))} /></Field>
              <Field label="دانشکده"><Select value={f.faculty_id} onChange={set('faculty_id')} placeholder="بدون دانشکده" options={s.faculties.map((x: any) => ({ value: x.id, label: x.name }))} /></Field>
              <Field label="دورهٔ انتشار"><Select value={f.frequency} onChange={set('frequency')} options={Object.entries(FREQUENCY).map(([value, label]) => ({ value, label }))} /></Field>
              <Field label="شمارهٔ مجوز"><Input value={f.license_number} onChange={set('license_number')} /></Field>
              <Field label="تاریخ صدور مجوز"><Input type="date" dir="ltr" value={f.license_issued_at} onChange={set('license_issued_at')} /></Field>
              <Field label="تاریخ انقضای مجوز"><Input type="date" dir="ltr" value={f.license_expires_at} onChange={set('license_expires_at')} /></Field>
              <Field label="کلیدواژه‌ها"><Input value={f.keywords} onChange={set('keywords')} /></Field>
              <Field label="رنگ شاخص"><input type="color" value={f.theme_color} onChange={set('theme_color')} className="h-10 w-20 rounded-lg border border-line" /></Field>
            </div>
            <Field label="معرفی"><Textarea value={f.description} onChange={set('description')} /></Field>
            <Field label="دسته‌بندی‌ها">
              <div className="flex flex-wrap gap-2">
                {c.categories.filter((x: any) => x.is_active).map((x: any) => {
                  const on = cats.includes(x.id)
                  return (
                    <button type="button" key={x.id} onClick={() => setCats(on ? cats.filter((i) => i !== x.id) : [...cats, x.id].slice(0, 15))} className={on ? 'chip border-brand bg-brand-soft text-brand' : 'chip'}>
                      {x.name}
                    </button>
                  )
                })}
              </div>
            </Field>
          </div>
        )}
      </Async>
    </Modal>
  )
}

function StatusModal({ pub, onClose, onDone }: { pub: any; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction()
  const [status, setStatus] = useState(pub.status)
  const [reason, setReason] = useState('')
  const submit = async () => {
    const r = await run(() => api.post(`/api/admin/publications/${pub.id}/status`, { status, reason: reason.trim() || undefined }), 'وضعیت تغییر کرد')
    if (r) onDone()
  }
  return (
    <Modal open onClose={onClose} title="تغییر وضعیت نشریه" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button variant={status === 'active' ? 'primary' : 'danger'} loading={busy} onClick={submit}>ثبت</Button></>}>
      <div className="space-y-3">
        <Field label="وضعیت"><Select value={status} onChange={(e) => setStatus(e.target.value)} options={Object.entries(PUB_STATUS).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="دلیل (به ارکان نشریه اعلام می‌شود)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} /></Field>
      </div>
    </Modal>
  )
}

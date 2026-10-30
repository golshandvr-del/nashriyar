import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowRight, Eye, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { ISSUE_STATUS, formatNumber } from '../lib/format'
import { Async, Badge, Button, Card, Field, Input, PageHeader, Select, Tabs, Textarea, useAction, useAsync, useToast } from '../components/ui'
import { useTeam } from './Layout'
import TocTab from './room/TocTab'
import ProgressTab from './room/ProgressTab'
import MediaTab from './room/MediaTab'
import PublishTab from './room/PublishTab'
import type { RoomProps } from './room/TocTab'

type TabKey = 'overview' | 'toc' | 'progress' | 'media' | 'publish'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'کلی' },
  { key: 'toc', label: 'فهرست مطالب' },
  { key: 'progress', label: 'پیشرفت' },
  { key: 'media', label: 'رسانه' },
  { key: 'publish', label: 'انتشار و تأیید' }
]

function OverviewTab({ d, reload, pubId }: RoomProps) {
  const i = d.issue
  const { base } = useTeam()
  const nav = useNavigate()
  const { busy, run } = useAction()
  const { confirm } = useToast()
  const [cats, setCats] = useState<any[]>([])
  const [allMembers, setAllMembers] = useState<any[]>([])
  const [f, setF] = useState({ title: i.title, summary: i.summary || '', keywords: (i.keywords || '').split('،').filter(Boolean).join('، '), progress_view: i.progress_view || 'timeline', planned_publish_at: (i.planned_publish_at || '').slice(0, 10), category_ids: d.categories as string[] })
  const [team, setTeam] = useState<Record<string, string>>(() => Object.fromEntries(d.members.map((m: any) => [m.team_member_id, m.production_role])))
  useEffect(() => {
    api.get('/api/public/categories').then((r) => setCats(r.categories.filter((c: any) => c.type !== 'major'))).catch(() => {})
    api.get(`/api/team/${pubId}/members`).then((r) => setAllMembers(r.members)).catch(() => {})
  }, [pubId])
  const published = i.status === 'published'

  return (
    <div className="space-y-4">
      <Card title="مشخصات شماره">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="عنوان">
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={160} />
          </Field>
          <Field label="تاریخ انتشار برنامه‌ریزی‌شده">
            <Input type="date" dir="ltr" value={f.planned_publish_at} disabled={published} onChange={(e) => setF({ ...f, planned_publish_at: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="خلاصه">
              <Textarea value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} maxLength={3000} />
            </Field>
          </div>
          <Field label="کلیدواژه‌ها" hint="با ویرگول جدا کنید">
            <Input value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} />
          </Field>
          <Field label="نمای پیشرفت">
            <Select value={f.progress_view} onChange={(e) => setF({ ...f, progress_view: e.target.value })} options={[{ value: 'timeline', label: 'خط زمانی' }, { value: 'checklist', label: 'چک‌لیست' }, { value: 'kanban', label: 'کانبان' }]} />
          </Field>
        </div>
        {cats.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {cats.map((c) => {
              const on = f.category_ids.includes(c.id)
              return (
                <button key={c.id} type="button" className={on ? 'chip border-brand bg-brand-soft text-brand' : 'chip'} onClick={() => setF({ ...f, category_ids: on ? f.category_ids.filter((x) => x !== c.id) : [...f.category_ids, c.id] })}>
                  {c.name}
                </button>
              )
            })}
          </div>
        )}
        <Button
          className="mt-3"
          loading={busy}
          onClick={async () => {
            const r = await run(
              () =>
                api.put(`/api/team/${pubId}/issues/${i.id}`, {
                  title: f.title.trim(),
                  summary: f.summary,
                  keywords: f.keywords.split(/[,،]/).map((s: string) => s.trim()).filter(Boolean),
                  progress_view: f.progress_view,
                  planned_publish_at: f.planned_publish_at || null,
                  category_ids: f.category_ids
                }),
              'ذخیره شد'
            )
            if (r) reload()
          }}
        >
          ذخیره
        </Button>
      </Card>

      <Card title="اعضای این شماره" action={<span className="text-xs text-muted">{formatNumber(Object.keys(team).length)} نفر</span>}>
        <ul className="divide-y divide-line">
          {allMembers
            .filter((m) => m.is_active || m.id in team)
            .map((m) => {
              const on = m.id in team
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-2 py-2">
                  <label className="flex min-w-40 flex-1 items-center gap-2 text-sm">
                    <input type="checkbox" checked={on} onChange={(e) => { const n = { ...team }; if (e.target.checked) n[m.id] = m.default_role || 'همکار'; else delete n[m.id]; setTeam(n) }} />
                    {m.full_name}
                    {!m.is_active && <Badge>غیرفعال</Badge>}
                  </label>
                  {on && <Input className="max-w-56" value={team[m.id]} onChange={(e) => setTeam({ ...team, [m.id]: e.target.value })} aria-label="نقش" />}
                </li>
              )
            })}
        </ul>
        <Button
          className="mt-3"
          variant="ghost"
          loading={busy}
          onClick={async () => {
            const r = await run(() => api.put(`/api/team/${pubId}/issues/${i.id}/members`, { members: Object.entries(team).map(([member_id, production_role]) => ({ member_id, production_role })) }), 'اعضا ذخیره شد')
            if (r) reload()
          }}
        >
          ذخیرهٔ اعضا
        </Button>
        <p className="mt-2 text-xs text-muted">این فهرست در شناسنامهٔ شماره و گواهی‌های همکاری استفاده می‌شود.</p>
      </Card>

      {!published && (
        <Card title="حذف شماره" className="border-red-300">
          <Button
            variant="danger"
            icon={<Trash2 className="size-4" />}
            loading={busy}
            onClick={async () => {
              if (!(await confirm(`شمارهٔ ${formatNumber(i.number)} («${i.title}») حذف شود؟`, { danger: true, okLabel: 'حذف' }))) return
              const r = await run(() => api.del(`/api/team/${pubId}/issues/${i.id}`), 'شماره حذف شد')
              if (r) nav(`${base}/issues`)
            }}
          >
            حذف این شماره
          </Button>
        </Card>
      )}
    </div>
  )
}

export default function IssueRoom() {
  const { issueId = '' } = useParams()
  const { pubId, base } = useTeam()
  const [sp, setSp] = useSearchParams()
  const tab = (TABS.find((t) => t.key === sp.get('tab'))?.key || 'overview') as TabKey
  const st = useAsync(() => api.get(`/api/team/${pubId}/issues/${issueId}`), [pubId, issueId])
  return (
    <Async state={st}>
      {(d: any) => {
        const s = ISSUE_STATUS[d.issue.status] || { label: d.issue.status, tone: 'muted' as const }
        const props: RoomProps = { d, reload: st.reload, pubId }
        return (
          <div>
            <PageHeader
              back={
                <Link to={`${base}/issues`} className="mb-1 inline-flex items-center gap-1 text-xs text-muted hover:text-brand">
                  <ArrowRight className="size-3.5" /> شماره‌ها
                </Link>
              }
              title={<span className="flex flex-wrap items-center gap-2">شمارهٔ {formatNumber(d.issue.number)} <Badge tone={s.tone}>{s.label}</Badge></span>}
              subtitle={d.issue.title}
              actions={
                d.issue.status === 'published' ? (
                  <Link to={`/issue/${d.issue.id}`} className="btn-ghost"><Eye className="size-4" /> مشاهدهٔ عمومی</Link>
                ) : d.pages_uploaded ? (
                  <Link to={`/read/${d.issue.id}`} className="btn-ghost"><Eye className="size-4" /> پیش‌نمایش</Link>
                ) : null
              }
            />
            <Tabs tabs={TABS} value={tab} onChange={(k) => setSp(k === 'overview' ? {} : { tab: k }, { replace: true })} />
            {tab === 'overview' && <OverviewTab key={d.issue.updated_at} {...props} />}
            {tab === 'toc' && <TocTab {...props} />}
            {tab === 'progress' && <ProgressTab {...props} />}
            {tab === 'media' && <MediaTab {...props} />}
            {tab === 'publish' && <PublishTab key={d.issue.updated_at} {...props} />}
          </div>
        )
      }}
    </Async>
  )
}

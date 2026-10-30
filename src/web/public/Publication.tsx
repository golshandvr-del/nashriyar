import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Megaphone, UserCheck, UserPlus } from 'lucide-react'
import { api, mediaUrl } from '../lib/api'
import { absUrl, useMeta } from '../lib/meta'
import { useAuth, PUB_ROLE_LABEL } from '../lib/auth'
import { useFeature } from '../lib/features'
import { ASSOC_KIND, FREQUENCY, faDate, toFaDigits } from '../lib/format'
import { Async, Avatar, Button, Card, Empty, Tabs, useAction, useAsync } from '../components/ui'
import { IssueGrid, PostGrid } from '../components/cards'
import type { IssueLite, PostLite } from '../components/cards'

interface PubData {
  publication: {
    id: string
    slug: string
    title: string
    tagline: string | null
    description: string | null
    logo_key: string | null
    theme_color: string | null
    frequency: string | null
    license_number: string | null
    keywords: string | null
    founded_at: string | null
    association_name: string
    association_id?: string
    association_kind: string
    faculty_name: string | null
    faculty_id: string | null
    contacts: { kind: string; value: string; label?: string }[]
  }
  issues: IssueLite[]
  roles: { role: string; display_name: string }[]
  team: { full_name: string; default_role: string | null }[]
  categories: { id: string; name: string; slug: string }[]
  highlights: { id: string; title: string; cover: string | null; post_ids: string[] }[]
  recruitment: { id: string; title: string; roles_needed: string | null; body: string | null; contact: string | null; open_until: string | null }[]
  following: boolean
}

type Tab = 'issues' | 'posts' | 'about'

export default function Publication() {
  const { slug } = useParams()
  const st = useAsync(() => api.get<PubData>(`/api/public/publications/${slug}`), [slug])
  const posts = useAsync(() => api.get<{ posts: PostLite[] }>(`/api/public/publications/${slug}/posts`), [slug])
  const [tab, setTab] = useState<Tab>('issues')
  const { user } = useAuth()
  const recruitOn = useFeature('recruitment')
  const nav = useNavigate()
  const act = useAction()
  const pd = st.data?.publication
  useMeta(
    pd
      ? {
          title: pd.title,
          description: pd.tagline || pd.description,
          image: mediaUrl(pd.logo_key),
          type: 'profile',
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'Periodical',
            name: pd.title,
            description: pd.description || pd.tagline || undefined,
            url: location.origin + `/p/${pd.slug}`,
            image: absUrl(mediaUrl(pd.logo_key)) || undefined,
            inLanguage: 'fa',
            keywords: pd.keywords || undefined,
            publisher: { '@type': 'Organization', name: pd.association_name }
          }
        }
      : null
  )

  return (
    <Async state={st}>
      {(d) => {
        const p = d.publication
        const follow = async () => {
          if (!user) return nav(`/login?next=/p/${p.slug}`)
          const r = await act.run(() => (d.following ? api.del(`/api/me/follows/${p.id}`) : api.post(`/api/me/follows/${p.id}`)))
          if (r) st.setData({ ...d, following: !d.following })
        }
        const feedPosts = (posts.data?.posts || []).filter((x: any) => !x.is_story)
        return (
          <div>
            <header className="card overflow-hidden">
              <div className="h-24" style={{ background: `linear-gradient(135deg, ${p.theme_color || 'var(--brand)'}, transparent)` }} />
              <div className="-mt-10 flex flex-wrap items-end gap-4 px-4 pb-4">
                <div className="rounded-full border-4 border-surface">
                  <Avatar src={mediaUrl(p.logo_key)} name={p.title} color={p.theme_color} size={84} />
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="text-xl font-extrabold">{p.title}</h1>
                  {p.tagline && <p className="text-sm text-muted">{p.tagline}</p>}
                  <p className="mt-1 text-xs text-muted">
                    {p.association_id ? (
                      <Link to={`/association/${p.association_id}`} className="hover:text-brand">
                        {ASSOC_KIND[p.association_kind] || ''} {p.association_name}
                      </Link>
                    ) : (
                      <>
                        {ASSOC_KIND[p.association_kind] || ''} {p.association_name}
                      </>
                    )}
                    {p.faculty_name && (
                      <>
                        {' · '}
                        <Link to={`/faculty/${p.faculty_id}`} className="hover:text-brand">
                          {p.faculty_name}
                        </Link>
                      </>
                    )}
                    {p.frequency && ` · ${FREQUENCY[p.frequency] || p.frequency}`}
                  </p>
                </div>
                <Button variant={d.following ? 'ghost' : 'primary'} loading={act.busy} onClick={follow} icon={d.following ? <UserCheck className="size-4" /> : <UserPlus className="size-4" />}>
                  {d.following ? 'دنبال می‌کنید' : 'دنبال کردن'}
                </Button>
              </div>
              <div className="flex gap-6 border-t border-line px-4 py-2 text-sm">
                <span>
                  <b>{toFaDigits(d.issues.length)}</b> شماره
                </span>
                <span>
                  <b>{toFaDigits(feedPosts.length)}</b> پست
                </span>
              </div>
            </header>

            {d.highlights.length > 0 && (
              <section aria-label="هایلایت‌ها" className="no-scrollbar mt-4 flex gap-4 overflow-x-auto pb-1">
                {d.highlights.map((h) => (
                  <Link key={h.id} to={`/post/${h.post_ids[0]}`} className="flex w-16 shrink-0 flex-col items-center gap-1">
                    <span className="rounded-full border-2 border-line p-0.5">
                      <Avatar src={mediaUrl(h.cover)} name={h.title} color={p.theme_color} size={56} />
                    </span>
                    <span className="w-full truncate text-center text-[11px]">{h.title}</span>
                  </Link>
                ))}
              </section>
            )}

            {recruitOn && d.recruitment.length > 0 && (
              <div className="card mt-4 flex items-center gap-3 border-brand/40 bg-brand-soft p-3 text-sm">
                <Megaphone className="size-5 text-brand" />
                <span className="flex-1">
                  <b>{d.recruitment[0].title}</b> — این نشریه عضو جدید می‌پذیرد
                </span>
                <Link to="/recruitment" className="font-bold text-brand">
                  جزئیات
                </Link>
              </div>
            )}

            <div className="mt-4">
              <Tabs<Tab>
                tabs={[
                  { key: 'issues', label: 'شماره‌ها' },
                  { key: 'posts', label: 'پست‌ها' },
                  { key: 'about', label: 'دربارهٔ نشریه' }
                ]}
                value={tab}
                onChange={setTab}
              />
              {tab === 'issues' && (d.issues.length ? <IssueGrid issues={d.issues} showPub={false} /> : <Empty title="هنوز شماره‌ای منتشر نشده است" />)}
              {tab === 'posts' && (feedPosts.length ? <PostGrid posts={feedPosts} /> : <Empty title="پستی وجود ندارد" />)}
              {tab === 'about' && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Card title="معرفی">
                    <p className="whitespace-pre-line text-sm leading-7">{p.description || 'توضیحی ثبت نشده است.'}</p>
                    <dl className="mt-3 space-y-1 text-sm">
                      {p.license_number && (
                        <div className="flex gap-2">
                          <dt className="text-muted">شمارهٔ مجوز:</dt>
                          <dd>{toFaDigits(p.license_number)}</dd>
                        </div>
                      )}
                      {p.founded_at && (
                        <div className="flex gap-2">
                          <dt className="text-muted">تأسیس:</dt>
                          <dd>{faDate(p.founded_at)}</dd>
                        </div>
                      )}
                    </dl>
                    {d.categories.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {d.categories.map((c) => (
                          <Link key={c.id} to={`/c/${c.slug}`} className="chip">
                            {c.name}
                          </Link>
                        ))}
                      </div>
                    )}
                  </Card>
                  <Card title="تیم">
                    <ul className="space-y-1 text-sm">
                      {d.roles.map((r) => (
                        <li key={r.role}>
                          <span className="text-muted">{PUB_ROLE_LABEL[r.role] || r.role}:</span> {r.display_name}
                        </li>
                      ))}
                    </ul>
                    {d.team.length > 0 && (
                      <p className="mt-3 text-sm leading-7 text-muted">
                        اعضا: {d.team.map((t) => t.full_name).join('، ')}
                      </p>
                    )}
                  </Card>
                  {p.contacts.length > 0 && (
                    <Card title="راه‌های ارتباطی">
                      <ul className="space-y-1 text-sm">
                        {p.contacts.map((c, i) => (
                          <li key={i}>
                            <span className="text-muted">{c.label || c.kind}:</span> <span dir="ltr">{c.value}</span>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      }}
    </Async>
  )
}

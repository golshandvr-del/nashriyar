import { Link, useNavigate, useParams } from 'react-router-dom'
import { BookOpen, KeyRound, Library, Music, Paperclip, Video } from 'lucide-react'
import { api, mediaUrl } from '../lib/api'
import { absUrl, useMeta } from '../lib/meta'
import { useAuth } from '../lib/auth'
import { useFeature } from '../lib/features'
import { faDate, formatToman, toFaDigits } from '../lib/format'
import { Async, Avatar, Badge, Button, Card, useAction, useAsync } from '../components/ui'
import { Cover, PriceBadge, Shelf } from '../components/cards'
import type { IssueLite } from '../components/cards'

interface IssueData {
  issue: IssueLite & {
    summary: string | null
    keywords: string | null
    price_print: number | null
    print_run: number | null
    free_preview_pages: number | null
    publication_id: string
    logo_key: string | null
    association_name: string
    contacts: { kind: string; value: string; label?: string }[]
  }
  toc: { id: string; parent_id: string | null; title: string; kind: string; page_start: number | null; page_end: number | null; bylines: { role: string; name: string }[] }[]
  media: { id: string; kind: string; role: string; title: string | null; access: string; mime?: string | null; storage_key?: string | null }[]
  credits: { production_role: string; full_name: string }[]
  categories: { id: string; name: string; slug: string }[]
  others: IssueLite[]
  access: 'full' | 'preview'
  inLibrary: boolean
}

const MEDIA_ICON: Record<string, any> = { audio: Music, video: Video }

export default function Issue() {
  const { id } = useParams()
  const st = useAsync(() => api.get<IssueData>(`/api/public/issues/${id}`), [id])
  const { user } = useAuth()
  const paidOn = useFeature('paid_content')
  const nav = useNavigate()
  const act = useAction()
  const im = st.data?.issue
  useMeta(
    im
      ? {
          title: `${im.title} — ${im.publication_title || ''}`.replace(/ — $/, ''),
          description: im.summary || `شمارهٔ ${toFaDigits(im.number)} نشریهٔ ${im.publication_title || ''}`,
          image: mediaUrl(im.cover_key),
          type: 'article',
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'PublicationIssue',
            name: im.title,
            issueNumber: String(im.number),
            datePublished: im.published_at ? im.published_at.slice(0, 10) : undefined,
            numberOfPages: im.page_count || undefined,
            description: im.summary || undefined,
            keywords: im.keywords || undefined,
            image: absUrl(mediaUrl(im.cover_key)) || undefined,
            url: location.origin + `/issue/${im.id}`,
            inLanguage: 'fa',
            isPartOf: {
              '@type': 'Periodical',
              name: im.publication_title,
              url: im.publication_slug ? location.origin + `/p/${im.publication_slug}` : undefined
            }
          }
        }
      : null
  )

  return (
    <Async state={st}>
      {(d) => {
        const i = d.issue
        const addFree = async () => {
          if (!user) return nav(`/login?next=/issue/${i.id}`)
          const r = await act.run(() => api.post(`/api/me/library/${i.id}`), 'به کتابخانهٔ شما اضافه شد')
          if (r) st.setData({ ...d, inLibrary: true })
        }
        // group credits by role
        const credits = d.credits.reduce<Record<string, string[]>>((m, c) => ((m[c.production_role] ||= []).push(c.full_name), m), {})
        return (
          <div>
            <section className="grid gap-6 md:grid-cols-[240px_1fr]">
              <Cover src={i.cover_key} title={i.title} color={i.theme_color} className="mx-auto w-48 shadow-lg md:w-full" />
              <div>
                <Link to={`/p/${i.publication_slug}`} className="inline-flex items-center gap-2 text-sm text-muted hover:text-brand">
                  <Avatar src={mediaUrl(i.logo_key)} name={i.publication_title} color={i.theme_color} size={24} />
                  {i.publication_title} · {i.association_name}
                </Link>
                <h1 className="mt-2 text-2xl font-extrabold">{i.title}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
                  <span>شمارهٔ {toFaDigits(i.number)}</span>
                  <span>·</span>
                  <span>{faDate(i.published_at)}</span>
                  {i.page_count ? (
                    <>
                      <span>·</span>
                      <span>{toFaDigits(i.page_count)} صفحه</span>
                    </>
                  ) : null}
                  <PriceBadge pricing={i.pricing} price={i.price_digital} />
                </div>
                {i.summary && <p className="mt-4 whitespace-pre-line text-sm leading-7">{i.summary}</p>}
                {d.categories.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {d.categories.map((c) => (
                      <Link key={c.id} to={`/c/${c.slug}`} className="chip">
                        {c.name}
                      </Link>
                    ))}
                  </div>
                )}

                <div className="mt-5 flex flex-wrap gap-2">
                  {d.access === 'full' ? (
                    <Button icon={<BookOpen className="size-4" />} onClick={() => nav(`/read/${i.id}`)}>
                      خواندن
                    </Button>
                  ) : (
                    <>
                      {paidOn && (
                        <Button icon={<KeyRound className="size-4" />} onClick={() => nav(user ? `/redeem?issue=${i.id}` : `/login?next=/redeem`)}>
                          ثبت کد خرید
                        </Button>
                      )}
                      {(i.free_preview_pages ?? 0) > 0 && (
                        <Button variant="ghost" icon={<BookOpen className="size-4" />} onClick={() => nav(`/read/${i.id}`)}>
                          پیش‌نمایش {toFaDigits(i.free_preview_pages!)} صفحه
                        </Button>
                      )}
                    </>
                  )}
                  {i.pricing === 'free' && !d.inLibrary && (
                    <Button variant="ghost" icon={<Library className="size-4" />} loading={act.busy} onClick={addFree}>
                      افزودن به کتابخانه
                    </Button>
                  )}
                  {d.inLibrary && <Badge tone="ok">در کتابخانهٔ شما</Badge>}
                </div>

                {i.pricing === 'paid' && d.access !== 'full' && (
                  <p className="mt-3 rounded-xl bg-surface-2 p-3 text-xs leading-6 text-muted">
                    برای خرید نسخهٔ دیجیتال ({formatToman(i.price_digital)}) با تیم نشریه تماس بگیرید؛ پس از پرداخت یک کد یک‌بارمصرف دریافت می‌کنید که حداکثر ۲۴ ساعت اعتبار دارد.
                    {i.contacts?.length > 0 && <> راه‌های ارتباط: {i.contacts.map((c) => c.label || c.value).join('، ')}</>}
                  </p>
                )}
                {i.price_print ? <p className="mt-2 text-xs text-muted">نسخهٔ چاپی: {formatToman(i.price_print)}</p> : null}
              </div>
            </section>

            <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_320px]">
              <Card title="فهرست مطالب">
                {d.toc.length === 0 && <p className="text-sm text-muted">فهرستی ثبت نشده است.</p>}
                <ol className="divide-y divide-line">
                  {d.toc
                    .filter((t) => !t.parent_id)
                    .map((t) => (
                      <li key={t.id} className="py-2">
                        <TocRow t={t} canRead={d.access === 'full'} issueId={i.id} />
                        {d.toc
                          .filter((c) => c.parent_id === t.id)
                          .map((c) => (
                            <div key={c.id} className="ms-4 mt-1">
                              <TocRow t={c} canRead={d.access === 'full'} issueId={i.id} />
                            </div>
                          ))}
                      </li>
                    ))}
                </ol>
              </Card>
              <div className="space-y-4">
                {d.media.length > 0 && (
                  <Card title="محتوای همراه">
                    <ul className="space-y-2 text-sm">
                      {d.media.map((m) => {
                        const Icon = MEDIA_ICON[m.kind] || Paperclip
                        return (
                          <li key={m.id} className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <Icon className="size-4 text-brand" />
                              <span className="flex-1 truncate">{m.title || m.role}</span>
                              {m.access !== 'free' && <Badge>{m.access === 'paid' ? 'ویژهٔ خریداران' : 'خصوصی'}</Badge>}
                            </div>
                            {/* Built-in players; the file endpoint enforces access (free / entitled / staff) on every request. */}
                            {m.storage_key && (m.access === 'free' || d.access === 'full') && m.kind === 'audio' && (
                              <audio controls preload="none" controlsList="nodownload" className="w-full" src={mediaUrl(m.storage_key)} />
                            )}
                            {m.storage_key && (m.access === 'free' || d.access === 'full') && m.kind === 'video' && (
                              <video controls preload="metadata" controlsList="nodownload" disablePictureInPicture className="w-full rounded-lg bg-black" src={mediaUrl(m.storage_key)} />
                            )}
                            {m.storage_key && (m.access === 'free' || d.access === 'full') && m.kind === 'image' && (
                              <img loading="lazy" alt={m.title || ''} className="w-full rounded-lg" src={mediaUrl(m.storage_key)} />
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </Card>
                )}
                {Object.keys(credits).length > 0 && (
                  <Card title="شناسنامه">
                    <dl className="space-y-1 text-sm">
                      {Object.entries(credits).map(([role, names]) => (
                        <div key={role} className="flex gap-2">
                          <dt className="shrink-0 text-muted">{role}:</dt>
                          <dd>{names.join('، ')}</dd>
                        </div>
                      ))}
                    </dl>
                  </Card>
                )}
              </div>
            </div>

            <div className="mt-8">
              <Shelf title={`شماره‌های دیگر ${i.publication_title}`} issues={d.others} more={`/p/${i.publication_slug}`} />
            </div>
          </div>
        )
      }}
    </Async>
  )
}

function TocRow({ t, canRead, issueId }: { t: IssueData['toc'][number]; canRead: boolean; issueId: string }) {
  const body = (
    <div className="flex items-start gap-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{t.title}</div>
        {t.bylines.length > 0 && <div className="text-xs text-muted">{t.bylines.map((b) => `${b.role}: ${b.name}`).join(' · ')}</div>}
      </div>
      {t.page_start ? <span className="shrink-0 text-xs text-muted">ص {toFaDigits(t.page_start)}</span> : null}
    </div>
  )
  return canRead && t.page_start ? (
    <Link to={`/read/${issueId}?page=${t.page_start}`} className="block rounded-lg hover:text-brand">
      {body}
    </Link>
  ) : (
    body
  )
}

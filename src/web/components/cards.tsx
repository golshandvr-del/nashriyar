import { Link } from 'react-router-dom'
import { BookOpen, Images } from 'lucide-react'
import { mediaUrl } from '../lib/api'
import { faDate, formatToman, toFaDigits, cx } from '../lib/format'
import { Avatar, Badge } from './ui'

export interface IssueLite {
  id: string
  number: number
  title: string
  cover_key?: string | null
  pricing?: string
  price_digital?: number | null
  published_at?: string | null
  page_count?: number | null
  publication_slug?: string
  publication_title?: string
  theme_color?: string | null
}

export function Cover({ src, title, color, className }: { src?: string | null; title?: string; color?: string | null; className?: string }) {
  const url = mediaUrl(src)
  return (
    <div className={cx('relative aspect-[3/4] overflow-hidden rounded-xl border border-line bg-surface-2', className)} style={!url ? { background: color || 'var(--brand)' } : undefined}>
      {url ? (
        <img src={url} alt={title ? `جلد ${title}` : ''} loading="lazy" decoding="async" className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center p-3 text-center text-sm font-bold text-white">{title}</div>
      )}
    </div>
  )
}

export function PriceBadge({ pricing, price }: { pricing?: string; price?: number | null }) {
  if (pricing === 'paid') return <Badge tone="warn">{price ? formatToman(price) : 'پولی'}</Badge>
  return <Badge tone="ok">رایگان</Badge>
}

export function IssueCard({ issue, showPub = true, className }: { issue: IssueLite; showPub?: boolean; className?: string }) {
  return (
    <Link to={`/issue/${issue.id}`} className={cx('group block w-36 shrink-0 sm:w-40', className)} aria-label={`${issue.publication_title || ''} شمارهٔ ${issue.number}`}>
      <Cover src={issue.cover_key} title={issue.title} color={issue.theme_color} className="transition-transform group-hover:-translate-y-0.5" />
      <div className="mt-2 space-y-0.5">
        {showPub && issue.publication_title && <div className="truncate text-xs text-muted">{issue.publication_title}</div>}
        <div className="line-clamp-2 text-sm font-bold leading-6">{issue.title}</div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>شمارهٔ {toFaDigits(issue.number)}</span>
          <PriceBadge pricing={issue.pricing} price={issue.price_digital} />
        </div>
      </div>
    </Link>
  )
}

export function IssueGrid({ issues, showPub = true }: { issues: IssueLite[]; showPub?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {issues.map((i) => (
        <IssueCard key={i.id} issue={i} showPub={showPub} className="w-full sm:w-full" />
      ))}
    </div>
  )
}

export function Shelf({ title, issues, more }: { title: string; issues: IssueLite[]; more?: string }) {
  if (!issues?.length) return null
  return (
    <section className="mb-6">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-bold">{title}</h2>
        {more && (
          <Link to={more} className="text-sm text-brand">
            همه
          </Link>
        )}
      </header>
      <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
        {issues.map((i) => (
          <IssueCard key={i.id} issue={i} />
        ))}
      </div>
    </section>
  )
}

export interface PubLite {
  id: string
  slug: string
  title: string
  tagline?: string | null
  logo_key?: string | null
  theme_color?: string | null
  association_name?: string | null
  faculty_name?: string | null
  issue_count?: number
}

export function PubCard({ pub }: { pub: PubLite }) {
  return (
    <Link to={`/p/${pub.slug}`} className="card flex items-center gap-3 p-3 transition-colors hover:bg-surface-2">
      <Avatar src={mediaUrl(pub.logo_key)} name={pub.title} color={pub.theme_color} size={48} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-bold">{pub.title}</div>
        {pub.tagline && <div className="truncate text-xs text-muted">{pub.tagline}</div>}
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
          {pub.association_name && <span>{pub.association_name}</span>}
          {pub.issue_count != null && (
            <span className="inline-flex items-center gap-1">
              <BookOpen className="size-3" />
              {toFaDigits(pub.issue_count)} شماره
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

export interface PostLite {
  id: string
  caption?: string | null
  images: string[]
  published_at?: string | null
  publication_slug?: string
  publication_title?: string
  logo_key?: string | null
  theme_color?: string | null
}

/** Square grid tile (Instagram-like explore grid). */
export function PostTile({ post }: { post: PostLite }) {
  const src = mediaUrl(post.images?.[0])
  return (
    <Link to={`/post/${post.id}`} className="group relative block aspect-square overflow-hidden bg-surface-2" aria-label={post.caption?.slice(0, 60) || 'پست'}>
      {src ? <img src={src} alt="" loading="lazy" decoding="async" className="size-full object-cover transition-transform group-hover:scale-105" /> : <div className="flex size-full items-center justify-center p-2 text-xs text-muted">{post.caption?.slice(0, 80)}</div>}
      {post.images?.length > 1 && <Images className="absolute end-2 top-2 size-4 text-white drop-shadow" />}
    </Link>
  )
}

export function PostGrid({ posts }: { posts: PostLite[] }) {
  return (
    <div className="grid grid-cols-3 gap-0.5 overflow-hidden rounded-xl">
      {posts.map((p) => (
        <PostTile key={p.id} post={p} />
      ))}
    </div>
  )
}

/** Feed card: header with publication + first image + caption. */
export function PostCard({ post }: { post: PostLite }) {
  const src = mediaUrl(post.images?.[0])
  return (
    <article className="card overflow-hidden">
      <header className="flex items-center gap-2 p-3">
        <Avatar src={mediaUrl(post.logo_key)} name={post.publication_title} color={post.theme_color} size={32} />
        <Link to={`/p/${post.publication_slug}`} className="text-sm font-bold">
          {post.publication_title}
        </Link>
        <span className="ms-auto text-xs text-muted">{faDate(post.published_at)}</span>
      </header>
      <Link to={`/post/${post.id}`}>{src && <img src={src} alt="" loading="lazy" className="aspect-square w-full object-cover" />}</Link>
      {post.caption && <p className="line-clamp-3 whitespace-pre-line p-3 text-sm">{post.caption}</p>}
    </article>
  )
}

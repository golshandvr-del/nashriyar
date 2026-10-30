// Per-page SEO metadata for the SPA (ROADMAP phase 4/9): document title, description, Open Graph,
// canonical URL and an optional JSON-LD block. JSON-LD is a data block (not executable script), so it is
// compatible with the strict CSP. Everything is restored to the defaults from index.html on unmount.
import { useEffect } from 'react'

const SITE = 'نشریار'
const DEFAULT_TITLE = 'نشریار — نشریات دانشجویی'
const DEFAULT_DESC = 'نشریار — سامانهٔ جامع نشریات دانشجویی: پیشخوان، کتاب‌خوان امن، پنل تیم و داشبورد مسئول نشریات'

export interface Meta {
  title?: string
  description?: string | null
  image?: string | null
  type?: 'website' | 'article' | 'profile'
  jsonLd?: Record<string, unknown> | null
  noindex?: boolean
}

function setTag(attr: 'name' | 'property', key: string, value: string | null) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (value == null) {
    if (el && el.dataset.dyn) el.remove()
    return
  }
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    el.dataset.dyn = '1'
    document.head.appendChild(el)
  }
  el.setAttribute('content', value)
}

function setCanonical(href: string | null) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!href) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement('link')
    el.rel = 'canonical'
    document.head.appendChild(el)
  }
  el.href = href
}

function setJsonLd(data: Record<string, unknown> | null) {
  document.head.querySelector('script[data-jsonld]')?.remove()
  if (!data) return
  const el = document.createElement('script')
  el.type = 'application/ld+json'
  el.dataset.jsonld = '1'
  el.textContent = JSON.stringify(data)
  document.head.appendChild(el)
}

const clip = (s: string, n = 180) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

export function absUrl(path?: string | null): string | null {
  if (!path) return null
  try {
    return new URL(path, location.origin).href
  } catch {
    return null
  }
}

/** Apply page metadata while the component is mounted. Pass `null` while data is loading. */
export function useMeta(meta: Meta | null) {
  const key = meta ? JSON.stringify(meta) : ''
  useEffect(() => {
    if (!meta) return
    const title = meta.title ? `${meta.title} | ${SITE}` : DEFAULT_TITLE
    const desc = clip((meta.description || DEFAULT_DESC).replace(/\s+/g, ' ').trim())
    const url = location.origin + location.pathname
    document.title = title
    setTag('name', 'description', desc)
    setTag('name', 'robots', meta.noindex ? 'noindex' : null)
    setTag('property', 'og:site_name', SITE)
    setTag('property', 'og:locale', 'fa_IR')
    setTag('property', 'og:title', meta.title || DEFAULT_TITLE)
    setTag('property', 'og:description', desc)
    setTag('property', 'og:type', meta.type || 'website')
    setTag('property', 'og:url', url)
    setTag('property', 'og:image', absUrl(meta.image))
    setTag('name', 'twitter:card', meta.image ? 'summary_large_image' : 'summary')
    setCanonical(url)
    setJsonLd(meta.jsonLd || null)
    return () => {
      document.title = DEFAULT_TITLE
      setTag('name', 'description', DEFAULT_DESC)
      for (const k of ['robots', 'twitter:card']) setTag('name', k, null)
      for (const k of ['og:site_name', 'og:locale', 'og:title', 'og:description', 'og:type', 'og:url', 'og:image']) setTag('property', k, null)
      setCanonical(null)
      setJsonLd(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

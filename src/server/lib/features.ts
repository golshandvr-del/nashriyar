// Feature flags (ROADMAP phase 1): coarse on/off switches for whole product areas, stored in the
// `settings` table under `feature_flags` and editable by the super admin only. Unknown keys are ignored,
// missing keys fall back to the defaults below, so adding a flag never needs a migration.
import type { Db } from '../adapters/db'
import { HttpError, getSetting } from './util'

export const FEATURE_DEFAULTS = {
  explore: true, // explore feed + posts
  comments: true, // student comments on posts
  recruitment: true, // public recruitment calls
  paid_content: true, // purchase codes / paid issues
  certificates: true, // public certificate verification
  physical_sales: true, // recording print sales in the team panel
  member_portal: false // ROADMAP phase 9 (optional): regular team members tick their own TOC sections
} as const

export type FeatureKey = keyof typeof FEATURE_DEFAULTS
export type Features = Record<FeatureKey, boolean>

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  explore: 'اکسپلور و پست‌ها',
  comments: 'نظر دانشجویان زیر پست‌ها',
  recruitment: 'فراخوان جذب نیرو',
  paid_content: 'محتوای پولی و کد خرید',
  certificates: 'استعلام گواهی همکاری',
  physical_sales: 'ثبت فروش نسخهٔ چاپی',
  member_portal: 'ورود محدود اعضای عادی تیم (تیک بخش‌های خودشان)'
}

export async function getFeatures(db: Db): Promise<Features> {
  const stored = await getSetting<Record<string, unknown>>(db, 'feature_flags', {})
  const out = { ...FEATURE_DEFAULTS } as Features
  for (const k of Object.keys(FEATURE_DEFAULTS) as FeatureKey[]) if (typeof stored?.[k] === 'boolean') out[k] = stored[k] as boolean
  return out
}

/** Keep only known boolean flags (used when the super admin saves settings). */
export function sanitizeFeatures(v: unknown): Partial<Features> {
  const out: Partial<Features> = {}
  if (!v || typeof v !== 'object') return out
  for (const k of Object.keys(FEATURE_DEFAULTS) as FeatureKey[]) {
    const x = (v as Record<string, unknown>)[k]
    if (typeof x === 'boolean') out[k] = x
  }
  return out
}

/** Throws 404-like error when a feature is switched off. */
export async function requireFeature(db: Db, key: FeatureKey) {
  const f = await getFeatures(db)
  if (!f[key]) throw new HttpError(403, `قابلیت «${FEATURE_LABELS[key]}» توسط مدیر سامانه غیرفعال شده است`)
}

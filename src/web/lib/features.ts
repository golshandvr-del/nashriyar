// Client-side view of the feature flags (served by /api/public/settings). One shared request per page load;
// while loading, every feature counts as enabled so nothing flickers away. The server enforces the flags
// independently (requireFeature), so this hook only hides UI.
import { useEffect, useState } from 'react'
import { api } from './api'

export type FeatureKey = 'explore' | 'comments' | 'recruitment' | 'paid_content' | 'certificates' | 'physical_sales' | 'member_portal'

export interface PublicSettings {
  registration_open?: boolean
  registration_mode?: string
  guest_can_read_free?: boolean
  ai_enabled?: boolean
  features?: Partial<Record<FeatureKey, boolean>>
  [k: string]: unknown
}

let cache: PublicSettings | null = null
let pending: Promise<PublicSettings> | null = null
const listeners = new Set<(s: PublicSettings) => void>()

export function loadPublicSettings(force = false): Promise<PublicSettings> {
  if (cache && !force) return Promise.resolve(cache)
  if (!pending || force) {
    pending = api
      .get<PublicSettings>('/api/public/settings')
      .then((s) => {
        cache = s || {}
        listeners.forEach((l) => l(cache!))
        return cache
      })
      .catch(() => {
        pending = null
        return cache || {}
      })
  }
  return pending
}

export function usePublicSettings(): PublicSettings | null {
  const [s, setS] = useState<PublicSettings | null>(cache)
  useEffect(() => {
    listeners.add(setS)
    loadPublicSettings().then(setS)
    return () => {
      listeners.delete(setS)
    }
  }, [])
  return s
}

export function useFeature(key: FeatureKey): boolean {
  const s = usePublicSettings()
  return s?.features?.[key] !== false
}

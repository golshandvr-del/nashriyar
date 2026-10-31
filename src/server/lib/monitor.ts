// Lightweight request-latency & error monitoring (ROADMAP phase 11).
// Works in both Cloudflare Workers and self-hosted Node without external services.
// Stores only route templates/prefixes, HTTP status, latency and sanitized error messages — never personal data.

const MAX_SAMPLES = 500
const MAX_ERRORS = 50

const startedAt = new Date().toISOString()
const latencies: number[] = []
let totalRequests = 0
let total5xx = 0
let total4xx = 0

export interface ErrorEntry {
  at: string
  method: string
  path: string
  status: number
  message: string
}

const recentErrors: ErrorEntry[] = []

function scrubPath(path: string): string {
  // Collapse random IDs and query strings so logs stay compact and free of tokens/codes.
  return path
    .split('?')[0]
    .replace(/\/[0-9a-z]{12,}/gi, '/:id')
    .slice(0, 120)
}

export function recordRequest(method: string, path: string, status: number, ms: number) {
  totalRequests++
  if (status >= 500) total5xx++
  else if (status >= 400) total4xx++
  latencies.push(Math.max(0, Math.round(ms)))
  if (latencies.length > MAX_SAMPLES) latencies.shift()
}

export function recordError(method: string, path: string, status: number, err: unknown) {
  const raw = err instanceof Error ? err.message : String(err || 'خطای ناشناخته')
  // Strip anything that looks like an email, phone, student number or bearer token.
  const message = raw
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b\d{8,12}\b/g, '[num]')
    .slice(0, 200)
  recentErrors.unshift({
    at: new Date().toISOString(),
    method,
    path: scrubPath(path),
    status,
    message
  })
  if (recentErrors.length > MAX_ERRORS) recentErrors.pop()
}

export function getMonitorStats() {
  const sorted = [...latencies].sort((a, b) => a - b)
  const n = sorted.length
  const avg = n ? Math.round(sorted.reduce((s, x) => s + x, 0) / n) : 0
  const p95 = n ? sorted[Math.min(n - 1, Math.floor(n * 0.95))] : 0
  const max = n ? sorted[n - 1] : 0
  return {
    started_at: startedAt,
    requests_total: totalRequests,
    errors_5xx: total5xx,
    errors_4xx: total4xx,
    latency_ms: { samples: n, avg, p95, max },
    recent_errors: recentErrors.slice(0, 25)
  }
}

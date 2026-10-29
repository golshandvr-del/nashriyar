// Thin fetch wrapper: same-origin cookies, JSON in/out, Persian error messages.

export class ApiError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const NET_ERR = 'ارتباط با سرور برقرار نشد؛ اتصال اینترنت را بررسی کنید'

async function parse<T>(res: Response): Promise<T> {
  let data: any = null
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) data = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = data?.error || (res.status === 401 ? 'ابتدا وارد شوید' : res.status === 403 ? 'دسترسی ندارید' : res.status === 429 ? 'تعداد درخواست‌ها زیاد است؛ کمی صبر کنید' : 'خطای سرور')
    if (res.status === 401) window.dispatchEvent(new CustomEvent('nsh:unauthorized'))
    throw new ApiError(res.status, msg, data?.code)
  }
  return data as T
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    })
  } catch {
    throw new ApiError(0, NET_ERR)
  }
  return parse<T>(res)
}

export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T = any>(path: string, body: unknown = {}) => request<T>('PUT', path, body),
  del: <T = any>(path: string) => request<T>('DELETE', path)
}

/** Builds a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v))
  const s = u.toString()
  return s ? `?${s}` : ''
}

/** Multipart upload with progress (XHR, because fetch has no upload progress). */
export function upload<T = any>(path: string, fields: Record<string, string | Blob>, onProgress?: (ratio: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) fd.append(k, v)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', path)
    xhr.withCredentials = true
    if (onProgress) xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onerror = () => reject(new ApiError(0, NET_ERR))
    xhr.onload = () => {
      let data: any = null
      try {
        data = JSON.parse(xhr.responseText)
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T)
      else reject(new ApiError(xhr.status, data?.error || 'بارگذاری ناموفق بود', data?.code))
    }
    xhr.send(fd)
  })
}

/** Public URL for a stored object key (covers, logos, post images). */
export function mediaUrl(key?: string | null): string | undefined {
  if (!key) return undefined
  if (/^(https?:|data:|\/)/.test(key)) return key
  return `/api/media/k/${key}`
}

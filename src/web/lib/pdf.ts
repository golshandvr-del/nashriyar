// Client-side PDF → page images pipeline (pdf.js). The server never parses PDFs (Workers CPU limits);
// each page is rendered to WebP in the browser and uploaded individually, so an interrupted upload resumes.
import { api, upload } from './api'

type PdfJs = typeof import('pdfjs-dist')
let lib: Promise<PdfJs> | null = null

async function pdfjs(): Promise<PdfJs> {
  if (!lib) {
    lib = (async () => {
      const m = await import('pdfjs-dist')
      const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
      m.GlobalWorkerOptions.workerSrc = worker
      return m
    })()
  }
  return lib
}

export interface ProcessProgress {
  phase: 'reading' | 'rendering' | 'uploading' | 'finalizing' | 'done'
  page: number
  total: number
  skipped: number
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((res) => canvas.toBlob((b) => res(b), type, quality))
}

/**
 * Renders every page of `file` and uploads it to /api/media/pages/:issueId, skipping pages already on the server.
 * targetWidth ≈ 1400px keeps text crisp on phones/tablets while staying ~150–300KB per page.
 */
export async function processPdf(issueId: string, file: File, onProgress: (p: ProcessProgress) => void, opts: { targetWidth?: number; signal?: AbortSignal } = {}) {
  const targetWidth = opts.targetWidth ?? 1400
  onProgress({ phase: 'reading', page: 0, total: 0, skipped: 0 })
  const m = await pdfjs()
  const doc = await m.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const total = doc.numPages
  let existing = new Set<number>()
  try {
    const st = await api.get<{ uploaded: number[] }>(`/api/media/pages/${issueId}/status`)
    existing = new Set(st.uploaded)
  } catch {}
  let skipped = 0
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { alpha: false })!
  const webp = canvas.toDataURL('image/webp').startsWith('data:image/webp')
  for (let n = 1; n <= total; n++) {
    if (opts.signal?.aborted) throw new Error('پردازش متوقف شد')
    if (existing.has(n)) {
      skipped++
      onProgress({ phase: 'uploading', page: n, total, skipped })
      continue
    }
    onProgress({ phase: 'rendering', page: n, total, skipped })
    const page = await doc.getPage(n)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(3, targetWidth / base.width)
    const vp = page.getViewport({ scale })
    canvas.width = Math.round(vp.width)
    canvas.height = Math.round(vp.height)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport: vp, canvas } as any).promise
    let text = ''
    try {
      const tc = await page.getTextContent()
      text = (tc.items as any[]).map((i) => i.str || '').join(' ').replace(/\s+/g, ' ').trim().slice(0, 20000)
    } catch {}
    const blob = await canvasToBlob(canvas, webp ? 'image/webp' : 'image/jpeg', 0.82)
    if (!blob) throw new Error(`تبدیل صفحهٔ ${n} ناموفق بود`)
    onProgress({ phase: 'uploading', page: n, total, skipped })
    // one retry for flaky networks
    const fields = { file: new File([blob], `p${n}.${webp ? 'webp' : 'jpg'}`, { type: blob.type }), page_number: String(n), text }
    try {
      await upload(`/api/media/pages/${issueId}`, fields)
    } catch {
      await new Promise((r) => setTimeout(r, 1500))
      await upload(`/api/media/pages/${issueId}`, fields)
    }
    page.cleanup()
  }
  onProgress({ phase: 'finalizing', page: total, total, skipped })
  await api.post(`/api/media/pages/${issueId}/finalize`, { page_count: total })
  await doc.destroy()
  onProgress({ phase: 'done', page: total, total, skipped })
  return total
}

/** Renders page 1 of a PDF as a cover candidate (JPEG blob). */
export async function pdfFirstPage(file: File, width = 900): Promise<Blob | null> {
  const m = await pdfjs()
  const doc = await m.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const page = await doc.getPage(1)
  const base = page.getViewport({ scale: 1 })
  const vp = page.getViewport({ scale: width / base.width })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(vp.width)
  canvas.height = Math.round(vp.height)
  const ctx = canvas.getContext('2d', { alpha: false })!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport: vp, canvas } as any).promise
  const b = await canvasToBlob(canvas, 'image/jpeg', 0.85)
  await doc.destroy()
  return b
}

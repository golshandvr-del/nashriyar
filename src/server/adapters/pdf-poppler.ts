// Server-side PDF → page images with poppler-utils (pdfinfo / pdftoppm / pdftotext). ROADMAP phase 11.
// Node entry only (uses child_process + fs); never imported by the Cloudflare worker.
// Pages are rendered one at a time to keep memory flat, so a 300-page issue is fine on a 4 GB server.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PdfRenderer } from '../context'

function run(cmd: string, args: string[], timeoutMs: number, binary = false): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: binary ? 'buffer' : 'buffer' }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout as Buffer)
    })
  })
}

/** Returns a renderer when poppler-utils is installed, otherwise null (the browser converter is used). */
export async function popplerRenderer(): Promise<PdfRenderer | null> {
  try {
    await run('pdftoppm', ['-v'], 5000)
  } catch (e: any) {
    // pdftoppm -v prints to stderr and may exit non-zero on old versions; only ENOENT means "missing".
    if (e?.code === 'ENOENT') return null
  }
  return {
    name: 'pdftoppm',
    async render(pdf, { width, onPage }) {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nsh-pdf-'))
      const file = path.join(dir, 'in.pdf')
      try {
        await fs.promises.writeFile(file, pdf)
        const info = (await run('pdfinfo', [file], 30_000)).toString('utf8')
        const m = info.match(/^Pages:\s+(\d+)/m)
        const count = m ? Number(m[1]) : 0
        if (!count) throw new Error('PDF صفحه‌ای ندارد یا خراب است')
        if (count > 2000) throw new Error('تعداد صفحات PDF بیش از حد مجاز است')
        for (let n = 1; n <= count; n++) {
          const base = path.join(dir, `p${n}`)
          // -singlefile writes exactly <base>.jpg; scale to the target width, keep the aspect ratio.
          await run('pdftoppm', ['-f', String(n), '-l', String(n), '-singlefile', '-jpeg', '-jpegopt', 'quality=82', '-scale-to-x', String(width), '-scale-to-y', '-1', file, base], 120_000)
          const bytes = new Uint8Array(await fs.promises.readFile(base + '.jpg'))
          await fs.promises.rm(base + '.jpg', { force: true })
          let text: string | null = null
          try {
            text = (await run('pdftotext', ['-f', String(n), '-l', String(n), '-enc', 'UTF-8', file, '-'], 30_000)).toString('utf8').trim().slice(0, 20000) || null
          } catch {
            text = null // text layer is only used for search / TOC hints
          }
          await onPage({ page_number: n, bytes, mime: 'image/jpeg', ext: 'jpg', text })
        }
        return { page_count: count }
      } finally {
        await fs.promises.rm(dir, { recursive: true, force: true })
      }
    }
  }
}

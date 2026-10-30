// Browser-side image preparation: optional centre crop to an aspect ratio, downscale, re-encode.
// Re-encoding through a canvas drops all EXIF/GPS metadata (privacy) and shrinks uploads.

export type Aspect = 'original' | '1:1' | '4:5'

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('خواندن تصویر ممکن نشد'))
    }
    img.src = url
  })
}

/** Returns a WebP (or JPEG fallback) blob, longest side ≤ maxSide, cropped to `aspect`. */
export async function prepareImage(file: Blob, opts: { aspect?: Aspect; maxSide?: number; quality?: number } = {}): Promise<Blob> {
  const { aspect = 'original', maxSide = 1440, quality = 0.85 } = opts
  const img = await loadImage(file)
  let sx = 0
  let sy = 0
  let sw = img.naturalWidth
  let sh = img.naturalHeight
  if (aspect !== 'original') {
    const target = aspect === '1:1' ? 1 : 4 / 5 // width / height
    if (sw / sh > target) {
      const w = Math.round(sh * target)
      sx = Math.round((sw - w) / 2)
      sw = w
    } else {
      const h = Math.round(sw / target)
      sy = Math.round((sh - h) / 2)
      sh = h
    }
  }
  const scale = Math.min(1, maxSide / Math.max(sw, sh))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sw * scale))
  canvas.height = Math.max(1, Math.round(sh * scale))
  const ctx = canvas.getContext('2d', { alpha: false })!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  const webp = canvas.toDataURL('image/webp').startsWith('data:image/webp')
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, webp ? 'image/webp' : 'image/jpeg', quality))
  if (!blob) throw new Error('فشرده‌سازی تصویر ممکن نشد')
  return blob
}

/** Wraps a blob as a File with a sensible extension (the server sniffs real type anyway). */
export function asFile(blob: Blob, base = 'image'): File {
  const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg'
  return new File([blob], `${base}.${ext}`, { type: blob.type })
}

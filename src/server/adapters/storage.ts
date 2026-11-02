// Portable file storage. R2 on Cloudflare, local disk on a self-hosted server.

export interface StoredObject {
  body: ReadableStream | Uint8Array
  contentType: string
  /** total object size in bytes (also when only a range was read) */
  size?: number
  /** set when a byte range was read: the body holds bytes [offset, offset + length) */
  range?: { offset: number; length: number }
}

/** Inclusive-exclusive byte window requested by `Range: bytes=a-b` (resolved against the object size). */
export interface ByteRange {
  offset: number
  length: number
}

export interface Storage {
  put(key: string, data: ArrayBuffer | Uint8Array, contentType: string): Promise<void>
  /** `range` reads only part of the object (video seeking); omitted = whole object. */
  get(key: string, range?: ByteRange): Promise<StoredObject | null>
  delete(key: string): Promise<void>
}

export function r2Storage(bucket: any): Storage {
  return {
    async put(key, data, contentType) {
      await bucket.put(key, data, { httpMetadata: { contentType } })
    },
    async get(key, range) {
      const o = await bucket.get(key, range ? { range: { offset: range.offset, length: range.length } } : undefined)
      if (!o) return null
      return { body: o.body, contentType: o.httpMetadata?.contentType || 'application/octet-stream', size: o.size, ...(range ? { range } : {}) }
    },
    async delete(key) {
      await bucket.delete(key)
    }
  }
}

/** Local-disk storage (Node only). `fsMod`/`pathMod` are injected to keep this file runtime-neutral. */
export function diskStorage(root: string, fsMod: any, pathMod: any): Storage {
  const safe = (key: string) => {
    const clean = key.replace(/\.\.+/g, '').replace(/^\/+/, '')
    return pathMod.join(root, clean)
  }
  return {
    async put(key, data, contentType) {
      const p = safe(key)
      await fsMod.promises.mkdir(pathMod.dirname(p), { recursive: true })
      await fsMod.promises.writeFile(p, data instanceof Uint8Array ? data : new Uint8Array(data))
      await fsMod.promises.writeFile(p + '.meta', JSON.stringify({ contentType }))
    },
    async get(key, range) {
      const p = safe(key)
      try {
        let contentType = 'application/octet-stream'
        const readType = async () => {
          try {
            contentType = JSON.parse(await fsMod.promises.readFile(p + '.meta', 'utf8')).contentType
          } catch {}
        }
        if (range) {
          // read only the requested window (a seek in a 90 MB video must not load the whole file)
          const fh = await fsMod.promises.open(p, 'r')
          try {
            const size = (await fh.stat()).size
            const length = Math.max(0, Math.min(range.length, size - range.offset))
            const buf = new Uint8Array(length)
            if (length) await fh.read(buf, 0, length, range.offset)
            await readType()
            return { body: buf, contentType, size, range: { offset: range.offset, length } }
          } finally {
            await fh.close()
          }
        }
        const body = await fsMod.promises.readFile(p)
        await readType()
        return { body: new Uint8Array(body), contentType, size: body.length }
      } catch {
        return null
      }
    },
    async delete(key) {
      const p = safe(key)
      await fsMod.promises.rm(p, { force: true })
      await fsMod.promises.rm(p + '.meta', { force: true })
    }
  }
}

/** In-memory storage (tests / fallback when no bucket is bound). */
export function memoryStorage(): Storage {
  const m = new Map<string, { data: Uint8Array; contentType: string }>()
  return {
    async put(key, data, contentType) {
      m.set(key, { data: data instanceof Uint8Array ? data : new Uint8Array(data), contentType })
    },
    async get(key, range) {
      const o = m.get(key)
      if (!o) return null
      if (range) return { body: o.data.slice(range.offset, range.offset + range.length), contentType: o.contentType, size: o.data.length, range: { offset: range.offset, length: Math.max(0, Math.min(range.length, o.data.length - range.offset)) } }
      return { body: o.data, contentType: o.contentType, size: o.data.length }
    },
    async delete(key) {
      m.delete(key)
    }
  }
}

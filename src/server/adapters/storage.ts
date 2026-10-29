// Portable file storage. R2 on Cloudflare, local disk on a self-hosted server.

export interface StoredObject {
  body: ReadableStream | Uint8Array
  contentType: string
  size?: number
}

export interface Storage {
  put(key: string, data: ArrayBuffer | Uint8Array, contentType: string): Promise<void>
  get(key: string): Promise<StoredObject | null>
  delete(key: string): Promise<void>
}

export function r2Storage(bucket: any): Storage {
  return {
    async put(key, data, contentType) {
      await bucket.put(key, data, { httpMetadata: { contentType } })
    },
    async get(key) {
      const o = await bucket.get(key)
      if (!o) return null
      return { body: o.body, contentType: o.httpMetadata?.contentType || 'application/octet-stream', size: o.size }
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
    async get(key) {
      const p = safe(key)
      try {
        const body = await fsMod.promises.readFile(p)
        let contentType = 'application/octet-stream'
        try {
          contentType = JSON.parse(await fsMod.promises.readFile(p + '.meta', 'utf8')).contentType
        } catch {}
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
    async get(key) {
      const o = m.get(key)
      return o ? { body: o.data, contentType: o.contentType, size: o.data.length } : null
    },
    async delete(key) {
      m.delete(key)
    }
  }
}

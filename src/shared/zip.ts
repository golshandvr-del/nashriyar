// Dependency-free ZIP writers ("stored", method 0) shared by the browser and the server (ROADMAP phases 8 + 18).
//  - zipStore(files): whole archive in memory (small client-side exports).
//  - ZipStream: streaming archive for large server-side exports — each entry is written as it is produced, with the
//    CRC and sizes in a trailing data descriptor (general-purpose flag bit 3), so nothing is buffered except the tiny
//    central directory.

const enc = new TextEncoder()

let CRC_TABLE: Uint32Array | null = null
function table(): Uint32Array {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c >>> 0
    }
  }
  return CRC_TABLE
}

/** Incremental CRC-32: start with 0xffffffff, feed chunks, finish with `crcEnd`. */
export function crcUpdate(c: number, buf: Uint8Array): number {
  const t = table()
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return c >>> 0
}
export const crcEnd = (c: number) => (c ^ 0xffffffff) >>> 0
export const crc32 = (buf: Uint8Array) => crcEnd(crcUpdate(0xffffffff, buf))

function localHeader(name: Uint8Array, crc: number, size: number, descriptor: boolean): Uint8Array {
  const h = new Uint8Array(30 + name.length)
  const dv = new DataView(h.buffer)
  dv.setUint32(0, 0x04034b50, true)
  dv.setUint16(4, 20, true)
  dv.setUint16(6, descriptor ? 0x0808 : 0x0800, true) // bit 11 = UTF-8 names, bit 3 = sizes in data descriptor
  dv.setUint16(8, 0, true)
  dv.setUint32(14, descriptor ? 0 : crc, true)
  dv.setUint32(18, descriptor ? 0 : size, true)
  dv.setUint32(22, descriptor ? 0 : size, true)
  dv.setUint16(26, name.length, true)
  h.set(name, 30)
  return h
}

function centralEntry(name: Uint8Array, crc: number, size: number, offset: number, descriptor: boolean): Uint8Array {
  const cen = new Uint8Array(46 + name.length)
  const cv = new DataView(cen.buffer)
  cv.setUint32(0, 0x02014b50, true)
  cv.setUint16(4, 20, true)
  cv.setUint16(6, 20, true)
  cv.setUint16(8, descriptor ? 0x0808 : 0x0800, true)
  cv.setUint32(16, crc, true)
  cv.setUint32(20, size, true)
  cv.setUint32(24, size, true)
  cv.setUint16(28, name.length, true)
  cv.setUint32(42, offset, true)
  cen.set(name, 46)
  return cen
}

function endRecord(count: number, cenSize: number, cenOffset: number): Uint8Array {
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, count, true)
  ev.setUint16(10, count, true)
  ev.setUint32(12, cenSize, true)
  ev.setUint32(16, cenOffset, true)
  return end
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
  let p = 0
  for (const a of parts) {
    out.set(a, p)
    p += a.length
  }
  return out
}

/** Minimal in-memory ZIP (method 0 = store). */
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const local = localHeader(name, crc, f.data.length, false)
    parts.push(local, f.data)
    central.push(centralEntry(name, crc, f.data.length, offset, false))
    offset += local.length + f.data.length
  }
  const cenSize = central.reduce((a, c) => a + c.length, 0)
  return concat([...parts, ...central, endRecord(files.length, cenSize, offset)])
}

/**
 * Streaming ZIP writer. `emit` receives every byte chunk in order (e.g. a ReadableStream controller's enqueue).
 * Usage: begin(name) → write(chunk)… → end() for each entry, then finish().
 */
export class ZipStream {
  private offset = 0
  private central: Uint8Array[] = []
  private cur: { name: Uint8Array; crc: number; size: number; start: number } | null = null
  constructor(private emit: (chunk: Uint8Array) => void) {}
  private out(b: Uint8Array) {
    this.emit(b)
    this.offset += b.length
  }
  begin(name: string) {
    if (this.cur) this.end()
    const n = enc.encode(name)
    this.cur = { name: n, crc: 0xffffffff, size: 0, start: this.offset }
    this.out(localHeader(n, 0, 0, true))
  }
  write(chunk: Uint8Array | string) {
    if (!this.cur) throw new Error('ZipStream.write before begin')
    const b = typeof chunk === 'string' ? enc.encode(chunk) : chunk
    if (!b.length) return
    this.cur.crc = crcUpdate(this.cur.crc, b)
    this.cur.size += b.length
    this.out(b)
  }
  end() {
    const e = this.cur
    if (!e) return
    const crc = crcEnd(e.crc)
    const dd = new Uint8Array(16)
    const dv = new DataView(dd.buffer)
    dv.setUint32(0, 0x08074b50, true)
    dv.setUint32(4, crc, true)
    dv.setUint32(8, e.size, true)
    dv.setUint32(12, e.size, true)
    this.out(dd)
    this.central.push(centralEntry(e.name, crc, e.size, e.start, true))
    this.cur = null
  }
  finish() {
    this.end()
    const cenOffset = this.offset
    let cenSize = 0
    for (const c of this.central) {
      this.out(c)
      cenSize += c.length
    }
    this.out(endRecord(this.central.length, cenSize, cenOffset))
  }
}

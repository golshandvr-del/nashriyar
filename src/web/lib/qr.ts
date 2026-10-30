// Minimal QR Code encoder (ROADMAP phases 3 & 5): byte mode, error correction level M, versions 1–40.
// No dependencies and no network (CSP: no external resources). Algorithm follows ISO/IEC 18004
// (structure modelled on Project Nayuki's reference implementation, MIT).

const ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28]
const NUM_BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49]
const FORMAT_BITS_M = 0

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0

function rawDataModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2
    r -= (25 * n - 10) * n - 55
    if (ver >= 7) r -= 36
  }
  return r
}
const dataCodewords = (ver: number) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK_M[ver] * NUM_BLOCKS_M[ver]

function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}
function rsDivisor(degree: number): number[] {
  const r = new Array(degree).fill(0)
  r[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      r[j] = gfMul(r[j], root)
      if (j + 1 < degree) r[j] ^= r[j + 1]
    }
    root = gfMul(root, 0x02)
  }
  return r
}
function rsRemainder(data: number[], div: number[]): number[] {
  const r = new Array(div.length).fill(0)
  for (const b of data) {
    const f = b ^ (r.shift() as number)
    r.push(0)
    div.forEach((c, i) => (r[i] ^= gfMul(c, f)))
  }
  return r
}

export interface QrMatrix {
  size: number
  /** modules[y][x] — true = dark */
  modules: boolean[][]
}

/** Encode text (UTF-8) into a QR matrix. Throws if the text is too long (> ~2300 bytes). */
export function qrEncode(text: string, forceMask = -1): QrMatrix {
  const bytes = Array.from(new TextEncoder().encode(text))
  let ver = 1
  for (; ver <= 40; ver++) {
    const ccBits = ver <= 9 ? 8 : 16
    if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver) * 8) break
  }
  if (ver > 40) throw new Error('QR: data too long')

  // ── data bits ──
  const bits: number[] = []
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1)
  }
  put(0b0100, 4)
  put(bytes.length, ver <= 9 ? 8 : 16)
  bytes.forEach((b) => put(b, 8))
  const cap = dataCodewords(ver) * 8
  put(0, Math.min(4, cap - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))

  // ── error correction + interleave ──
  const numBlocks = NUM_BLOCKS_M[ver]
  const eccLen = ECC_PER_BLOCK_M[ver]
  const raw = Math.floor(rawDataModules(ver) / 8)
  const numShort = numBlocks - (raw % numBlocks)
  const shortLen = Math.floor(raw / numBlocks)
  const div = rsDivisor(eccLen)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1))
    k += dat.length
    const ecc = rsRemainder(dat, div)
    if (i < numShort) dat.push(0)
    blocks.push(dat.concat(ecc))
  }
  const codewords: number[] = []
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => {
      if (i !== shortLen - eccLen || j >= numShort) codewords.push(b[i])
    })
  }

  // ── matrix ──
  const size = ver * 4 + 17
  const mod: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false))
  const fn: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false))
  const setF = (x: number, y: number, dark: boolean) => {
    mod[y][x] = dark
    fn[y][x] = true
  }
  for (let i = 0; i < size; i++) {
    setF(6, i, i % 2 === 0)
    setF(i, 6, i % 2 === 0)
  }
  const finder = (x: number, y: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        const xx = x + dx
        const yy = y + dy
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setF(xx, yy, d !== 2 && d !== 4)
      }
  }
  finder(3, 3)
  finder(size - 4, 3)
  finder(3, size - 4)
  // alignment patterns
  if (ver > 1) {
    const n = Math.floor(ver / 7) + 2
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2
    const pos = [6]
    for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p)
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
      }
  }
  const drawFormat = (mask: number) => {
    const d = (FORMAT_BITS_M << 3) | mask
    let rem = d
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const b = ((d << 10) | rem) ^ 0x5412
    for (let i = 0; i <= 5; i++) setF(8, i, bit(b, i))
    setF(8, 7, bit(b, 6))
    setF(8, 8, bit(b, 7))
    setF(7, 8, bit(b, 8))
    for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(b, i))
    for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(b, i))
    for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(b, i))
    setF(8, size - 8, true)
  }
  drawFormat(0)
  if (ver >= 7) {
    let rem = ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const b = (ver << 12) | rem
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3)
      const c = Math.floor(i / 3)
      setF(a, c, bit(b, i))
      setF(c, a, bit(b, i))
    }
  }
  // codewords (zig-zag)
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const up = ((right + 1) & 2) === 0
        const y = up ? size - 1 - vert : vert
        if (!fn[y][x] && i < codewords.length * 8) {
          mod[y][x] = bit(codewords[i >>> 3], 7 - (i & 7))
          i++
        }
      }
  }

  const maskFn = (m: number, x: number, y: number) =>
    m === 0 ? (x + y) % 2 === 0
    : m === 1 ? y % 2 === 0
    : m === 2 ? x % 3 === 0
    : m === 3 ? (x + y) % 3 === 0
    : m === 4 ? (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
    : m === 5 ? ((x * y) % 2) + ((x * y) % 3) === 0
    : m === 6 ? (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
    : (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  const applyMask = (m: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && maskFn(m, x, y)) mod[y][x] = !mod[y][x]
  }
  // Simplified penalty (runs, 2×2 blocks, dark balance) — any mask is valid; this only aids scanning.
  const penalty = () => {
    let p = 0
    for (let a = 0; a < size; a++) {
      for (const horiz of [true, false]) {
        let run = 1
        for (let b = 1; b < size; b++) {
          const cur = horiz ? mod[a][b] : mod[b][a]
          const prev = horiz ? mod[a][b - 1] : mod[b - 1][a]
          if (cur === prev) {
            run++
            if (run === 5) p += 3
            else if (run > 5) p++
          } else run = 1
        }
      }
    }
    let dark = 0
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        if (mod[y][x]) dark++
        if (x < size - 1 && y < size - 1 && mod[y][x] === mod[y][x + 1] && mod[y][x] === mod[y + 1][x] && mod[y][x] === mod[y + 1][x + 1]) p += 3
      }
    const total = size * size
    p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
    return p
  }
  let best = forceMask
  if (best < 0) {
    let min = Infinity
    for (let m = 0; m < 8; m++) {
      applyMask(m)
      drawFormat(m)
      const pen = penalty()
      if (pen < min) {
        min = pen
        best = m
      }
      applyMask(m) // undo (XOR)
    }
  }
  applyMask(best)
  drawFormat(best)
  return { size, modules: mod }
}

/** SVG markup (with a 4-module quiet zone). Safe to inline: only numbers are interpolated. */
export function qrSvg(text: string, opts: { px?: number; dark?: string; light?: string } = {}): string {
  const { size, modules } = qrEncode(text)
  const q = 4
  const n = size + q * 2
  const px = opts.px ?? n * 4
  let d = ''
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) d += `M${x + q},${y + q}h1v1h-1z`
  const dark = /^#[0-9a-f]{3,8}$/i.test(opts.dark || '') ? opts.dark : '#000'
  const light = /^#[0-9a-f]{3,8}$/i.test(opts.light || '') ? opts.light : '#fff'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${px}" height="${px}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`
}

/** data: URL for <img src> (allowed by CSP img-src 'self' data:). */
export const qrDataUrl = (text: string, px?: number) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(qrSvg(text, { px }))

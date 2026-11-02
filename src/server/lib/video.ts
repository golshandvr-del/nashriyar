// Short videos in explore (ROADMAP phase 19): runtime-neutral helpers (Workers + Node).
//  - probeVideo(): duration and frame size straight from the container — MP4/MOV (`moov/mvhd` + `trak/tkhd`) and
//    WebM/Matroska (`Segment/Info/Duration` × `TimecodeScale`, `Tracks/TrackEntry/Video/PixelWidth|PixelHeight`) —
//    so the duration cap is enforced even where ffmpeg is unavailable (Cloudflare).
//  - videoConfig(): the duration cap (`video_max_seconds`, developer console; default 60 s, 5–180).
//  - publicVideo(): the shape of posts.video_json exposed to clients (HLS only once it is ready).
import type { Db } from '../adapters/db'
import { getSetting, parseJson } from './util'

export interface VideoProbe {
  /** seconds, null when the container does not say (e.g. a live-recorded WebM without a Duration element) */
  duration: number | null
  width: number | null
  height: number | null
}

export interface PostVideo {
  src: string
  duration: number
  w?: number | null
  h?: number | null
  hls?: string | null
  hls_state?: 'none' | 'pending' | 'ready' | 'failed'
}

export const VIDEO_MAX_DEFAULT = 60

export async function videoMaxSeconds(db: Db): Promise<number> {
  const v = Number(await getSetting(db, 'video_max_seconds', VIDEO_MAX_DEFAULT))
  return Number.isFinite(v) && v >= 5 ? Math.min(180, Math.round(v)) : VIDEO_MAX_DEFAULT
}

/** What clients see: source, poster comes from images[0]; HLS only when the transcode finished. */
export function publicVideo(json: string | null | undefined): { src: string; hls: string | null; duration: number; w: number | null; h: number | null } | null {
  const v = parseJson<PostVideo | null>(json, null)
  if (!v || typeof v.src !== 'string') return null
  return { src: v.src, hls: v.hls_state === 'ready' && v.hls ? v.hls : null, duration: Number(v.duration) || 0, w: v.w ?? null, h: v.h ?? null }
}

// ───────── MP4 / MOV (ISO BMFF) ─────────
const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
const u64 = (b: Uint8Array, i: number) => u32(b, i) * 2 ** 32 + u32(b, i + 4)
const fourcc = (b: Uint8Array, i: number) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3])

/** Iterates boxes in [start, end): yields {type, body start, body end}. Stops on malformed sizes. */
function* boxes(b: Uint8Array, start: number, end: number): Generator<{ type: string; s: number; e: number }> {
  let i = start
  while (i + 8 <= end) {
    let size = u32(b, i)
    const type = fourcc(b, i + 4)
    let hdr = 8
    if (size === 1) {
      if (i + 16 > end) return
      size = u64(b, i + 8)
      hdr = 16
    } else if (size === 0) size = end - i
    if (size < hdr || i + size > end) {
      // truncated last box: still allow looking inside what we have (moov is usually complete when present)
      if (size >= hdr) yield { type, s: i + hdr, e: end }
      return
    }
    yield { type, s: i + hdr, e: i + size }
    i += size
  }
}

function probeMp4(b: Uint8Array): VideoProbe {
  const out: VideoProbe = { duration: null, width: null, height: null }
  for (const top of boxes(b, 0, b.length)) {
    if (top.type !== 'moov') continue
    for (const m of boxes(b, top.s, top.e)) {
      if (m.type === 'mvhd' && m.e - m.s >= 20) {
        const v = b[m.s]
        const ts = v === 1 ? u32(b, m.s + 20) : u32(b, m.s + 12)
        const du = v === 1 ? u64(b, m.s + 24) : u32(b, m.s + 16)
        if (ts > 0 && du > 0 && du !== 0xffffffff) out.duration = Math.round((du / ts) * 100) / 100
      }
      if (m.type === 'trak' && out.width === null) {
        for (const t of boxes(b, m.s, m.e)) {
          if (t.type !== 'tkhd') continue
          const v = b[t.s]
          // fullbox(4) + times/ids (v0: 20, v1: 32) + reserved(8) + layer/group/volume/reserved(8) + matrix(36)
          const off = t.s + 4 + (v === 1 ? 32 : 20) + 8 + 8 + 36
          if (off + 8 <= t.e) {
            const w = u32(b, off) / 65536
            const h = u32(b, off + 4) / 65536
            if (w > 0 && h > 0) {
              out.width = Math.round(w)
              out.height = Math.round(h)
            }
          }
        }
      }
    }
  }
  return out
}

// ───────── WebM / Matroska (EBML) ─────────
function vint(b: Uint8Array, i: number, keepMarker: boolean): { v: number; len: number; unknown: boolean } | null {
  const first = b[i]
  if (first === undefined || first === 0) return null
  let len = 1
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++
  if (len > 8 || i + len > b.length) return null
  let v = keepMarker ? first : first & (0xff >> len)
  let allOnes = (first & (0xff >> len)) === 0xff >> len
  for (let k = 1; k < len; k++) {
    v = v * 256 + b[i + k]
    if (b[i + k] !== 0xff) allOnes = false
  }
  return { v, len, unknown: !keepMarker && allOnes }
}

const EBML = { Segment: 0x18538067, Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Duration: 0x4489, Tracks: 0x1654ae6b, TrackEntry: 0xae, Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba, Cluster: 0x1f43b675 }
const MASTERS = new Set([EBML.Segment, EBML.Info, EBML.Tracks, EBML.TrackEntry, EBML.Video])

function probeWebm(b: Uint8Array): VideoProbe {
  const out: VideoProbe = { duration: null, width: null, height: null }
  let scale = 1_000_000
  let rawDuration: number | null = null
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const walk = (start: number, end: number, depth: number) => {
    let i = start
    while (i < end && depth < 8) {
      const id = vint(b, i, true)
      if (!id) return
      const size = vint(b, i + id.len, false)
      if (!size) return
      const s = i + id.len + size.len
      const e = size.unknown ? end : Math.min(end, s + size.v)
      if (id.v === EBML.Cluster) return // media data starts: everything we need comes before it
      if (MASTERS.has(id.v)) walk(s, e, depth + 1)
      else if (id.v === EBML.TimecodeScale) {
        let n = 0
        for (let k = s; k < e; k++) n = n * 256 + b[k]
        if (n > 0) scale = n
      } else if (id.v === EBML.Duration) {
        if (e - s === 4) rawDuration = dv.getFloat32(s)
        else if (e - s === 8) rawDuration = dv.getFloat64(s)
      } else if ((id.v === EBML.PixelWidth || id.v === EBML.PixelHeight) && (id.v === EBML.PixelWidth ? out.width : out.height) === null) {
        let n = 0
        for (let k = s; k < e; k++) n = n * 256 + b[k]
        if (id.v === EBML.PixelWidth) out.width = n
        else out.height = n
      }
      if (size.unknown) return
      i = e
    }
  }
  // skip the EBML header element, then walk the Segment
  const hid = vint(b, 0, true)
  const hsz = hid && vint(b, hid.len, false)
  if (!hid || !hsz) return out
  walk(hid.len + hsz.len + hsz.v, b.length, 0)
  if (rawDuration !== null && rawDuration > 0) out.duration = Math.round(((rawDuration * scale) / 1e9) * 100) / 100
  return out
}

/** Reads duration / frame size from an MP4/MOV or WebM file (bytes already sniffed as video). */
export function probeVideo(b: Uint8Array): VideoProbe {
  try {
    if (b.length >= 12 && fourcc(b, 4) === 'ftyp') return probeMp4(b)
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return probeWebm(b)
  } catch {
    /* malformed container: unknown */
  }
  return { duration: null, width: null, height: null }
}

// Background processing of short explore videos (ROADMAP phase 19).
// When a transcoder is available (self-hosted + ffmpeg), a new video post is queued here after the response:
//   original upload ──ffmpeg──> pub/<pub>/<dir>/hls-<assetId>/{video.mp4, poster.jpg, seg-NNN.ts, index.m3u8}
// and posts.video_json is updated (src → normalised MP4, hls → playlist, hls_state → ready | failed).
// Without a transcoder (Cloudflare) hls_state stays 'none' and the uploaded MP4/WebM is played as is.
// Jobs run one at a time (a 60 s clip takes a few seconds; memory stays flat). Pending jobs lost to a restart are
// picked up again by resumePendingVideos() at startup.
import type { Deps } from '../context'
import { parseJson } from './util'
import { videoMaxSeconds, type PostVideo } from './video'

let chain: Promise<unknown> = Promise.resolve()

/** Storage directory of a video's renditions, derived from the original upload key (`.../post_video-<id>.<ext>`). */
export function hlsDirFor(srcKey: string): string | null {
  const m = /^(pub\/[^/]+\/.+?\/)post_video-([A-Za-z0-9_-]+)\.[a-z0-9]+$/.exec(srcKey)
  return m ? `${m[1]}hls-${m[2]}/` : null
}

/** Queues the transcode of one post; returns the job promise (callers hand it to waitUntil or simply let it run). */
export function queueVideoJob(deps: Deps, postId: string): Promise<void> {
  const job = chain.then(() => processVideoPost(deps, postId)).catch((e) => {
    console.error(JSON.stringify({ level: 'error', msg: 'video_job_failed', post: postId, error: String(e?.message || e).slice(0, 300) }))
  })
  chain = job
  return job
}

async function setVideo(deps: Deps, postId: string, v: PostVideo) {
  await deps.db.run('UPDATE posts SET video_json = ? WHERE id = ?', [JSON.stringify(v), postId])
}

export async function processVideoPost(deps: Deps, postId: string): Promise<void> {
  const tx = deps.video
  if (!tx) return
  const row = await deps.db.first<{ video_json: string | null }>('SELECT video_json FROM posts WHERE id = ?', [postId])
  const v = parseJson<PostVideo | null>(row?.video_json, null)
  if (!v || v.hls_state !== 'pending') return
  const original = v.orig || v.src
  const dir = hlsDirFor(original)
  if (!dir) return setVideo(deps, postId, { ...v, hls_state: 'failed' })
  try {
    const obj = await deps.storage.get(original)
    if (!obj) throw new Error('original upload missing')
    const bytes = obj.body instanceof Uint8Array ? obj.body : new Uint8Array(await new Response(obj.body as any).arrayBuffer())
    const written: string[] = []
    const res = await tx.transcode(bytes, {
      maxSeconds: await videoMaxSeconds(deps.db),
      onFile: async (f) => {
        await deps.storage.put(dir + f.name, f.bytes, f.mime)
        written.push(f.name)
      }
    })
    if (!written.includes('index.m3u8') || !written.includes('video.mp4')) throw new Error('transcoder produced no playlist')
    // the post may have been deleted meanwhile: then drop the renditions again
    const still = await deps.db.first<{ id: string }>('SELECT id FROM posts WHERE id = ?', [postId])
    if (!still) {
      for (const n of written) await deps.storage.delete(dir + n).catch(() => {})
      return
    }
    await setVideo(deps, postId, {
      ...v,
      orig: original,
      src: dir + 'video.mp4',
      hls: dir + 'index.m3u8',
      poster: written.includes('poster.jpg') ? dir + 'poster.jpg' : null,
      hls_state: 'ready',
      duration: res.duration ?? v.duration,
      w: res.width ?? v.w ?? null,
      h: res.height ?? v.h ?? null
    })
  } catch (e) {
    await setVideo(deps, postId, { ...v, hls_state: 'failed' })
    throw e
  }
}

/** Re-queues videos left 'pending' by a restart (Node entry calls this once at startup). */
export async function resumePendingVideos(deps: Deps): Promise<number> {
  if (!deps.video) return 0
  const rows = await deps.db.all<{ id: string }>(`SELECT id FROM posts WHERE kind = 'video' AND video_json LIKE '%"hls_state":"pending"%' LIMIT 200`)
  for (const r of rows) void queueVideoJob(deps, r.id)
  return rows.length
}

/** Storage keys owned by a video post (original + renditions), for deletion. */
export function videoKeys(json: string | null | undefined): string[] {
  const v = parseJson<PostVideo | null>(json, null)
  if (!v) return []
  return [v.orig, v.src, v.hls, v.poster].filter((k): k is string => typeof k === 'string' && k.length > 0)
}

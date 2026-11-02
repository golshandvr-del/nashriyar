// Server-side short-video processing with ffmpeg (ROADMAP phase 19 — short videos in explore).
// Node entry only (child_process + fs); never imported by the Cloudflare worker.
//  1. normalise: H.264 (yuv420p) + AAC MP4, faststart, longest side ≤ 1280 (720p), trimmed to the duration cap
//  2. HLS: the normalised MP4 is cut (stream copy, no second encode) into ~4 s MPEG-TS segments + index.m3u8
//  3. poster: one JPEG frame (at 1 s, or the first frame of very short clips)
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { VideoTranscoder } from '../context'

function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr: String(stderr || '').slice(-2000) }))
      else resolve(String(stdout))
    })
  })
}

/** Returns a transcoder when ffmpeg + ffprobe are installed, otherwise null (videos are then served as uploaded). */
export async function ffmpegTranscoder(): Promise<VideoTranscoder | null> {
  try {
    await run('ffmpeg', ['-version'], 5000)
    await run('ffprobe', ['-version'], 5000)
  } catch {
    return null
  }
  return {
    name: 'ffmpeg',
    async transcode(input, { maxSeconds, onFile }) {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nsh-vid-'))
      const src = path.join(dir, 'in.bin')
      const mp4 = path.join(dir, 'video.mp4')
      const hls = path.join(dir, 'hls')
      try {
        await fs.promises.writeFile(src, input)
        await fs.promises.mkdir(hls)
        const probe = async (file: string) => {
          const j = JSON.parse(await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], 30_000))
          const v = (j.streams || []).find((s: any) => s.codec_type === 'video')
          const a = (j.streams || []).find((s: any) => s.codec_type === 'audio')
          const d = Number(j.format?.duration)
          return { video: !!v, audio: !!a, duration: Number.isFinite(d) ? d : null, width: v ? Number(v.width) || null : null, height: v ? Number(v.height) || null : null }
        }
        const info = await probe(src)
        if (!info.video) throw new Error('فایل جریان تصویری ندارد')
        // 1. normalise (even dimensions for yuv420p; scale down only)
        await run(
          'ffmpeg',
          [
            '-v', 'error', '-y', '-i', src, '-t', String(maxSeconds),
            '-map', '0:v:0', ...(info.audio ? ['-map', '0:a:0'] : []),
            '-vf', "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))',scale=trunc(iw/2)*2:trunc(ih/2)*2",
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-profile:v', 'main',
            // a keyframe every 2 s so HLS segments cut cleanly
            '-force_key_frames', 'expr:gte(t,n_forced*2)',
            ...(info.audio ? ['-c:a', 'aac', '-b:a', '96k', '-ac', '2'] : ['-an']),
            '-movflags', '+faststart', mp4
          ],
          10 * 60_000
        )
        const out = await probe(mp4)
        // 2. HLS by stream copy
        await run(
          'ffmpeg',
          ['-v', 'error', '-y', '-i', mp4, '-c', 'copy', '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_segment_filename', path.join(hls, 'seg-%03d.ts'), path.join(hls, 'index.m3u8')],
          5 * 60_000
        )
        // 3. poster frame
        const at = out.duration !== null && out.duration > 2 ? '1' : '0'
        await run('ffmpeg', ['-v', 'error', '-y', '-ss', at, '-i', mp4, '-frames:v', '1', '-q:v', '4', path.join(dir, 'poster.jpg')], 60_000)

        await onFile({ name: 'video.mp4', bytes: new Uint8Array(await fs.promises.readFile(mp4)), mime: 'video/mp4' })
        await onFile({ name: 'poster.jpg', bytes: new Uint8Array(await fs.promises.readFile(path.join(dir, 'poster.jpg'))), mime: 'image/jpeg' })
        const segs = (await fs.promises.readdir(hls)).filter((f) => /^seg-\d{3}\.ts$/.test(f)).sort()
        for (const f of segs) await onFile({ name: f, bytes: new Uint8Array(await fs.promises.readFile(path.join(hls, f))), mime: 'video/mp2t' })
        // the playlist last, so a reader never sees it before all of its segments exist
        await onFile({ name: 'index.m3u8', bytes: new Uint8Array(await fs.promises.readFile(path.join(hls, 'index.m3u8'))), mime: 'application/vnd.apple.mpegurl' })
        return { duration: out.duration, width: out.width, height: out.height }
      } finally {
        await fs.promises.rm(dir, { recursive: true, force: true })
      }
    }
  }
}

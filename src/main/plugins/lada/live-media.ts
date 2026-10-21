/**
 * 「边跑边看」的媒体层：切分片、读分片时长、原子写播放列表、本机 HTTP 服务。
 *
 * 三个坑（都实测踩过）：
 *  1. 播放列表必须标 #EXT-X-PLAYLIST-TYPE:EVENT，并且**原子写**（否则播放器会读到半截）
 *  2. 分片时间戳必须**连续**（用 -copyts），一旦每个分片从 0 开始就会反复播同一段
 *  3. 本地文件路径的 HLS 在 Windows 上走不通 → 起一个只绑 127.0.0.1 的 HTTP 服务
 */
import {
  createReadStream,
  existsSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { type Server, createServer } from 'node:http'
import { join } from 'node:path'
import type { LadaLiveState } from '../../../shared/lada'
import { runTool } from '../process'
import {
  buildPlaylist,
  isServableName,
  parseSegmentProbe,
  segmentName,
} from './rules'

/** 一次追播会话 */
export interface LiveSession {
  input: string
  output: string
  tempVideo: string
  workDir: string
  playlist: string
  /** 已发布的分片：名字 + **实测**时长（EXTINF 必须写实测值，不能写请求值） */
  segments: { name: string; duration: number }[]
  nextStart: number
  port: number
  state: LadaLiveState
  error?: string
  server: Server | null
  timer?: ReturnType<typeof setTimeout>
  stopping: boolean
}

/** 太小的分片视为没切出来 */
const MIN_SEGMENT_BYTES = 8 * 1024

/** 读取一段媒体的起始时间与时长（用来判断分片是否切全、以及推进游标） */
export async function probeSegment(
  ffprobe: string,
  file: string
): Promise<{ start: number; duration: number } | null> {
  const { code, out } = await runTool(ffprobe, [
    '-v',
    'error',
    '-show_entries',
    'format=start_time,duration',
    '-of',
    'default=noprint_wrappers=1',
    file,
  ])
  if (code !== 0) return null
  return parseSegmentProbe(out)
}

/** 原子写播放列表：EVENT 表示"只增不减"，正是边处理边看的语义 */
export function writePlaylist(s: LiveSession, ended: boolean): void {
  const body = buildPlaylist(s.segments, ended)
  // 播放器正在轮询这个文件时，Windows 上 rename 可能被拒（EBUSY/EPERM）→ 重试，
  // 最后一次退化为直接覆写。绝不能因为写播放列表失败就把追播链断掉。
  const tmp = `${s.playlist}.tmp`
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      writeFileSync(tmp, body)
      renameSync(tmp, s.playlist)
      return
    } catch {
      // 稍后重试
    }
  }
  try {
    rmSync(tmp, { force: true })
  } catch {
    /* ignore */
  }
  writeFileSync(s.playlist, body)
}

const tooSmall = (file: string): boolean =>
  !existsSync(file) || statSync(file).size < MIN_SEGMENT_BYTES

/**
 * 切一个分片。分两趟走：
 *   1) 只从"增长中的半成品"切视频 —— 但 `-c copy` 只能落在关键帧上，实际起点会往后偏
 *   2) 用**实测出来的真实起点/时长**去原片切音频，再封装
 * 这样音频严格跟随视频的实际区间，而不是"我请求的区间"——否则每个分片内音画会差
 * 最多一个 GOP（实测能看到 0.2 秒级偏移）。
 * `-copyts` 保持时间戳连续，避免播放器反复播同一段。
 */
export async function cutSegment(
  s: LiveSession,
  ffmpeg: string,
  ffprobe: string,
  index: number,
  start: number,
  end: number
): Promise<string | null> {
  const name = segmentName(index)
  const file = join(s.workDir, name)
  const videoOnly = join(s.workDir, `${name}.v.ts`)
  rmSync(file, { force: true })
  rmSync(videoOnly, { force: true })

  const cut = await runTool(ffmpeg, [
    '-y',
    '-loglevel',
    'error',
    '-ss',
    start.toFixed(3),
    '-to',
    end.toFixed(3),
    '-i',
    s.tempVideo,
    '-an',
    '-c',
    'copy',
    '-copyts',
    '-f',
    'mpegts',
    videoOnly,
  ])
  if (cut.code !== 0 || tooSmall(videoOnly)) {
    rmSync(videoOnly, { force: true })
    return null
  }
  const info = await probeSegment(ffprobe, videoOnly)
  if (!info) {
    rmSync(videoOnly, { force: true })
    return null
  }

  const audioTo = info.start + info.duration
  const mux = await runTool(ffmpeg, [
    '-y',
    '-loglevel',
    'error',
    '-ss',
    info.start.toFixed(3),
    '-to',
    audioTo.toFixed(3),
    '-i',
    s.input,
    '-i',
    videoOnly,
    '-map',
    '1:v:0',
    '-map',
    '0:a:0',
    '-c',
    'copy',
    '-copyts',
    '-f',
    'mpegts',
    file,
  ])
  rmSync(videoOnly, { force: true })
  if (mux.code !== 0 || tooSmall(file)) {
    rmSync(file, { force: true })
    return null
  }
  return name
}

/** 起只绑 127.0.0.1 的 HTTP 服务，只放行会话目录里的播放列表和分片；返回端口 */
export function serve(s: LiveSession): Promise<number> {
  const server = createServer((req, res) => {
    const name = decodeURIComponent((req.url || '/').split('?')[0]).replace(
      /^\//,
      ''
    )
    // Node 的 res.end() 返回 this，直接 return 会触发 "not all code paths return a value"
    if (name && !isServableName(name)) {
      res.statusCode = 400
      res.end()
      return
    }
    const file = join(s.workDir, name || 'index.m3u8')
    if (!file.startsWith(s.workDir) || !existsSync(file)) {
      res.statusCode = 404
      res.end()
      return
    }
    res.setHeader(
      'Content-Type',
      name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t'
    )
    res.setHeader('Cache-Control', 'no-store')
    createReadStream(file).pipe(res)
  })
  s.server = server
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
}

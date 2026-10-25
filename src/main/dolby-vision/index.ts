/**
 * 杜比视界应用内播放（主进程）：实现 dolbyVision 域。
 *
 * probe.ts 开播前读动态范围（解析与媒体库共用 shared/video-range）与片长 / 尺寸，capability.ts 探测 libplacebo / Vulkan / 编码器，
 * filters.ts 构造滤镜与编码参数，playlist.ts 管分片调度，encoder.ts 启停编码器，transcode.ts 管会话与本机 HLS 服务。
 * ffmpeg / ffprobe 沿用去码插件的定位（ladaPaths / ffprobeFor），用户改工具路径时作废路径、能力与识别缓存。
 *
 * 并发开播按到达顺序编号，只有最新的一次能留下会话：较早的请求在任何一步发现自己过时，
 * 就停掉自己刚建的会话并返回 superseded，不会停掉新请求的会话。
 */
import { promises as fs } from 'node:fs'
import { isAbsolute } from 'node:path'

import type { DvStartRequest, DvStartResult } from '../../shared/dolby-vision'
import { dolbyVision } from '../../shared/contract/dolby-vision'
import { needsDvColorFix } from '../../shared/video-range'
import { createFfmpegCache } from '../capture/ffmpeg-cache'
import { registerPlugin } from '../plugins/host'
import {
  ffprobeFor,
  ladaPaths,
  onPathOverridesChange,
} from '../plugins/lada/tools'
import { implement } from '../rpc'

import { createCapabilityCache, pickOutput } from './capability'
import { type RebuildProbe, probeForRebuild } from './probe'
import { runWithTimeout } from './tool'
import {
  sessionRunning,
  startSession,
  stopSession,
  sweepLeftovers,
} from './transcode'

/** 没找到 ffmpeg 时多久内不再重新探测（路径探测是同步的） */
const FFMPEG_RETRY_MS = 60_000
/** 识别结果最多缓存多少个文件 */
const PROBE_CACHE_LIMIT = 200

const ffmpegCache = createFfmpegCache(() => ladaPaths().ffmpeg, FFMPEG_RETRY_MS)
const capabilities = createCapabilityCache(runWithTimeout)

/** 识别结果缓存：键为路径 + 大小 + 修改时间，文件变了自然失效；只存 ffprobe 成功跑完的结果。 */
const probeCache = new Map<string, RebuildProbe | null>()

/** 识别本地文件；不是存在的绝对路径普通文件、或这次没探测成功，返回 null。 */
async function probeFile(filePath: string): Promise<RebuildProbe | null> {
  if (!isAbsolute(filePath) || filePath.includes('://')) return null
  const stat = await fs.stat(filePath).catch(() => null)
  if (!stat?.isFile()) return null
  const key = `${filePath}\n${stat.size}\n${stat.mtimeMs}`
  if (probeCache.has(key)) return probeCache.get(key) ?? null
  const ffmpeg = ffmpegCache.get()
  if (!ffmpeg) return null
  const info = await probeForRebuild(filePath, ffprobeFor(ffmpeg))
  // ffprobe 缺失 / 超时 / 输出不完整：不缓存，下次开播重探
  if (info === undefined) return null
  if (probeCache.size >= PROBE_CACHE_LIMIT) {
    const oldest = probeCache.keys().next().value
    if (oldest !== undefined) probeCache.delete(oldest)
  }
  probeCache.set(key, info)
  return info
}

/** 开播请求的编号：只有最新的一次能留下会话 */
let latestStart = 0

/** 过时请求的回复（渲染层此时已不再等它） */
const SUPERSEDED: DvStartResult = { kind: 'fallback', reason: 'superseded' }

/** 开一路重建播放：识别 → 能力 → 选输出与编码器 → 起会话；任何一步不满足都给 fallback。 */
async function start(request: DvStartRequest): Promise<DvStartResult> {
  const ticket = ++latestStart
  const stale = (): boolean => ticket !== latestStart
  const info = await probeFile(request.filePath)
  if (stale()) return SUPERSEDED
  // 与媒体库 / 打开播放器时同一条判定（ADR-0016）：只有 P5 这类直接放偏色的才重建
  if (!info || !needsDvColorFix(info.video))
    return { kind: 'fallback', reason: '没能识别出需要重建的杜比视界' }
  if (!info.duration)
    return { kind: 'fallback', reason: '读不到片长，无法在应用内重建杜比视界' }
  const ffmpeg = ffmpegCache.get()
  const cap = await capabilities.get(ffmpeg, request.output)
  if (stale()) return SUPERSEDED
  if (!cap.ok) return { kind: 'fallback', reason: cap.message }
  const picked = pickOutput(cap, request.output)
  if (!picked)
    return {
      kind: 'fallback',
      reason: '没有可用的视频编码器，无法在应用内重建杜比视界',
    }
  try {
    const session = await startSession({
      input: request.filePath,
      ffmpeg: cap.ffmpeg,
      encoder: picked.encoder,
      output: picked.output,
      applyDolbyVision: request.applyDolbyVision,
      duration: info.duration,
      width: info.width,
      height: info.height,
      startAt: request.startAt ?? 0,
    })
    if (stale()) {
      await stopSession(session.id)
      return SUPERSEDED
    }
    return { kind: 'stream', ...session }
  } catch (error) {
    console.error('[dolby-vision] 开播失败：', error)
    return { kind: 'fallback', reason: '杜比视界重建启动失败' }
  }
}

/** 注册 dolbyVision 域，并登记为插件（退出时停掉编码器、删分片）；启动时清扫上次留下的分片目录。 */
export function registerDolbyVisionIpc(): void {
  onPathOverridesChange(() => {
    ffmpegCache.invalidate()
    capabilities.invalidate()
    probeCache.clear()
  })
  void sweepLeftovers()
  implement(dolbyVision, {
    probe: async (_, filePath) => (await probeFile(filePath))?.video ?? null,
    start: (_, request) => start(request),
    stop: (_, id) => stopSession(id),
  })
  registerPlugin({
    id: 'dolby-vision',
    stop: async () => {
      await stopSession()
    },
    health: () => ({ running: sessionRunning() }),
  })
}

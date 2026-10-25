/**
 * 用 ffmpeg 从视频里取一帧：同一次解码分两路输出——224×224 RGBA 原始像素走标准输出（直接喂 CLIP，
 * 与图片的拉伸规则一致），宽 FRAME_THUMB_WIDTH 的小 JPEG 写到给定路径（结果展示用）。不落大图。
 *
 * - 输入端 -ss：先跳到最近的关键帧再精确解到目标时间，每帧只解几十帧，不必解整部；
 * - 单线程、子进程调到低优先级，不和前台播放抢 CPU；
 * - ffmpeg 路径由宿主给（桌面端向主进程要，见 tools-host.ts；独立服务读 YINGBOX_FFMPEG / PATH）。
 */
import { execFile, spawn } from 'node:child_process'
import { constants, setPriority } from 'node:os'
import { CLIP_IMAGE_SIZE } from '../clip-encoder'
import { FRAME_THUMB_WIDTH, parseFfmpegDuration } from './frame-rules'

/** 一帧原始像素的字节数。 */
export const FRAME_BYTES = CLIP_IMAGE_SIZE * CLIP_IMAGE_SIZE * 4
/** 单帧时限：网络盘上跳转可能较慢。 */
const FRAME_TIMEOUT_MS = 60_000
/** 读时长的时限。 */
const PROBE_TIMEOUT_MS = 20_000

/** 找不到 ffmpeg（起进程 ENOENT）：整轮停下。 */
export class FfmpegMissingError extends Error {
  override name = 'FfmpegMissingError'
}

/** 取一帧的 ffmpeg 参数（纯函数，便于单测）。 */
export function frameArgs(
  input: string,
  atSec: number,
  thumbPath: string
): string[] {
  const s = CLIP_IMAGE_SIZE
  const graph = [
    '[0:v:0]split=2[c][t]',
    `[c]scale=${s}:${s}:flags=bilinear,format=rgba[clip]`,
    `[t]scale=${FRAME_THUMB_WIDTH}:-2[thumb]`,
  ].join(';')
  return [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-threads',
    '1',
    '-ss',
    atSec.toFixed(3),
    '-i',
    input,
    '-an',
    '-sn',
    '-dn',
    '-filter_complex',
    graph,
    '-map',
    '[clip]',
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    'pipe:1',
    '-map',
    '[thumb]',
    '-frames:v',
    '1',
    '-q:v',
    '6',
    '-f',
    'image2',
    '-update',
    '1',
    '-y',
    thumbPath,
  ]
}

const lowerPriority = (pid: number | undefined): void => {
  if (pid === undefined) return
  try {
    setPriority(pid, constants.priority.PRIORITY_LOW)
  } catch {
    // 没有权限调优先级：照常跑
  }
}

/**
 * 取一帧：成功返回 224×224 RGBA（缩略图已写到 thumbPath）；这一帧取不到（超出片长、解码失败）返回 null。
 * 找不到 ffmpeg 抛 FfmpegMissingError；取消时杀掉子进程并抛出取消原因。
 */
export function extractFrame(
  bin: string,
  input: string,
  atSec: number,
  thumbPath: string,
  signal: AbortSignal
): Promise<Uint8Array | null> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(bin, frameArgs(input, atSec, thumbPath), {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
    lowerPriority(child.pid)
    const chunks: Buffer[] = []
    let size = 0
    child.stdout.on('data', (chunk: Buffer) => {
      if (size < FRAME_BYTES) chunks.push(chunk)
      size += chunk.length
    })
    const kill = (): void => {
      child.kill()
    }
    signal.addEventListener('abort', kill, { once: true })
    const timer = setTimeout(kill, FRAME_TIMEOUT_MS)
    timer.unref?.()
    const settle = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', kill)
    }
    child.once('error', error => {
      settle()
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        reject(new FfmpegMissingError('没有找到 ffmpeg'))
      else resolve(null)
    })
    child.once('close', code => {
      settle()
      if (signal.aborted) {
        reject(signal.reason)
        return
      }
      if (code !== 0 || size < FRAME_BYTES) {
        resolve(null)
        return
      }
      resolve(new Uint8Array(Buffer.concat(chunks).subarray(0, FRAME_BYTES)))
    })
  })
}

/** 用 ffmpeg -i 读时长（秒）；读不到返回 null，找不到 ffmpeg 抛 FfmpegMissingError。 */
export function ffmpegDuration(
  bin: string,
  input: string
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      ['-nostdin', '-hide_banner', '-i', input],
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true },
      // 只给 -i 没有输出，ffmpeg 总是非零退出；时长在 stderr 里
      (error, _stdout, stderr) => {
        if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
          reject(new FfmpegMissingError('没有找到 ffmpeg'))
          return
        }
        resolve(parseFfmpegDuration(String(stderr)))
      }
    )
  })
}

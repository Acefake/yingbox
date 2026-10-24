/**
 * 截图与 GIF 的主进程实现：PNG 落盘、ffmpeg 截帧 / 生成 GIF、在文件夹中显示。
 * 文件统一写到「图片/影盒」；ffmpeg 沿用仓库现有的探测方式（YINGBOX_FFMPEG → 用户覆盖 → PATH → 常见安装位置）。
 */
import { app, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, extname, join } from 'node:path'

import { localUrlToFilePath } from '../local-media'
import { ladaPaths } from '../plugins/lada/tools'
import { runTool } from '../plugins/process'
import { implement } from '../rpc'
import { type CaptureResult, capture } from '../../shared/contract/capture'
import {
  CAPTURE_DIR_NAME,
  captureFileName,
  ffmpegError,
  frameArgs,
  gifArgs,
  gifWindow,
  isInsideDir,
  isPng,
  numberedName,
} from './rules'

/** 没找到 ffmpeg 时多久内不再重新探测（探测是同步的，会卡主进程） */
const FFMPEG_RETRY_MS = 60_000

let ffmpegCache: { path: string; at: number } | null = null

/** 当前可用的 ffmpeg；找不到返回空串（失败结果缓存一分钟） */
function ffmpegPath(): string {
  const now = Date.now()
  if (
    ffmpegCache &&
    (ffmpegCache.path || now - ffmpegCache.at < FFMPEG_RETRY_MS)
  ) {
    return ffmpegCache.path
  }
  let path = ''
  try {
    path = ladaPaths().ffmpeg
  } catch {
    path = ''
  }
  ffmpegCache = { path, at: now }
  return path
}

/** 截图目录（不存在就建） */
async function captureDir(): Promise<string> {
  const dir = join(app.getPath('pictures'), CAPTURE_DIR_NAME)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

/** 目录里一个还没被占用的文件路径 */
async function freePath(dir: string, fileName: string): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const candidate = join(dir, n === 1 ? fileName : numberedName(fileName, n))
    try {
      await fs.access(candidate)
    } catch {
      return candidate
    }
  }
  return join(dir, numberedName(fileName, Date.now()))
}

/** local:// 地址 → 视频路径与片名（文件名去扩展名） */
function localSource(localUrl: string): { file: string; name: string } | null {
  const file = localUrlToFilePath(localUrl)
  if (!file) return null
  return { file, name: basename(file, extname(file)) }
}

/** 跑 ffmpeg 输出到 target；失败时删掉残留文件 */
async function runFfmpeg(
  args: string[],
  target: string
): Promise<CaptureResult> {
  const bin = ffmpegPath()
  if (!bin) return { success: false, error: '没有找到 ffmpeg' }
  const result = await runTool(bin, args)
  if (result.code === 0) {
    try {
      const stat = await fs.stat(target)
      if (stat.size > 0) return { success: true, path: target }
    } catch {
      /* 没生成文件，按失败处理 */
    }
  }
  await fs.rm(target, { force: true }).catch(() => {})
  return { success: false, error: ffmpegError(result.out) }
}

/** 实现 capture 域 */
export function registerCaptureIpc(): void {
  implement(capture, {
    savePng: async (_, data, name, time) => {
      if (!isPng(data)) return { success: false, error: '截图数据无效' }
      try {
        const dir = await captureDir()
        const target = await freePath(
          dir,
          captureFileName(name, time, new Date(), 'png')
        )
        await fs.writeFile(target, data)
        return { success: true, path: target }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    },

    frame: async (_, localUrl, time) => {
      const source = localSource(localUrl)
      if (!source) return { success: false, error: '只支持本地文件' }
      try {
        const dir = await captureDir()
        const target = await freePath(
          dir,
          captureFileName(source.name, time, new Date(), 'png')
        )
        return await runFfmpeg(frameArgs(source.file, time, target), target)
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    },

    gifAvailable: () => Boolean(ffmpegPath()),

    gif: async (_, localUrl, center) => {
      const source = localSource(localUrl)
      if (!source) return { success: false, error: '只支持本地文件' }
      try {
        const dir = await captureDir()
        const target = await freePath(
          dir,
          captureFileName(source.name, center, new Date(), 'gif')
        )
        const { start, length } = gifWindow(center)
        return await runFfmpeg(
          gifArgs(source.file, start, length, target),
          target
        )
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    },

    reveal: async (_, filePath) => {
      const dir = join(app.getPath('pictures'), CAPTURE_DIR_NAME)
      if (!isInsideDir(dir, filePath)) {
        return { success: false, error: '只能显示截图目录里的文件' }
      }
      shell.showItemInFolder(filePath)
      return { success: true }
    },
  })
}

/**
 * 自动检测片头片尾（主进程）：实现 introDetect 域。
 *
 * 职责拆分：match（指纹比对）/ vote（多集投票）/ pcm-print（退回方案指纹）/ ffmpeg（取指纹）/
 * detector（检测一季）/ queue（一次一季、可取消）。
 * ffmpeg 沿用去码插件的定位（ladaPaths）；找不到时 status 报不可用，渲染层据此禁用入口。
 * 只接受本地文件：路径须为绝对路径且是存在的普通文件。
 */
import { promises as fs } from 'node:fs'
import { isAbsolute } from 'node:path'

import {
  type IntroDetectRequest,
  type IntroDetectResult,
  type IntroDetectStatus,
  introDetect,
} from '../../shared/contract/intro-detect'
import { registerPlugin } from '../plugins/host'
import { ladaPaths } from '../plugins/lada'
import { emit, implement } from '../rpc'
import { type PrintMethod, hasChromaprint } from './ffmpeg'
import { detectSeason } from './detector'
import { createDetectQueue } from './queue'

/** 找 ffmpeg 并确定指纹算法；找不到返回 null */
async function probe(): Promise<{
  ffmpeg: string
  method: PrintMethod
} | null> {
  const ffmpeg = ladaPaths().ffmpeg
  if (!ffmpeg) return null
  return {
    ffmpeg,
    method: (await hasChromaprint(ffmpeg)) ? 'chromaprint' : 'pcm',
  }
}

async function status(): Promise<IntroDetectStatus> {
  const tool = await probe()
  return tool
    ? { available: true, method: tool.method }
    : { available: false, reason: '没有找到 ffmpeg，安装后即可检测片头片尾' }
}

/** 本地普通文件才检测（在线流、目录、不存在的都剔除） */
async function localFiles(files: readonly string[]): Promise<string[]> {
  const out: string[] = []
  for (const file of files) {
    if (!isAbsolute(file) || file.includes('://')) continue
    try {
      if ((await fs.stat(file)).isFile()) out.push(file)
    } catch {
      /* 不存在的跳过 */
    }
  }
  return out
}

async function run(
  request: IntroDetectRequest,
  signal: AbortSignal,
  onStep: (done: number, total: number) => void
): Promise<IntroDetectResult> {
  const { key } = request
  const tool = await probe()
  if (!tool)
    return { key, success: false, error: '没有找到 ffmpeg，无法检测片头片尾' }
  const files = await localFiles(request.files)
  if (files.length < 2)
    return { key, success: false, error: '本季可用的本地文件不足两集' }
  const outcome = await detectSeason(
    tool.ffmpeg,
    tool.method,
    files,
    signal,
    onStep
  )
  if (!outcome) return { key, success: false, cancelled: true }
  if (outcome.analyzed < 2)
    return {
      key,
      success: false,
      analyzed: outcome.analyzed,
      method: tool.method,
      error: '能读出音轨的集不足两集',
    }
  return { key, success: true, method: tool.method, ...outcome }
}

/** 注册 introDetect 域，并登记到插件宿主（退出时取消检测、杀掉 ffmpeg）。 */
export function registerIntroDetectIpc(): void {
  const queue = createDetectQueue({
    run,
    onProgress: progress => emit(introDetect, 'progress', progress),
  })
  registerPlugin({
    id: 'intro-detect',
    stop: () => queue.cancelAll(),
    health: () => ({
      running: queue.busy(),
      detail: queue.busy() ? '正在检测片头片尾' : undefined,
    }),
  })
  implement(introDetect, {
    status: () => status(),
    detect: (_, request) => queue.enqueue(request),
    cancel: (_, key) => queue.cancel(key),
  })
}

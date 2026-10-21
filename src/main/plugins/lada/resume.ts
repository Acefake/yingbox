/**
 * 去码的「暂停 / 继续」（缓存 + 续跑）。
 *
 * 背景：lada 命令行**没有**续跑选项，只能整片跑。所以续跑由影盒实现：
 *   1. 每处理一段就把**已完成秒数**记进进度文件，并把那段修复好的视频留在缓存目录
 *   2. 「继续」时把源片从已完成秒数处裁出剩余部分（-c copy，很快），只让 lada 处理剩余
 *   3. 剩余部分跑完后，把各段拼起来，再从原片补上音轨，产出最终的 .restored.mp4
 *
 * 代价：段边界可能有一帧级瑕疵；分段处理的时域稳定性略逊于整片一次跑。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { type LadaResumeProgress, restoredPathFor } from '../../../shared/lada'
import { runTool } from '../process'
import {
  dirFor,
  durationOf,
  partPath,
  partsOf,
  readProgress,
  writeProgress,
} from './cache'
import { onJobFinished, startJob } from './job'
import { ENCODING_PRESET, classifyTempEntry, durationMismatch } from './rules'
import { tempDirPath } from './temp'
import { ffprobeFor, ladaPaths } from './tools'

interface Running {
  input: string
  output: string
  remainder: string
  trimStart: number
}

let running: Running | null = null

/** 一次性提示（界面没有订阅方，只写日志） */
export function notify(text: string): void {
  console.warn(`[lada] ${text}`)
}

/**
 * 把一份"半成品"视频收进缓存目录当作最新的一段，并更新进度。
 * 用于接管 lada 自己写在 %TEMP% 里的临时文件（比如上次被中断的那个）。
 */
export async function adoptPartial(
  input: string,
  partialFile: string
): Promise<LadaResumeProgress | null> {
  const { ffmpeg } = ladaPaths()
  if (!ffmpeg) return null
  const ffprobe = ffprobeFor(ffmpeg)
  if (!existsSync(partialFile)) return null
  const done = await durationOf(ffprobe, partialFile)
  if (!done || done < 2) return null
  mkdirSync(dirFor(input), { recursive: true })
  const existing = partsOf(input)
  const target = partPath(input, existing.length)
  try {
    copyFileSync(partialFile, target)
  } catch {
    return null
  }
  const progress: LadaResumeProgress = {
    input,
    doneSeconds: done,
    parts: existing.length + 1,
    preset: ENCODING_PRESET,
    updatedAt: Date.now(),
  }
  writeProgress(progress)
  return progress
}

/** 剩余部分跑完后：拼段 + 补音轨 → 最终 .restored.mp4 */
async function assemble(input: string, output: string): Promise<void> {
  const { ffmpeg } = ladaPaths()
  if (!ffmpeg) throw new Error('没找到 ffmpeg')
  const dir = dirFor(input)
  const parts = partsOf(input)
  if (!parts.length) throw new Error('没有可拼接的分段')

  // 各段先转成 MPEG-TS 再拼。TS 用统一的 90kHz 时间基，能容忍各段 time_base
  // 不同；直接 concat mp4 在 time_base 不一致时会算错时长（实测 40 秒拼出 77 秒）。
  // 只取视频轨——音轨最后统一从原片补，避免"有的段有音轨、有的没有"。
  const tsFiles: string[] = []
  for (const part of parts) {
    const ts = `${part}.ts`
    rmSync(ts, { force: true })
    const convert = await runTool(ffmpeg, [
      '-y',
      '-loglevel',
      'error',
      '-i',
      part,
      '-map',
      '0:v:0',
      '-c',
      'copy',
      '-bsf:v',
      'hevc_mp4toannexb',
      '-f',
      'mpegts',
      ts,
    ])
    if (convert.code !== 0 || !existsSync(ts)) {
      throw new Error(`分段转 TS 失败：${convert.out.slice(-200)}`)
    }
    tsFiles.push(ts)
  }

  const videoOnly = join(dir, 'joined.mp4')
  const join1 = await runTool(ffmpeg, [
    '-y',
    '-loglevel',
    'error',
    '-i',
    `concat:${tsFiles.join('|')}`,
    '-c',
    'copy',
    videoOnly,
  ])
  for (const ts of tsFiles) rmSync(ts, { force: true })
  if (join1.code !== 0 || !existsSync(videoOnly))
    throw new Error(`拼接视频失败：${join1.out.slice(-200)}`)

  // 用原片的音轨补上
  const final = await runTool(ffmpeg, [
    '-y',
    '-loglevel',
    'error',
    '-i',
    videoOnly,
    '-i',
    input,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0?',
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    output,
  ])
  rmSync(videoOnly, { force: true })
  if (final.code !== 0)
    throw new Error(`合并音轨失败：${final.out.slice(-200)}`)

  // 收尾自检：拼出来的时长应接近源片；差太多说明拼接有问题，别把坏文件留给用户
  const ffprobe = ffprobeFor(ffmpeg)
  const [done, whole] = await Promise.all([
    durationOf(ffprobe, output),
    durationOf(ffprobe, input),
  ])
  if (done && whole && durationMismatch(done, whole)) {
    throw new Error(
      `拼接结果时长异常（${done.toFixed(0)} 秒 vs 源片 ${whole.toFixed(0)} 秒）`
    )
  }
  // 成功后清掉缓存，避免堆积
  rmSync(dir, { recursive: true, force: true })
}

/** 「继续」：裁出剩余部分 → 交给 lada → 跑完自动拼接 */
export async function resume(
  input: unknown
): Promise<{ success: boolean; error?: string; doneSeconds?: number }> {
  try {
    if (running) throw new Error('已经有一个续跑在进行中')
    if (typeof input !== 'string' || !input.trim())
      throw new Error('缺少文件路径')
    const file = input.trim()
    if (!existsSync(file)) throw new Error('文件不存在')
    const progress = readProgress(file)
    if (!progress) throw new Error('这部片子没有可继续的进度')
    const { ffmpeg } = ladaPaths()
    if (!ffmpeg) throw new Error('没找到 ffmpeg')

    const dir = dirFor(file)
    const remainder = join(dir, `rest-${Date.now()}.mp4`)
    // -c copy 裁出剩余部分：很快，不重新编码
    const trim = await runTool(ffmpeg, [
      '-y',
      '-loglevel',
      'error',
      '-ss',
      progress.doneSeconds.toFixed(3),
      '-i',
      file,
      '-c',
      'copy',
      '-avoid_negative_ts',
      'make_zero',
      remainder,
    ])
    if (trim.code !== 0 || !existsSync(remainder))
      throw new Error(`裁出剩余部分失败：${trim.out.slice(-300)}`)

    const output = restoredPathFor(file)
    // lada 处理"剩余部分"，输出到缓存目录（先不覆盖最终文件）
    const partOutput = join(dir, `part${progress.parts}.mp4`)
    startJob(file, { source: remainder, output: partOutput })
    running = {
      input: file,
      output,
      remainder,
      trimStart: progress.doneSeconds,
    }
    const expectedParts = progress.parts + 1

    onJobFinished(async finished => {
      const active = running
      if (!active || active.input !== file) return
      running = null
      rmSync(active.remainder, { force: true })
      try {
        if (finished.state !== 'done') {
          // 没跑完就保留现状，下次还能接着来
          return
        }
        const next = readProgress(file)
        writeProgress({
          input: file,
          doneSeconds: next?.doneSeconds ?? progress.doneSeconds,
          parts: expectedParts,
          preset: progress.preset,
          updatedAt: Date.now(),
        })
        await assemble(file, active.output)
        notify(`去码完成（续跑）：${basename(file)}`)
      } catch (error) {
        notify(
          `续跑收尾失败：${error instanceof Error ? error.message : String(error)}`
        )
      }
    })
    return { success: true, doneSeconds: progress.doneSeconds }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** 查询该片已处理的进度（暂停 / 继续） */
export function resumeInfo(input: string): LadaResumeProgress | null {
  return readProgress(input)
}

/** 启动时先把「上次崩溃留下的半成品」认领成可续跑的进度（而不是让清扫当垃圾删掉） */
export function initLadaResume(): void {
  void adoptLeftovers()
}

/**
 * 认领上次崩溃留下的半成品：带 `*.owner.json` 归属记录的临时视频会被收进缓存目录
 * 并登记进度，然后删掉临时文件。没有归属记录的才是真垃圾，留给清扫处理。
 */
export async function adoptLeftovers(): Promise<number> {
  const { ffmpeg } = ladaPaths()
  if (!ffmpeg) return 0
  let adopted = 0
  let names: string[] = []
  try {
    names = readdirSync(tempDirPath())
  } catch {
    return 0
  }
  for (const name of names) {
    if (classifyTempEntry(name) !== 'partial') continue
    const partial = join(tempDirPath(), name)
    const sidecar = `${partial}.owner.json`
    if (!existsSync(sidecar)) continue
    try {
      const owner = JSON.parse(readFileSync(sidecar, 'utf8')) as {
        input?: string
      }
      // 进度已经登记过就别重复认领
      if (owner.input && !readProgress(owner.input)) {
        const progress = await adoptPartial(owner.input, partial)
        if (progress) adopted += 1
      }
      rmSync(partial, { force: true })
      rmSync(sidecar, { force: true })
    } catch {
      /* 单个失败不影响其它 */
    }
  }
  return adopted
}

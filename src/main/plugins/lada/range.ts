/**
 * 区间去码（点哪段处理哪段）：
 *   裁出 [start, end] → 交给 lada → 用区间素材的音轨补声 → 产出一个单独的文件
 *
 * 为什么单独出一个文件、不并进整片的 .restored.mp4：整片还在处理时没法往中间插段，
 * 而且用户要的是"立刻看到这一段"。产物放在缓存目录（不写回片库，免得被当成新片子）。
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { lada } from '../../../shared/contract/lada'
import { emit } from '../../rpc'
import { runTool } from '../process'
import { durationOf, rangeDirFor } from './cache'
import { onJobFinished, startJob } from './job'
import { notify } from './resume'
import {
  durationMismatch,
  fmtClock,
  rangeOutputName,
  rangeStart,
  rangeStop,
} from './rules'
import { ffprobeFor, ladaPaths } from './tools'

interface RangeJob {
  input: string
  /** 裁出来的区间素材（带音轨，也是最终音轨的来源） */
  source: string
  /** lada 这一段跑出来的视频 */
  part: string
  /** 最终产物 */
  output: string
  start: number
  end: number
}

let range: RangeJob | null = null

/** 区间任务有结果了才通知界面：成功给路径，失败给原因（lada 结束时文件还没拼好） */
function broadcastRangeReady(info: {
  input: string
  start: number
  end: number
  path?: string
  error?: string
}): void {
  emit(lada, 'rangeReady', {
    ...info,
    title: `${basename(info.input)}（${fmtClock(info.start)}-${fmtClock(info.end)} 已去码）`,
  })
}

/** lada 跑完这一段后：补音轨 → 时长自检 → 通知界面；无论成败都清掉中间文件 */
async function finishRange(
  active: RangeJob,
  ffmpeg: string,
  ffprobe: string
): Promise<void> {
  const file = active.input
  try {
    // 音轨统一从裁出来的区间素材上取，不指望 lada 的产物带声
    const mux = await runTool(ffmpeg, [
      '-y',
      '-loglevel',
      'error',
      '-i',
      active.part,
      '-i',
      active.source,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0?',
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      active.output,
    ])
    if (mux.code !== 0) throw new Error(`合并音轨失败：${mux.out.slice(-200)}`)
    const [done, want] = await Promise.all([
      durationOf(ffprobe, active.output),
      durationOf(ffprobe, active.source),
    ])
    if (done && want && durationMismatch(done, want)) {
      throw new Error(
        `这一段时长异常（${fmtClock(done)} vs ${fmtClock(want)}）`
      )
    }
    broadcastRangeReady({
      input: file,
      start: active.start,
      end: active.end,
      path: active.output,
    })
    notify(`区间去码完成：${fmtClock(active.start)} - ${fmtClock(active.end)}`)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    broadcastRangeReady({
      input: file,
      start: active.start,
      end: active.end,
      error: reason,
    })
    notify(`区间去码收尾失败：${reason}`)
  }
}

export async function startRange(
  input: unknown,
  startSeconds: unknown,
  endSeconds: unknown
): Promise<{
  success: boolean
  error?: string
  output?: string
  start?: number
  end?: number
}> {
  try {
    if (range) throw new Error('已经有一个区间去码在进行中')
    if (typeof input !== 'string' || !input.trim())
      throw new Error('缺少文件路径')
    const file = input.trim()
    if (!existsSync(file)) throw new Error('文件不存在')
    const { ffmpeg } = ladaPaths()
    if (!ffmpeg) throw new Error('没找到 ffmpeg')

    const start = rangeStart(startSeconds)
    const ffprobe = ffprobeFor(ffmpeg)
    const duration = await durationOf(ffprobe, file)
    const stop = rangeStop(start, endSeconds, duration)
    const seconds = stop - start

    const dir = rangeDirFor(file)
    mkdirSync(dir, { recursive: true })
    // 清掉上一次的临时区间素材（产物 <名>.<区间>.restored.mp4 保留）
    for (const name of readdirSync(dir)) {
      if (/^src-.*\.mp4$/i.test(name)) rmSync(join(dir, name), { force: true })
    }

    const source = join(dir, `src-${Date.now()}.mp4`)
    // -ss 放在 -i 前面是快速定位（不重编码，落在最近的关键帧上，误差通常不到 1 秒）
    const trim = await runTool(ffmpeg, [
      '-y',
      '-loglevel',
      'error',
      '-ss',
      start.toFixed(3),
      '-t',
      seconds.toFixed(3),
      '-i',
      file,
      '-c',
      'copy',
      '-avoid_negative_ts',
      'make_zero',
      source,
    ])
    if (trim.code !== 0 || !existsSync(source)) {
      throw new Error(`裁出这一段失败：${trim.out.slice(-200)}`)
    }

    const output = join(dir, rangeOutputName(file, start, stop))
    const part = join(dir, `part-${Date.now()}.mp4`)
    try {
      startJob(file, { source, output: part })
    } catch (error) {
      // 抢不到任务（比如别的去码在跑）就把裁出来的素材收掉，别占着盘
      rmSync(source, { force: true })
      throw error
    }
    range = { input: file, source, part, output, start, end: stop }

    onJobFinished(async finished => {
      const active = range
      // 只认自己这一段的结束事件（finished.output 指向本段产物）
      if (!active || active.input !== file || finished.output !== active.part)
        return
      range = null
      try {
        if (finished.state === 'done')
          await finishRange(active, ffmpeg, ffprobe)
      } finally {
        rmSync(active.source, { force: true })
        rmSync(active.part, { force: true })
      }
    })

    return { success: true, output, start, end: stop }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

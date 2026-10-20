/**
 * 去马赛克（lada）相关类型与纯函数。
 *
 * 背景：lada（AGPL-3.0，独立外部工具）负责把马赛克修掉，mpv 负责播放。
 * 影盒只做调度：调用 lada-cli、显示进度、完成后优先播放修复产物。
 */

/** lada-cli 与 ffmpeg 的解析结果 */
export interface LadaPaths {
  /** lada-cli 可执行文件路径；空串表示没找到 */
  cli: string
  /** ffmpeg 可执行文件路径；空串表示没找到 */
  ffmpeg: string
  /** true = 由自动探测得到；false = 用户在设置里手动指定 */
  cliOverridden: boolean
  ffmpegOverridden: boolean
}

export type LadaJobState = 'idle' | 'running' | 'done' | 'failed' | 'cancelled'

export interface LadaJob {
  state: LadaJobState
  /** 输入（有码原片）绝对路径 */
  input: string
  /** 输出（.restored.mp4）绝对路径 */
  output: string
  /** 0-100；无法解析时为 null */
  percent: number | null
  /** lada 自报速度（帧/秒） */
  fps: number | null
  /** 已处理帧数 */
  frames: number | null
  /** 给用户看的简短状态文字 */
  message: string
  error?: string
  startedAt: number
  finishedAt?: number
}

/**
 * 解析 lada 的一行输出。
 *
 * 实际输出形如（tqdm，进度条与数据用 \r 分隔）：
 *   正在处理视频:  99%|██████|已处理 00:25 (893帧) | 剩余： 0:00 (10帧) | 速度：35.4 帧/秒
 *   正在合并音频
 */
export function parseLadaLine(line: string): {
  percent?: number
  fps?: number
  frames?: number
  message?: string
} {
  const text = line.replace(/\r/g, '').trim()
  if (!text) return {}

  const out: { percent?: number; fps?: number; frames?: number; message?: string } = {}

  const percent = text.match(/(\d{1,3})\s*%/)
  if (percent) {
    const value = Number(percent[1])
    if (Number.isFinite(value) && value >= 0 && value <= 100) out.percent = value
  }

  // 速度：35.4 帧/秒（半角/全角冒号都见过）
  const fps = text.match(/速度\s*[:：]\s*([\d.]+)/)
  if (fps) {
    const value = Number(fps[1])
    if (Number.isFinite(value) && value > 0) out.fps = value
  }

  const frames = text.match(/\((\d+)\s*帧\)/)
  if (frames) {
    const value = Number(frames[1])
    if (Number.isFinite(value)) out.frames = value
  }

  // 去掉进度条图形，留下可读文字
  const readable = text
    .replace(/[\u2588\u2593\u2592\u2591\u2580-\u259f|│]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (readable) out.message = readable

  return out
}

/** 由原片路径推出 lada 的默认输出路径：<同名>.restored.<原扩展名> */
export function restoredPathFor(input: string): string {
  const dot = input.lastIndexOf('.')
  const slash = Math.max(input.lastIndexOf('/'), input.lastIndexOf('\\'))
  if (dot <= slash) return `${input}.restored.mp4`
  return `${input.slice(0, dot)}.restored${input.slice(dot)}`
}

// ── 边跑边看（追播）────────────────────────────────────────
export type LadaLiveState = 'preparing' | 'serving' | 'finished' | 'failed' | 'cancelled'

export interface LadaLiveStatus {
  state: LadaLiveState
  input: string
  /** 交给播放器的 m3u8 地址（本机回环） */
  url: string
  /** 已发布的分片数 */
  segments: number
  /** 已经可以看的秒数 */
  availableSeconds: number
  error?: string
}

/** 续跑进度：某个原片已经处理好的部分 */
export interface LadaResumeProgress {
  input: string
  /** 已经处理好的秒数（由半成品实测） */
  doneSeconds: number
  /** 分段数（part0、part1…） */
  parts: number
  /** 上次用的编码预设/模型（拼接要求一致） */
  preset: string
  updatedAt: number
}

/** 区间去码产物就绪的通知 */
export interface LadaRangeReady {
  input: string
  start: number
  end: number
  /** 给用户看的标题，如「xx.mp4（12m00s-15m00s 已去码）」 */
  title: string
  /** 成功时为产物路径 */
  path?: string
  /** 失败原因 */
  error?: string
}

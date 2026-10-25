/**
 * 视频关键帧的纯规则：抽帧计划（固定间隔、每片上限）、文件签名、相近帧去重、帧缩略图 key、设置解析。
 */
import { createHash } from 'node:crypto'
import type { VisualFramesSettings } from '../../../../shared/library/ipc'

/** 抽帧规则版本：计划或缩略图规格变了就加一，已抽的文件按新规则重抽。 */
export const FRAME_RULES_VERSION = 1
/** 默认每隔多少秒抽一帧。 */
export const FRAME_INTERVAL_SEC = 30
/** 每个视频最多抽几帧（长片按上限均匀铺开）。 */
export const MAX_FRAMES = 60
/** 和上一张保留的帧相似度不低于它就算同一个画面，丢掉。 */
export const DEDUPE_THRESHOLD = 0.92
/** 帧缩略图宽度（只用于结果展示，高度按比例）。 */
export const FRAME_THUMB_WIDTH = 240

/** 设置缺省值：默认不抽，网盘默认跳过。 */
export const DEFAULT_FRAME_SETTINGS: VisualFramesSettings = {
  enabled: false,
  paused: false,
  includeCloud: false,
}

/**
 * 一个视频要抽的时间点（毫秒，升序）。
 * 每隔 interval 秒取一帧，从半个间隔处开始（避开片头黑场）；超过上限时整片均匀取 max 帧（各取区间中点）。
 * 时长不到一个间隔的短片只取中点一帧；时长未知或不正返回空。
 */
export function planFrames(
  durationSec: number | null | undefined,
  interval: number = FRAME_INTERVAL_SEC,
  max: number = MAX_FRAMES
): number[] {
  if (!durationSec || !Number.isFinite(durationSec) || durationSec <= 0)
    return []
  const count = Math.floor(durationSec / interval)
  if (count < 1) return [Math.floor((durationSec * 1000) / 2)]
  if (count > max) {
    const step = durationSec / max
    return Array.from({ length: max }, (_, i) =>
      Math.floor((i + 0.5) * step * 1000)
    )
  }
  return Array.from({ length: count }, (_, i) =>
    Math.floor((i + 0.5) * interval * 1000)
  )
}

/** 文件的抽帧签名：模型、文件身份（大小 + 修改时间）、规则版本，任一变化就重抽。 */
export function frameSignature(
  model: string,
  size: number,
  mtime: number
): string {
  return createHash('sha1')
    .update(
      `${model}|${size}|${Math.floor(mtime)}|frames-v${FRAME_RULES_VERSION}`
    )
    .digest('hex')
}

/** 帧缩略图在图片缓存里的 key（与 thumbnails/paths 的 key 同形：32 位十六进制）。 */
export function frameThumbKey(
  fileId: number,
  signature: string,
  atMs: number
): string {
  return createHash('sha1')
    .update(`frame|${fileId}|${signature}|${atMs}`)
    .digest('hex')
    .slice(0, 32)
}

/** 两个已归一化向量的余弦相似度。 */
export function cosine(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!
  return sum
}

/**
 * 按时间顺序去掉相近帧：每帧只和上一张保留的帧比（镜头不动时连续多帧几乎一样），
 * 相似度达到阈值就丢掉。previous 是续跑时上一批最后保留的那帧。返回保留的下标。
 */
export function dedupeFrames(
  vectors: readonly Float32Array[],
  previous: Float32Array | null,
  threshold: number = DEDUPE_THRESHOLD
): number[] {
  const kept: number[] = []
  let last = previous
  vectors.forEach((vec, i) => {
    if (last && cosine(last, vec) >= threshold) return
    kept.push(i)
    last = vec
  })
  return kept
}

/** settings 表里的 JSON → 设置；缺字段或坏数据按缺省值补。 */
export function parseFrameSettings(
  raw: string | undefined
): VisualFramesSettings {
  let value: unknown
  try {
    value = raw ? JSON.parse(raw) : {}
  } catch {
    value = {}
  }
  const r = (value && typeof value === 'object' ? value : {}) as Record<
    string,
    unknown
  >
  const flag = (key: keyof VisualFramesSettings): boolean =>
    typeof r[key] === 'boolean'
      ? (r[key] as boolean)
      : DEFAULT_FRAME_SETTINGS[key]
  return {
    enabled: flag('enabled'),
    paused: flag('paused'),
    includeCloud: flag('includeCloud'),
  }
}

/** 从 ffmpeg -i 的 stderr 里读时长（"Duration: 01:02:03.45"）；读不到返回 null。 */
export function parseFfmpegDuration(stderr: string): number | null {
  const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr)
  if (!m) return null
  const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
  return sec > 0 ? sec : null
}

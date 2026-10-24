/**
 * 进度条缩略图（雪碧图）的纯规则：主进程生成与渲染层悬停显示共用，不依赖 Electron / DOM。
 *
 * - 每 SEEK_INTERVAL 秒一帧，每帧 SEEK_FRAME_WIDTH × SEEK_FRAME_HEIGHT（等比缩放后居中补黑边）；
 * - 每页 SEEK_COLUMNS × SEEK_ROWS 帧拼成一张 JPEG，帧多时分页（第 0 页、第 1 页……）；
 * - 地址 `yingbox-media://seek/<key>/<页码>.jpg`，key 由文件路径 + 大小 + 修改时间算出，
 *   文件被替换后 key 随之变化，旧缓存按最近使用淘汰。
 */
import { MEDIA_SCHEME } from './media-url'

/** 抽帧间隔（秒）。 */
export const SEEK_INTERVAL = 10
/** 单帧宽度（像素）。 */
export const SEEK_FRAME_WIDTH = 160
/** 单帧高度（像素，16:9；其它比例补黑边）。 */
export const SEEK_FRAME_HEIGHT = 90
/** 每页列数。 */
export const SEEK_COLUMNS = 10
/** 每页行数。 */
export const SEEK_ROWS = 10
/** 每页帧数。 */
export const SEEK_PER_PAGE = SEEK_COLUMNS * SEEK_ROWS
/** 短于这个时长（秒）不生成：几帧缩略图没有意义。 */
export const SEEK_MIN_DURATION = 60
/** 长于这个时长（秒）不生成：超长录像抽帧太久、页数太多。 */
export const SEEK_MAX_DURATION = 6 * 60 * 60
/** 规则版本：抽帧参数改了就加一，旧缓存自然失效。 */
export const SEEK_RULES_VERSION = 1

/** 缓存 key：32 位十六进制。 */
export const SEEK_KEY_RE = /^[0-9a-f]{32}$/

/** 一部视频的雪碧图清单（主进程生成完写入，经 IPC 交给渲染层）。 */
export interface SeekManifest {
  key: string
  /** 抽帧间隔（秒） */
  interval: number
  /** 单帧尺寸 */
  width: number
  height: number
  columns: number
  rows: number
  /** 实际页数 */
  pages: number
  /** 实际帧数（最后一页可能不满） */
  frames: number
}

/** 请求结果：key 用来对应生成完的通知；manifest 为 null 表示已排队生成。 */
export interface SeekStatus {
  key: string
  manifest: SeekManifest | null
}

/** 某个时间点对应的帧：第几页、在页内的列与行。 */
export interface SeekFrame {
  page: number
  column: number
  row: number
}

/** 这个时长要不要生成缩略图。 */
export function shouldGenerateSeek(duration: number): boolean {
  return (
    Number.isFinite(duration) &&
    duration >= SEEK_MIN_DURATION &&
    duration <= SEEK_MAX_DURATION
  )
}

/** 时长 → 帧数与页数（帧在 0、10、20…… 秒处，最后一帧不超过片尾）。 */
export function seekLayout(duration: number): {
  frames: number
  pages: number
} {
  if (!Number.isFinite(duration) || duration <= 0)
    return { frames: 0, pages: 0 }
  const frames = Math.ceil(duration / SEEK_INTERVAL)
  return { frames, pages: Math.ceil(frames / SEEK_PER_PAGE) }
}

/** 时间点 → 帧位置；超出范围夹到首尾，没有帧时返回 null。 */
export function seekFrameAt(
  time: number,
  manifest: Pick<
    SeekManifest,
    'interval' | 'columns' | 'rows' | 'frames' | 'pages'
  >
): SeekFrame | null {
  const perPage = manifest.columns * manifest.rows
  const total = Math.min(manifest.frames, manifest.pages * perPage)
  if (total <= 0 || perPage <= 0 || manifest.interval <= 0) return null
  const raw = Number.isFinite(time) ? Math.floor(time / manifest.interval) : 0
  const index = Math.min(Math.max(raw, 0), total - 1)
  const inPage = index % perPage
  return {
    page: Math.floor(index / perPage),
    column: inPage % manifest.columns,
    row: Math.floor(inPage / manifest.columns),
  }
}

/** 某一页雪碧图的地址。 */
export function seekSpriteUrl(key: string, page: number): string {
  return `${MEDIA_SCHEME}://seek/${key}/${page}.jpg`
}

/** 解析雪碧图地址；不是 seek 地址或不合法返回 null。 */
export function parseSeekUrl(
  url: string
): { key: string; page: number } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:` || parsed.hostname !== 'seek') {
    return null
  }
  const match = /^\/([0-9a-f]{32})\/(\d{1,4})\.jpg$/.exec(parsed.pathname)
  if (!match) return null
  return { key: match[1]!, page: Number(match[2]) }
}

/** 页码 → 磁盘文件名（与 ffmpeg 输出模式 sprite-%03d.jpg 对应）。 */
export function seekPageFile(page: number): string {
  return `sprite-${String(page).padStart(3, '0')}.jpg`
}

/** 校验清单（磁盘上读回来的 JSON）；不合法返回 null。 */
export function parseSeekManifest(value: unknown): SeekManifest | null {
  if (!value || typeof value !== 'object') return null
  const m = value as Record<string, unknown>
  const ints = [
    'interval',
    'width',
    'height',
    'columns',
    'rows',
    'pages',
    'frames',
  ]
  if (typeof m['key'] !== 'string' || !SEEK_KEY_RE.test(m['key'])) return null
  for (const name of ints) {
    const n = m[name]
    if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) return null
  }
  return {
    key: m['key'],
    interval: m['interval'] as number,
    width: m['width'] as number,
    height: m['height'] as number,
    columns: m['columns'] as number,
    rows: m['rows'] as number,
    pages: m['pages'] as number,
    frames: m['frames'] as number,
  }
}

/**
 * 进度条缩略图在主进程这一侧的纯规则（不依赖 Electron，便于单测）：
 * 缓存 key、缓存目录布局、ffmpeg 参数、ffmpeg 候选位置、旧缓存淘汰。
 *
 * 缓存放在缩略图缓存目录下：<mediaDir>/thumb/seek/<key 前两位>/<key>/
 *   sprite-000.jpg、sprite-001.jpg……  各页雪碧图
 *   manifest.json                      清单，最后写入，有它才算生成完
 * 缩略图 LRU（thumbnails/cache.ts）只扫 thumb/ 下两级的图片文件，不会碰到 seek/ 里的内容；
 * 这里按视频为单位单独淘汰。
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import {
  SEEK_COLUMNS,
  SEEK_FRAME_HEIGHT,
  SEEK_FRAME_WIDTH,
  SEEK_INTERVAL,
  SEEK_ROWS,
  SEEK_RULES_VERSION,
} from '../../shared/seek-thumbnails'

/** 最多保留多少部视频的缩略图（每部约 0.5–3 MB）。 */
export const SEEK_CACHE_LIMIT = 200

/** 清单文件名。 */
export const MANIFEST_FILE = 'manifest.json'

/** 文件身份（路径 + 大小 + 修改时间）→ 缓存 key：SHA-1 前 32 位。 */
export function seekCacheKey(
  path: string,
  size: number,
  mtimeMs: number
): string {
  return createHash('sha1')
    .update(
      `seek-v${SEEK_RULES_VERSION}|${path}|${size}|${Math.floor(mtimeMs)}`
    )
    .digest('hex')
    .slice(0, 32)
}

/** 全部视频缩略图的根目录。 */
export function seekRoot(mediaDir: string): string {
  return join(mediaDir, 'thumb', 'seek')
}

/** 某部视频的缓存目录。 */
export function seekDir(mediaDir: string, key: string): string {
  return join(seekRoot(mediaDir), key.slice(0, 2), key)
}

/** ffmpeg 的视频滤镜：按间隔取帧 → 等比缩放 → 补黑边到固定尺寸 → 拼页。 */
export function seekFilter(): string {
  const w = SEEK_FRAME_WIDTH
  const h = SEEK_FRAME_HEIGHT
  return [
    `fps=1/${SEEK_INTERVAL}`,
    `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
    'setsar=1',
    `tile=${SEEK_COLUMNS}x${SEEK_ROWS}`,
  ].join(',')
}

/**
 * ffmpeg 参数：只解关键帧（-skip_frame nokey，快一个数量级，误差在一个 GOP 内）、
 * 单线程、不处理音频 / 字幕，输出 sprite-000.jpg 起的各页。
 */
export function seekFfmpegArgs(input: string, outDir: string): string[] {
  return [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-skip_frame',
    'nokey',
    '-threads',
    '1',
    '-i',
    input,
    '-an',
    '-sn',
    '-dn',
    '-vf',
    seekFilter(),
    '-q:v',
    '5',
    '-start_number',
    '0',
    '-f',
    'image2',
    join(outDir, 'sprite-%03d.jpg'),
  ]
}

/**
 * ffmpeg 的候选位置（按顺序试）：环境变量 YINGBOX_FFMPEG → PATH 上的 ffmpeg → 各平台常见安装位置。
 * macOS 从访达启动时 PATH 不含 Homebrew，要显式列出。
 */
export function ffmpegCandidates(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>
): string[] {
  const exe = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const list: string[] = []
  if (env['YINGBOX_FFMPEG']) list.push(env['YINGBOX_FFMPEG'])
  list.push(exe)
  if (platform === 'darwin') {
    list.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg')
  } else if (platform === 'win32') {
    for (const root of [env['ProgramFiles'], 'C:\\']) {
      if (root) list.push(join(root, 'ffmpeg', 'bin', exe))
    }
    if (env['LOCALAPPDATA']) {
      list.push(join(env['LOCALAPPDATA'], 'Microsoft', 'WinGet', 'Links', exe))
    }
    if (env['USERPROFILE']) {
      list.push(join(env['USERPROFILE'], 'scoop', 'shims', exe))
    }
  } else {
    list.push('/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg')
  }
  return [...new Set(list)]
}

/** 一部视频的缓存（用于淘汰）。 */
export interface SeekCacheEntry {
  key: string
  /** 最近使用时间（毫秒，清单文件的 mtime） */
  usedAt: number
}

/** 超过上限时删哪些：最久未用的先删，keep（正在用的）不删。 */
export function planSeekEviction(
  entries: readonly SeekCacheEntry[],
  limit: number = SEEK_CACHE_LIMIT,
  keep: ReadonlySet<string> = new Set()
): string[] {
  if (entries.length <= limit) return []
  const oldestFirst = [...entries].sort((a, b) => a.usedAt - b.usedAt)
  const victims: string[] = []
  let left = entries.length
  for (const entry of oldestFirst) {
    if (left <= limit) break
    if (keep.has(entry.key)) continue
    victims.push(entry.key)
    left--
  }
  return victims
}

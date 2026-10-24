/**
 * 截图 / GIF 的纯规则：文件名、GIF 时间窗、ffmpeg 参数、PNG 校验、目录约束。
 * 不碰文件系统与进程，便于单测；落盘与调用 ffmpeg 见 index.ts。
 */
import { isAbsolute, relative, resolve } from 'node:path'

/** 截图目录在系统「图片」目录下的子文件夹名 */
export const CAPTURE_DIR_NAME = '影盒'

/** GIF 以当前时刻为中心，前后各取的秒数 */
export const GIF_HALF_SECONDS = 2.5

/** 渲染层传来的 PNG 上限（8K 截图也远小于此） */
export const MAX_PNG_BYTES = 64 * 1024 * 1024

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * 是否为 PNG（看文件头）且不超过上限。
 * @param data 文件字节
 */
export function isPng(data: Uint8Array): boolean {
  if (data.length < PNG_MAGIC.length || data.length > MAX_PNG_BYTES) {
    return false
  }
  return PNG_MAGIC.every((byte, i) => data[i] === byte)
}

/**
 * 文件名里能用的部分：去掉 Windows / macOS 不允许的字符与首尾空白、点，最长 60 个字符。
 * @param name 原始名字
 */
export function sanitizeName(name: string): string {
  return (
    name
      // eslint-disable-next-line no-control-regex -- 去掉控制字符是本意
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+|\.+$/g, '')
      .slice(0, 60)
      .trim()
  )
}

const pad = (n: number): string => String(Math.floor(n)).padStart(2, '0')

/**
 * 播放位置写进文件名的形式：「01-02-03」或「02-03」（冒号在 Windows 文件名里不合法）。
 * @param seconds 播放位置（秒）
 */
export function positionLabel(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${pad(h)}-${pad(m)}-${pad(s)}` : `${pad(m)}-${pad(s)}`
}

/**
 * 截图文件名：「片名 02-03 20261024-123005.png」，片名缺省为「影盒截图」。
 * 时间戳精确到秒，同一秒连拍由调用方加序号去重。
 * @param hint 片名提示
 * @param seconds 播放位置
 * @param now 当前时间
 * @param ext 扩展名（png / gif）
 */
export function captureFileName(
  hint: string,
  seconds: number,
  now: Date,
  ext: 'png' | 'gif'
): string {
  const base = sanitizeName(hint) || '影盒截图'
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${base} ${positionLabel(seconds)} ${stamp}.${ext}`
}

/**
 * 同名文件已存在时的候选名：「a.png」→「a (2).png」。
 * @param fileName 原文件名
 * @param n 序号（≥2）
 */
export function numberedName(fileName: string, n: number): string {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return `${fileName} (${n})`
  return `${fileName.slice(0, dot)} (${n})${fileName.slice(dot)}`
}

/**
 * GIF 的起点与长度：以 center 为中心各取 GIF_HALF_SECONDS 秒，开头不足时从 0 开始（长度不变）。
 * @param center 当前播放位置（秒）
 */
export function gifWindow(center: number): { start: number; length: number } {
  const length = GIF_HALF_SECONDS * 2
  const start = Math.max(
    0,
    (Number.isFinite(center) ? center : 0) - GIF_HALF_SECONDS
  )
  return { start: Math.round(start * 1000) / 1000, length }
}

/**
 * 生成 GIF 的 ffmpeg 参数：12 帧、宽 480、两遍调色板（画质与体积的折中）。
 * @param input 视频文件路径
 * @param start 起点（秒）
 * @param length 长度（秒）
 * @param output 输出 .gif 路径
 */
export function gifArgs(
  input: string,
  start: number,
  length: number,
  output: string
): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    String(start),
    '-t',
    String(length),
    '-i',
    input,
    '-vf',
    'fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5',
    '-loop',
    '0',
    output,
  ]
}

/**
 * 截一帧 PNG 的 ffmpeg 参数（原始分辨率）。
 * @param input 视频文件路径
 * @param time 时刻（秒）
 * @param output 输出 .png 路径
 */
export function frameArgs(
  input: string,
  time: number,
  output: string
): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    String(Math.max(0, Number.isFinite(time) ? time : 0)),
    '-i',
    input,
    '-frames:v',
    '1',
    output,
  ]
}

/**
 * 路径是否在目录里（含子目录；目录本身不算）。
 * @param dir 目录
 * @param target 路径
 */
export function isInsideDir(dir: string, target: string): boolean {
  const rel = relative(resolve(dir), resolve(target))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * ffmpeg 失败输出的最后一行（给用户看的原因），没有输出时给通用文案。
 * @param out ffmpeg 的 stdout+stderr
 */
export function ffmpegError(out: string): string {
  const lines = out
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  return lines.at(-1)?.slice(0, 200) || 'ffmpeg 运行失败'
}

import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

/** 支持的字幕扩展名（按优先级排序） */
const SUBTITLE_EXTS = ['.srt', '.ass', '.ssa', '.vtt', '.sub']

export interface SubtitleCandidate {
  /** 展示名（去掉扩展名，含语言后缀） */
  name: string
  /** 字幕文件绝对路径 */
  path: string
  /** 小写扩展名，如 .srt */
  ext: string
}

/**
 * 在视频同目录查找可用字幕。
 *
 * 排序优先级：
 *   1. 与视频同名的字幕（`影片.srt`）
 *   2. 同名的语言变体（`影片.zh.srt` / `影片.chs.srt` / `影片.简体.srt`）
 *   3. 目录内其它字幕文件
 */
export async function findSubtitleFiles(videoPath: string): Promise<SubtitleCandidate[]> {
  const dir = dirname(videoPath)
  const videoBase = basename(videoPath, extname(videoPath)).toLowerCase()

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }

  const candidates: SubtitleCandidate[] = []
  for (const entry of entries) {
    const ext = extname(entry).toLowerCase()
    if (!SUBTITLE_EXTS.includes(ext)) continue
    const full = join(dir, entry)
    try {
      const info = await stat(full)
      if (!info.isFile() || info.size === 0) continue
    } catch {
      continue
    }
    candidates.push({ name: basename(entry, extname(entry)), path: full, ext })
  }

  const rank = (item: SubtitleCandidate): number => {
    const base = item.name.toLowerCase()
    if (base === videoBase) return 0
    if (base.startsWith(videoBase)) return 1
    return 2
  }

  // 同名优先 → 同前缀 → 短名优先 → 格式优先级（srt/vtt 兼容性最好，ass 靠菜单手动切）
  return candidates.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.name.length - b.name.length ||
      extPriority(a.ext) - extPriority(b.ext) ||
      a.name.localeCompare(b.name)
  )
}

/** 字幕格式优先级：数字越小越优先（作为默认字幕） */
function extPriority(ext: string): number {
  const order = ['.srt', '.vtt', '.ass', '.ssa', '.sub']
  const idx = order.indexOf(ext.toLowerCase())
  return idx < 0 ? order.length : idx
}

/**
 * 解码字幕文本。
 *
 * 中文字幕常见 GBK/GB18030 编码，直接按 UTF-8 读会乱码，
 * 因此先看 BOM，再用「严格 UTF-8」试探，失败后回退 GBK。
 */
export function decodeSubtitleText(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf-8')
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    const utf16le = decodeWith(buffer, 'utf-16le')
    if (utf16le !== null) return utf16le
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const utf16be = decodeWith(buffer, 'utf-16be')
    if (utf16be !== null) return utf16be
  }

  const strictUtf8 = decodeWith(buffer, 'utf-8', true)
  if (strictUtf8 !== null) return strictUtf8

  // 退回 GB18030（GBK 超集，覆盖简体中文常见字幕）
  for (const encoding of ['gb18030', 'gbk', 'big5']) {
    const decoded = decodeWith(buffer, encoding)
    if (decoded !== null) return decoded
  }
  return buffer.toString('latin1')
}

function decodeWith(buffer: Buffer, encoding: string, fatal = false): string | null {
  try {
    return new TextDecoder(encoding, { fatal }).decode(buffer)
  } catch {
    return null
  }
}

/** 秒数 → WebVTT 时间戳 `HH:MM:SS.mmm` */
function toVttTime(seconds: number): string {
  const clamped = Math.max(0, seconds)
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000)
  const total = Math.floor(clamped)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`
}

/** `00:01:23,456` 或 `00:01:23.456` → 秒 */
function parseTimecode(raw: string): number | null {
  const m = raw.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/)
  if (!m) return null
  const h = Number(m[1] || 0)
  const min = Number(m[2])
  const sec = Number(m[3])
  const ms = Number(m[4].padEnd(3, '0'))
  return h * 3600 + min * 60 + sec + ms / 1000
}

/** SRT → WebVTT */
export function srtToVtt(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '')
  const blocks = normalized.split(/\n{2,}/)
  const out: string[] = ['WEBVTT', '']

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim() !== '')
    if (!lines.length) continue
    const timeIdx = lines.findIndex((line) => line.includes('-->'))
    if (timeIdx < 0) continue
    const [rawStart, rawEnd] = lines[timeIdx].split('-->')
    const start = parseTimecode(rawStart || '')
    const end = parseTimecode(rawEnd || '')
    if (start === null || end === null) continue
    const body = lines.slice(timeIdx + 1)
    if (!body.length) continue
    out.push(`${toVttTime(start)} --> ${toVttTime(end)}`, ...body, '')
  }

  return out.join('\n')
}

/** 按逗号切分 ASS 行，但最后一个字段保留剩余全部内容（Text 字段本身可能含逗号） */
function splitAssFields(payload: string, fieldCount: number): string[] {
  const count = Math.max(1, fieldCount)
  const out: string[] = []
  let rest = payload
  for (let i = 0; i < count - 1; i++) {
    const idx = rest.indexOf(',')
    if (idx < 0) break
    out.push(rest.slice(0, idx).trim())
    rest = rest.slice(idx + 1)
  }
  out.push(rest.trim())
  return out
}

/** ASS/SSA → WebVTT */
export function assToVtt(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '')
  const lines = normalized.split('\n')
  const out: string[] = ['WEBVTT', '']

  let inEvents = false
  let startIdx = -1
  let endIdx = -1
  let textIdx = -1

  for (const line of lines) {
    const trimmed = line.trim()
    if (/^\[events\]$/i.test(trimmed)) {
      inEvents = true
      continue
    }
    if (/^\[/.test(trimmed)) {
      inEvents = false
      continue
    }
    if (!inEvents) continue

    if (/^format\s*:/i.test(trimmed)) {
      const fields = trimmed
        .slice(trimmed.indexOf(':') + 1)
        .split(',')
        .map((f) => f.trim().toLowerCase())
      startIdx = fields.indexOf('start')
      endIdx = fields.indexOf('end')
      textIdx = fields.indexOf('text')
      continue
    }
    if (!/^dialogue\s*:/i.test(trimmed)) continue

    const payload = line.slice(line.toLowerCase().indexOf('dialogue:') + 'dialogue:'.length)
    // Text 是最后一个字段且可能自带逗号，故最后一段保留全部剩余内容
    const parts = splitAssFields(payload, textIdx >= 0 ? textIdx + 1 : 10)
    const sIdx = startIdx >= 0 ? startIdx : 1
    const eIdx = endIdx >= 0 ? endIdx : 2
    const tIdx = textIdx >= 0 ? textIdx : 9
    const start = parseTimecode(parts[sIdx] || '')
    const end = parseTimecode(parts[eIdx] || '')
    if (start === null || end === null) continue

    const body = (parts[tIdx] || '')
      .replace(/\{[^}]*\}/g, '') // 去掉 {\pos(...)} 等覆盖标签
      .replace(/\\N|\\n/g, '\n')
      .replace(/\\h/g, ' ')
      .trim()
    if (!body) continue

    out.push(`${toVttTime(start)} --> ${toVttTime(end)}`, body, '')
  }

  return out.join('\n')
}

export interface SubtitleReadResult {
  success: boolean
  /** 转换后的 WebVTT 文本 */
  data?: string
  /** 原始格式，如 srt */
  format?: string
  error?: string
}

/** 读取字幕文件并统一转换为 WebVTT（含编码处理） */
export async function readSubtitleAsVtt(filePath: string): Promise<SubtitleReadResult> {
  try {
    const buffer = await readFile(filePath)
    const ext = extname(filePath).toLowerCase()
    const text = decodeSubtitleText(buffer)

    if (ext === '.vtt') {
      return { success: true, data: text, format: 'vtt' }
    }
    if (ext === '.ass' || ext === '.ssa') {
      return { success: true, data: assToVtt(text), format: 'ass' }
    }
    // .srt / .sub 按 SRT 解析；解析不出 cue 时原样交回，由播放器自行尝试
    const converted = srtToVtt(text)
    if (converted.includes('-->')) {
      return { success: true, data: converted, format: 'srt' }
    }
    return { success: true, data: text, format: 'srt' }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}

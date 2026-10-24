/**
 * AI 字幕的输出位置与记录（纯函数）。
 *
 * - 优先写在视频旁边：中文 `<片名>.zh.srt`、双语 `<片名>.zh.<原文语言>.srt`、原文 `<片名>.<语言>.srt`，
 *   播放器自动挂载同目录字幕时就能找到；同名文件已存在且不是 AI 生成的，改写 `….ai.srt`，不覆盖用户的字幕。
 * - 视频目录不可写（网盘、只读挂载）时写进 userData/ai-subtitles/cache。
 * - 每个视频生成过的字幕记在 index.json（前情提要等功能据此找到字幕）。
 */
import { createHash } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import type {
  AiSubtitleMode,
  AiSubtitleRecord,
} from '../../shared/ai-subtitles/types'

/** 文件名里的语言 / 模式后缀（不含 .srt） */
export function subtitleSuffix(mode: AiSubtitleMode, language: string): string {
  const lang = /^[a-z]{2,3}$/.test(language) ? language : ''
  if (mode === 'zh') return '.zh'
  if (mode === 'bilingual') return lang && lang !== 'zh' ? `.zh.${lang}` : '.zh'
  return `.${lang || 'ai'}`
}

/**
 * 视频旁边的输出路径。
 * @param occupied 某路径已被别的字幕占用（存在且不是这个视频上次的 AI 字幕）
 */
export function siblingSubtitlePath(
  videoPath: string,
  mode: AiSubtitleMode,
  language: string,
  occupied: (path: string) => boolean
): string {
  const base = videoPath.slice(0, videoPath.length - extname(videoPath).length)
  const suffix = subtitleSuffix(mode, language)
  const primary = `${base}${suffix}.srt`
  return occupied(primary) ? `${base}${suffix}.ai.srt` : primary
}

/** 字幕缓存里的路径（按视频路径哈希命名，同一视频同一模式覆盖） */
export function cacheSubtitlePath(
  cacheDir: string,
  videoPath: string,
  mode: AiSubtitleMode
): string {
  const hash = createHash('sha1').update(videoPath).digest('hex').slice(0, 16)
  const name = basename(videoPath, extname(videoPath))
    .replace(/[^\w\u4e00-\u9fff.-]+/g, '_')
    .slice(0, 60)
  return join(cacheDir, `${name}.${hash}.${mode}.srt`)
}

/** 记录最多保留几条 */
export const RECORD_LIMIT = 1000

/** 解析 index.json；坏文件当空 */
export function parseRecords(text: string | null): AiSubtitleRecord[] {
  if (!text) return []
  try {
    const data = JSON.parse(text) as unknown
    if (!Array.isArray(data)) return []
    return data.filter(
      (item): item is AiSubtitleRecord =>
        Boolean(item) &&
        typeof item.videoPath === 'string' &&
        typeof item.path === 'string' &&
        typeof item.mode === 'string' &&
        typeof item.updatedAt === 'number'
    )
  } catch {
    return []
  }
}

/** 加入 / 替换一个视频的记录（每个视频只留最新一条，新的在前） */
export function upsertRecord(
  records: readonly AiSubtitleRecord[],
  record: AiSubtitleRecord
): AiSubtitleRecord[] {
  return [
    record,
    ...records.filter(item => item.videoPath !== record.videoPath),
  ].slice(0, RECORD_LIMIT)
}

/** 某个视频的记录 */
export function recordFor(
  records: readonly AiSubtitleRecord[],
  videoPath: string
): AiSubtitleRecord | null {
  return records.find(item => item.videoPath === videoPath) ?? null
}

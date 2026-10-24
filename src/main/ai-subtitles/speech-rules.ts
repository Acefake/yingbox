/**
 * 语音识别的纯规则：音频分段、ffmpeg / whisper-cli 参数、whisper.cpp 与云端转写结果解析。
 * 不碰进程和网络，测试直接调。
 */
import type { AiSubtitleCue } from '../../shared/ai-subtitles/types'

/** 每段音频的长度（秒）：长片分段识别，进度按段推进 */
export const CHUNK_SECONDS = 600

/** 一段音频 */
export interface AudioChunk {
  index: number
  /** 起点（秒） */
  start: number
  /** 时长（秒） */
  duration: number
}

/** 按时长切段；最后一段不足 30 秒时并进上一段（避免只有几秒的尾巴） */
export function planChunks(
  durationSec: number,
  chunkSec = CHUNK_SECONDS
): AudioChunk[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return []
  const chunks: AudioChunk[] = []
  for (let start = 0; start < durationSec; start += chunkSec) {
    chunks.push({
      index: chunks.length,
      start,
      duration: Math.min(chunkSec, durationSec - start),
    })
  }
  const last = chunks[chunks.length - 1]
  if (chunks.length > 1 && last.duration < 30) {
    chunks.pop()
    chunks[chunks.length - 1].duration += last.duration
  }
  return chunks
}

/** ffprobe 读时长的参数 */
export function ffprobeDurationArgs(input: string): string[] {
  return [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    input,
  ]
}

/** 从 ffprobe 输出（或 ffmpeg 日志里的 Duration: 行）取时长秒数 */
export function parseDuration(output: string): number | null {
  const plain = /^\s*(\d+(?:\.\d+)?)\s*$/m.exec(output)
  if (plain) return Number(plain[1])
  const log = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(output)
  if (!log) return null
  return Number(log[1]) * 3600 + Number(log[2]) * 60 + Number(log[3])
}

/** ffmpeg 抽一段 16k 单声道 16 位 wav 的参数 */
export function extractArgs(
  input: string,
  chunk: AudioChunk,
  output: string
): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-ss',
    String(chunk.start),
    '-t',
    String(chunk.duration),
    '-i',
    input,
    '-vn',
    '-sn',
    '-dn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    '-f',
    'wav',
    output,
  ]
}

/** whisper-cli 参数：输出 JSON 到 outBase.json，-pp 打印进度 */
export function whisperArgs(options: {
  model: string
  wav: string
  outBase: string
  language?: string
  threads?: number
}): string[] {
  const args = [
    '-m',
    options.model,
    '-f',
    options.wav,
    '-l',
    options.language || 'auto',
    '-oj',
    '-of',
    options.outBase,
    '-pp',
  ]
  if (options.threads && options.threads > 0)
    args.push('-t', String(Math.floor(options.threads)))
  return args
}

/** whisper-cli 的进度行（「progress = 45%」）→ 0–100；不是进度行返回 null */
export function parseWhisperProgress(line: string): number | null {
  const m = /progress\s*=\s*(\d{1,3})\s*%/.exec(line)
  return m ? Math.min(100, Number(m[1])) : null
}

/** 一段的识别结果 */
export interface Transcript {
  /** ISO 639-1；未知为空串 */
  language: string
  cues: AiSubtitleCue[]
}

/** 常见语言名 → ISO 639-1（云端转写的 verbose_json 给的是英文全名） */
const LANGUAGE_NAMES: Record<string, string> = {
  english: 'en',
  chinese: 'zh',
  japanese: 'ja',
  korean: 'ko',
  french: 'fr',
  german: 'de',
  spanish: 'es',
  russian: 'ru',
  italian: 'it',
  portuguese: 'pt',
  thai: 'th',
  cantonese: 'yue',
}

/** 语言名或代码统一成小写代码 */
export function normalizeLanguage(value: unknown): string {
  if (typeof value !== 'string') return ''
  const text = value.trim().toLowerCase()
  if (!text || text === 'auto') return ''
  return LANGUAGE_NAMES[text] ?? (/^[a-z]{2,3}$/.test(text) ? text : '')
}

/** 是否已是中文（识别出中文时不用翻译） */
export function isChinese(language: string): boolean {
  return language === 'zh' || language === 'yue'
}

/** whisper.cpp 的特殊标记（[_BEG_]、[BLANK_AUDIO]、(音乐) 之类）不算台词 */
function cleanText(text: string): string {
  return text
    .replace(/\[_[A-Z]+_\]/g, '')
    .replace(
      /^\s*[[(（](?:BLANK_AUDIO|blank_audio|Music|MUSIC|音乐)[\])）]\s*$/,
      ''
    )
    .trim()
}

/** 解析 whisper-cli -oj 的输出（offsets 为毫秒） */
export function parseWhisperJson(text: string): Transcript {
  let data: {
    result?: { language?: unknown }
    transcription?: unknown
  }
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('whisper 输出不是合法 JSON')
  }
  if (!Array.isArray(data.transcription))
    throw new Error('whisper 输出缺少 transcription')
  const cues: AiSubtitleCue[] = []
  for (const item of data.transcription as Array<Record<string, unknown>>) {
    const offsets = item.offsets as { from?: unknown; to?: unknown } | undefined
    const start = Number(offsets?.from)
    const end = Number(offsets?.to)
    const body = cleanText(String(item.text ?? ''))
    if (!body || !Number.isFinite(start) || !Number.isFinite(end)) continue
    cues.push({ start, end: Math.max(start, end), text: body })
  }
  return { language: normalizeLanguage(data.result?.language), cues }
}

/** 解析云端 /audio/transcriptions 的 verbose_json（segments 的时间为秒） */
export function parseCloudTranscription(
  data: unknown,
  durationSec: number
): Transcript {
  if (!data || typeof data !== 'object')
    throw new Error('转写接口返回的不是 JSON 对象')
  const body = data as {
    language?: unknown
    segments?: unknown
    text?: unknown
  }
  const language = normalizeLanguage(body.language)
  if (Array.isArray(body.segments)) {
    const cues: AiSubtitleCue[] = []
    for (const seg of body.segments as Array<Record<string, unknown>>) {
      const start = Number(seg.start)
      const end = Number(seg.end)
      const text = cleanText(String(seg.text ?? ''))
      if (!text || !Number.isFinite(start) || !Number.isFinite(end)) continue
      cues.push({
        start: Math.round(start * 1000),
        end: Math.round(Math.max(start, end) * 1000),
        text,
      })
    }
    return { language, cues }
  }
  // 只返回纯文本的模型：整段作为一条（时间轴粗糙，但内容不丢）
  const text = typeof body.text === 'string' ? cleanText(body.text) : ''
  if (!text) return { language, cues: [] }
  return {
    language,
    cues: [{ start: 0, end: Math.round(durationSec * 1000), text }],
  }
}

/** 把一段的字幕平移到整片时间轴 */
export function offsetCues(
  cues: readonly AiSubtitleCue[],
  offsetSec: number
): AiSubtitleCue[] {
  const offset = Math.round(offsetSec * 1000)
  return cues.map(cue => ({
    ...cue,
    start: cue.start + offset,
    end: cue.end + offset,
  }))
}

/** 多段里出现最多的语言（各段可能有个别误判） */
export function dominantLanguage(languages: readonly string[]): string {
  const counts = new Map<string, number>()
  for (const lang of languages)
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1)
  let best = ''
  let max = 0
  for (const [lang, count] of counts)
    if (count > max) {
      best = lang
      max = count
    }
  return best
}

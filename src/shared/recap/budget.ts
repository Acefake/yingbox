/**
 * 前情提要 / 问剧情的 token 预算与缓存键（纯函数）。
 *
 * - token 只做粗估：中日韩字符按 1 个、其余字符按 4 个一组，够用来控制每次请求的大小。
 * - 长台词按行贪心分段（{@link chunkLines}），分段只看前缀：截到任意进度时，前面「已封口」的段
 *   和整集分出来的段完全一样，所以问剧情时本集已播部分的分段摘要能直接复用整集的缓存。
 * - 缓存键是素材身份（路径 + 修改时间 + 大小 + 提示词版本）的哈希，素材一变就自动失效。
 */
import type { AiSubtitleCue } from '../ai-subtitles/types'

/** 每段送去摘要的台词上限（估算 tokens） */
export const CHUNK_TOKENS = 3000
/** 单行台词上限（超出截断，防止一行吃掉整段） */
export const LINE_TOKENS = 200
/** 问剧情：本集进度之前最近的原始台词上限 */
export const QA_RECENT_TOKENS = 2000
/** 问剧情：带上的历史问答条数上限 */
export const QA_HISTORY_MESSAGES = 6
/** 每条历史问答的上限 */
export const QA_HISTORY_TOKENS = 400
/** 前情提要用之前几集 */
export const RECAP_MAX_PREVIOUS = 3
/** 提示词版本：改了摘要提示词就加一，旧缓存自然失效 */
export const RECAP_PROMPT_VERSION = 1

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uff00-\uffef]/

/** 粗估文本的 tokens */
export function estimateTokens(text: string): number {
  let cjk = 0
  let other = 0
  for (const ch of text) {
    if (CJK.test(ch)) cjk += 1
    else other += 1
  }
  return cjk + Math.ceil(other / 4)
}

/** 从头截到不超过 budget tokens（按字符逐个累加，保证不截断代理对） */
export function truncateToTokens(text: string, budget: number): string {
  if (estimateTokens(text) <= budget) return text
  let cjk = 0
  let other = 0
  let out = ''
  for (const ch of text) {
    if (CJK.test(ch)) cjk += 1
    else other += 1
    if (cjk + Math.ceil(other / 4) > budget) break
    out += ch
  }
  return `${out}…`
}

/**
 * 字幕 → 台词行：双语字幕（「中文\n原文」）只留第一行，多行合成一行，
 * 去掉 ASS 标签 / HTML 标签与连续重复的行。只看前缀，截断后结果仍是整集结果的前缀。
 */
export function cueLines(
  cues: readonly AiSubtitleCue[],
  bilingual = false
): string[] {
  const lines: string[] = []
  for (const cue of cues) {
    const parts = cue.text
      .replace(/\{[^}]*\}/g, '')
      .replace(/<[^>]+>/g, '')
      .split('\n')
      .map(part => part.trim())
      .filter(Boolean)
    const line = (bilingual ? parts.slice(0, 1) : parts).join(' ').trim()
    if (line && line !== lines.at(-1)) lines.push(line)
  }
  return lines
}

/**
 * 按行贪心分段：每段估算不超过 budget tokens，超长的单行先截到 {@link LINE_TOKENS}。
 * 返回的最后一段可能未满（「未封口」）。
 */
export function chunkLines(
  lines: readonly string[],
  budget = CHUNK_TOKENS
): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  let used = 0
  for (const raw of lines) {
    const line = truncateToTokens(raw, LINE_TOKENS)
    const cost = estimateTokens(line) + 1
    if (current.length && used + cost > budget) {
      chunks.push(current)
      current = []
      used = 0
    }
    current.push(line)
    used += cost
  }
  if (current.length) chunks.push(current)
  return chunks
}

/** {@link closedChunks} 的结果 */
export interface ClosedChunks {
  /** 已封口的段 */
  chunks: string[][]
  /** 这些段覆盖了前缀的前多少行（之后的行才是「最近台词」） */
  covered: number
}

/**
 * 截到某个进度的台词前缀里「已封口」的段：最后一段后面还可能接台词，不算封口。
 * 这些段与整集分段的前几段逐字相同。
 */
export function closedChunks(
  prefixLines: readonly string[],
  budget = CHUNK_TOKENS
): ClosedChunks {
  const chunks = chunkLines(prefixLines, budget).slice(0, -1)
  return {
    chunks,
    covered: chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  }
}

/** 从末尾往前取，不超过 budget tokens 的最近几行（保持原顺序） */
export function tailLines(lines: readonly string[], budget: number): string[] {
  const out: string[] = []
  let used = 0
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = truncateToTokens(lines[i], LINE_TOKENS)
    const cost = estimateTokens(line) + 1
    if (used + cost > budget) break
    out.push(line)
    used += cost
  }
  return out.reverse()
}

/** FNV-1a 32 位（指定种子） */
function fnv1a(text: string, seed: number): string {
  let hash = seed >>> 0
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** 64 位文本哈希（两路不同种子的 FNV-1a 拼接；只做缓存键，不做安全用途） */
export function hashText(text: string): string {
  return fnv1a(text, 0x811c9dc5) + fnv1a(text, 0x01000193 ^ 0x5bd1e995)
}

/** 一集素材的身份 */
export interface MaterialIdentity {
  videoPath: string
  kind: 'subtitle' | 'overview'
  /** 素材位置：字幕文件路径、NFO 路径或 tmdb:<id>:<季>:<集> */
  sourcePath: string
  mtimeMs?: number
  size?: number
}

/** 一集摘要的缓存键 */
export function episodeKey(identity: MaterialIdentity): string {
  return `ep:${hashText(
    [
      RECAP_PROMPT_VERSION,
      identity.videoPath,
      identity.kind,
      identity.sourcePath,
      Math.round(identity.mtimeMs ?? 0),
      identity.size ?? 0,
    ].join('\u0000')
  )}`
}

/** 一集第 index 段台词摘要的缓存键 */
export function chunkKey(episode: string, index: number): string {
  return `${episode}:c${index}`
}

/** 前情提要的缓存键：当前集 + 之前各集摘要的键（顺序相关） */
export function recapKey(
  videoPath: string,
  previousKeys: readonly string[]
): string {
  return `recap:${hashText(
    [RECAP_PROMPT_VERSION, videoPath, ...previousKeys].join('\u0000')
  )}`
}

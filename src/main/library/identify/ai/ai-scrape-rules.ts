/**
 * AI 识别兜底的纯规则：提示词构造、模型输出校验、推断结果 → 识别输入、TMDB 验证的采用规则、缓存键。
 *
 * 流程（见 ai-scraper.ts）：常规识别失败或把握不够 → 把文件名、父目录名、同目录其他文件名交给大模型，
 * 按 {@link AI_GUESS_SCHEMA} 返回结构化推断 → 用推断的标题 / 年份 / 季集重新走 TMDB 搜索打分 →
 * 只有标题与年份都对得上（{@link acceptAiMatch}）才自动采用，否则把候选留在待确认。
 *
 * 不碰数据库、网络与模型，便于单测。
 */
import { createHash } from 'node:crypto'
import type { AiJsonRequest } from '../../../../shared/ai/types'
import type {
  IdentifyInput,
  IdentifyResult,
  LocalEpisodes,
} from '../../../../shared/library/identify'
import type { LibrarySource } from '../../../../shared/library/ipc'
import type { ScoredCandidate } from '../../../../shared/library/scoring'

/** 引擎里调用大模型的口：桌面端经主进程代办（aiService），独立服务没有。 */
export interface LibraryAi {
  /** AI 是否已配置（服务商 / Key / 模型）、设置「AI 识别兜底」是否打开。 */
  status(): Promise<LibraryAiStatus>
  /** 结构化输出：返回模型给出的 JSON（未校验）。失败时抛错，错误信息带 `[ai:<code>]`。 */
  chatJson(request: AiJsonRequest): Promise<unknown>
}

/** AI 状态。 */
export interface LibraryAiStatus {
  configured: boolean
  /** 设置「AI 识别兜底」（自动识别失败时调用）。 */
  fallback: boolean
}

/** 交给大模型的线索。 */
export interface GuessInput {
  /** 媒体库类型：电影库 movie，剧集库 tv。 */
  kind: 'movie' | 'tv'
  /** 代表文件名（含扩展名）。 */
  fileName: string
  /** 父目录名；在媒体库根目录下时为空串。 */
  folder: string
  /** 同目录其他视频文件名（不含代表文件）。 */
  siblings: string[]
}

/** 大模型的推断（已校验）。 */
export interface AiGuess {
  title: string
  originalTitle?: string
  year?: number
  type: 'movie' | 'tv'
  season?: number
  episode?: number
  /** 0–1。 */
  confidence: number
}

/** 同目录文件名最多带几个（省 token）。 */
export const SIBLINGS_MAX = 12
/** 单个名字最长保留的字符数。 */
const NAME_MAX = 200
/** 推断把握低于此值不去 TMDB 验证。 */
export const AI_MIN_CONFIDENCE = 0.3
/** 自动采用要求的推断把握。 */
export const AI_ACCEPT_CONFIDENCE = 0.5
/** 自动采用要求的标题相似度；推断没给年份时要求更高。 */
export const AI_TITLE_MIN = 0.8
export const AI_TITLE_MIN_NO_YEAR = 0.92

/** 结构化输出的 JSON Schema（所有字段必填，未知的给 null）。 */
export const AI_GUESS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'originalTitle',
    'year',
    'type',
    'season',
    'episode',
    'confidence',
  ],
  properties: {
    title: { type: 'string' },
    originalTitle: { type: ['string', 'null'] },
    year: { type: ['integer', 'null'] },
    type: { type: 'string', enum: ['movie', 'tv'] },
    season: { type: ['integer', 'null'] },
    episode: { type: ['integer', 'null'] },
    confidence: { type: 'number' },
  },
}

const SYSTEM_PROMPT = [
  '你是影视文件名识别助手。根据视频文件名、所在文件夹名和同目录其他文件名，推断它是哪部电影或哪部剧集。',
  '要求：',
  '- 去掉分辨率、编码、音轨、字幕组、发布组、网站水印等标记；把罗马音、拼音、缩写还原成作品名。',
  '- title：作品在 TMDB 上最常用的名称（华语作品给中文名，其余给英文名或原名）；originalTitle：原语言名称，不知道给 null。',
  '- year：首映 / 首播年份，不确定给 null。type：电影 movie，剧集 / 动画番剧 tv。',
  '- season / episode：只在 tv 时给出（特别篇第 0 季），不知道给 null；movie 时都给 null。',
  '- confidence：0 到 1 之间，表示你对 title 的把握；认不出时 title 给空串、confidence 给 0。',
  '只输出一个 JSON 对象，不要解释。',
].join('\n')

const clip = (text: string): string => text.trim().slice(0, NAME_MAX)

/** 构造请求（system + user 两条消息，温度 0，限制输出长度）。 */
export function buildGuessRequest(
  input: GuessInput,
  isPrivate: boolean
): AiJsonRequest {
  const siblings = input.siblings
    .map(clip)
    .filter(Boolean)
    .slice(0, SIBLINGS_MAX)
  const lines = [
    `媒体库类型：${input.kind === 'movie' ? '电影' : '剧集'}`,
    `文件名：${clip(input.fileName)}`,
    `所在文件夹：${clip(input.folder) || '（媒体库根目录）'}`,
  ]
  if (siblings.length) {
    lines.push('同目录其他文件：', ...siblings.map(name => `- ${name}`))
  }
  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: lines.join('\n') },
    ],
    schema: AI_GUESS_SCHEMA,
    schemaName: 'media_guess',
    temperature: 0,
    maxTokens: 300,
    timeoutMs: 45_000,
    ...(isPrivate ? { private: true } : {}),
  }
}

const intIn = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max
    ? value
    : undefined

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value.trim().slice(0, NAME_MAX) : ''

/**
 * 校验模型输出：标题为空、类型不认识时返回 null；越界的年份 / 季集丢弃；把握夹到 0–1。
 * 电影不带季集；原名与标题相同时省略。
 */
export function parseGuess(data: unknown): AiGuess | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const r = data as Record<string, unknown>
  const title = textOf(r.title)
  const type = r.type === 'movie' || r.type === 'tv' ? r.type : null
  if (!title || !type) return null
  const originalTitle = textOf(r.originalTitle)
  const confidence =
    typeof r.confidence === 'number' && Number.isFinite(r.confidence)
      ? Math.min(1, Math.max(0, r.confidence))
      : 0
  const year = intIn(r.year, 1870, 2100)
  const season = type === 'tv' ? intIn(r.season, 0, 200) : undefined
  const episode = type === 'tv' ? intIn(r.episode, 0, 10_000) : undefined
  return {
    title,
    ...(originalTitle && originalTitle !== title ? { originalTitle } : {}),
    ...(year !== undefined ? { year } : {}),
    type,
    ...(season !== undefined ? { season } : {}),
    ...(episode !== undefined ? { episode } : {}),
    confidence,
  }
}

/**
 * 推断 → 识别输入（不带 NFO / ID / 哈希，只走标题搜索打分）。
 * 搜索类型以媒体库为准（电影库只搜电影）；剧集库优先用本地各集汇总校验季集。
 */
export function guessToInput(
  guess: AiGuess,
  kind: 'movie' | 'tv',
  local: { runtimeMinutes?: number; episodes?: LocalEpisodes } = {}
): IdentifyInput {
  const base = {
    title: guess.title,
    ...(guess.originalTitle ? { altTitle: guess.originalTitle } : {}),
    ...(guess.year !== undefined ? { year: guess.year } : {}),
  }
  if (kind === 'movie') {
    return {
      parsed: { type: 'movie', ...base },
      ...(local.runtimeMinutes ? { runtimeMinutes: local.runtimeMinutes } : {}),
    }
  }
  const episodes = local.episodes?.episodes.length
    ? local.episodes
    : {
        season: guess.season,
        episodes: guess.episode !== undefined ? [guess.episode] : [],
      }
  return {
    parsed: {
      type: 'episode',
      ...base,
      season: episodes.season,
      episodes: episodes.episodes,
    },
    episodes,
  }
}

/**
 * TMDB 验证的采用规则：搜索打分已自动匹配，且
 * - 推断类型与媒体库一致、推断把握 ≥ {@link AI_ACCEPT_CONFIDENCE}；
 * - 标题相似度 ≥ {@link AI_TITLE_MIN}（推断没给年份时 ≥ {@link AI_TITLE_MIN_NO_YEAR}）；
 * - 推断与候选都有年份时，相差不超过 1 年。
 */
export function acceptAiMatch(
  guess: AiGuess,
  result: IdentifyResult,
  kind: 'movie' | 'tv'
): boolean {
  if (result.status !== 'matched' || !result.scored) return false
  if (guess.type !== kind || guess.confidence < AI_ACCEPT_CONFIDENCE) {
    return false
  }
  const { breakdown, candidate } = result.scored
  const titleMin =
    guess.year === undefined ? AI_TITLE_MIN_NO_YEAR : AI_TITLE_MIN
  if (breakdown.title < titleMin) return false
  if (guess.year !== undefined && candidate.year !== undefined) {
    return Math.abs(guess.year - candidate.year) <= 1
  }
  return true
}

/** 验证没通过时留给待确认的候选（标上 AI 来源）。 */
export function aiCandidates(
  result: IdentifyResult,
  confidence: number
): ScoredCandidate[] {
  const list =
    result.status === 'matched'
      ? result.scored
        ? [result.scored]
        : []
      : result.status === 'skipped'
        ? []
        : result.candidates
  return list.map(s => markAi(s, confidence))
}

/** 在分数明细里记下 AI 把握（存进 matches.candidate，界面据此显示来源）。 */
export function markAi(
  s: ScoredCandidate,
  confidence: number
): ScoredCandidate {
  return {
    ...s,
    breakdown: { ...s.breakdown, ai: Math.round(confidence * 1000) / 1000 },
  }
}

/** 私密板块（番号库）的内容只发给本地模型：请求带 private: true。 */
export const isPrivateSource = (source: LibrarySource): boolean =>
  source === 'jav'

/**
 * 父目录的显示名：相对媒体库根的最后两级（「剧名/Season 1」比只给「Season 1」有用）；
 * 文件就在根目录下时为空串。
 */
export function folderLabel(displayPath: string, root?: string): string {
  const parts = displayPath.split(/[\\/]+/).filter(Boolean)
  parts.pop()
  const rootParts = root ? root.split(/[\\/]+/).filter(Boolean) : []
  const relative =
    rootParts.length &&
    rootParts.every((p, i) => parts[i]?.toLowerCase() === p.toLowerCase())
      ? parts.slice(rootParts.length)
      : parts
  return relative.slice(-2).join('/')
}

/** 缓存键：按媒体库类型 + 父目录名 + 文件名（大小写不敏感），同一文件不重复花费。 */
export function guessCacheKey(input: GuessInput): string {
  const text = `${input.folder}\n${input.fileName}`.toLowerCase()
  const hash = createHash('sha1').update(text).digest('hex')
  return `ai:guess:${input.kind}:${hash}`
}

/** 并发限制器：同时最多 n 个任务在跑，其余排队（先到先跑）。 */
export function createLimiter(
  n: number
): <T>(task: () => Promise<T>) => Promise<T> {
  let running = 0
  const queue: Array<() => void> = []
  const next = (): void => {
    if (running >= n) return
    const start = queue.shift()
    if (start) {
      running++
      start()
    }
  }
  return task =>
    new Promise((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            running--
            next()
          })
      })
      next()
    })
}

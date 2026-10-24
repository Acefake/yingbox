/**
 * AI 识别兜底的执行：从条目的文件收集线索 → 问大模型（限速、按文件名缓存）→ 用推断结果重新走 TMDB
 * 搜索打分 → 按 ai-scrape-rules 的采用规则自动匹配，或把 AI 候选留在待确认。
 *
 * 两种入口：
 * - {@link AiScraper.fallback}：常规识别得到待确认 / 未匹配后自动调用，只在设置「AI 识别兜底」打开且
 *   AI 已配置时生效；出错只记日志，保留常规识别的结果；
 * - {@link AiScraper.manual}：用户在待确认队列里点「用 AI 识别」（identify 任务 mode = 'ai'），不看开关，
 *   出错计入任务的失败数。
 *
 * 只处理 TMDB 库（番号库按番号查站点，不走这里）。大模型经 {@link LibraryAi} 调用：桌面端由主进程
 * aiService 代办，独立服务没有这个口，也就没有 AI 兜底。
 */
import { identify } from '../../../../shared/library/identify'
import { LibraryError } from '../../../../shared/library/ipc'
import type { ItemChanges } from '../../catalog/catalog-store'
import type { ResponseCache } from '../../providers/http/provider-cache'
import { summarizeEpisodes } from '../episode-mapping'
import type { IdentifyTarget } from '../identify-store'
import type { Outcome, RunnerContext } from '../runner-types'
import {
  AI_MIN_CONFIDENCE,
  type AiGuess,
  type GuessInput,
  type LibraryAi,
  type LibraryAiStatus,
  acceptAiMatch,
  aiCandidates,
  buildGuessRequest,
  createLimiter,
  folderLabel,
  guessCacheKey,
  guessToInput,
  isPrivateSource,
  markAi,
  parseGuess,
} from './ai-scrape-rules'

export type { LibraryAi } from './ai-scrape-rules'

/** 推断结果缓存多久（同一文件名半年内不再花钱）。 */
export const GUESS_TTL_MS = 180 * 86_400_000
/** AI 状态（配置 / 开关）缓存多久，免得每个条目都问一次主进程。 */
const STATUS_TTL_MS = 30_000
/** 连续失败多少次后暂停调用，暂停多久。 */
const BREAKER_FAILURES = 3
const BREAKER_PAUSE_MS = 5 * 60_000

/** 依赖。 */
export interface AiScraperDeps {
  ai: LibraryAi
  /** 推断结果缓存（provider_cache 表，键 ai:guess:*）。 */
  cache: ResponseCache
  /** 同时进行的大模型请求数，默认 2。 */
  concurrency?: number
  now?: () => number
  log?: (message: string) => void
}

/** AI 识别兜底。 */
export class AiScraper {
  private readonly limit: ReturnType<typeof createLimiter>
  private readonly now: () => number
  private readonly log: (message: string) => void
  private readonly inflight = new Map<string, Promise<AiGuess | null>>()
  private statusCache: { at: number; value: Promise<LibraryAiStatus> } | null =
    null
  private failures = 0
  private pausedUntil = 0

  constructor(private readonly deps: AiScraperDeps) {
    this.limit = createLimiter(deps.concurrency ?? 2)
    this.now = deps.now ?? Date.now
    this.log = deps.log ?? (() => {})
  }

  /** AI 状态（短时缓存，fresh 时重新查询；查询失败当作未配置）。 */
  status(fresh = false): Promise<LibraryAiStatus> {
    const now = this.now()
    const cached = this.statusCache
    if (!fresh && cached && now - cached.at <= STATUS_TTL_MS)
      return cached.value
    const value = this.deps.ai
      .status()
      .catch(() => ({ configured: false, fallback: false }))
    this.statusCache = { at: now, value }
    return value
  }

  /** 常规识别之后的兜底：开关打开、TMDB 库、结果是待确认 / 未匹配时才调用。 */
  async fallback(
    ctx: RunnerContext,
    target: IdentifyTarget,
    outcome: Outcome,
    changes: ItemChanges,
    signal?: AbortSignal
  ): Promise<Outcome> {
    if (outcome !== 'review' && outcome !== 'unmatched') return outcome
    if (target.source !== 'tmdb') return outcome
    const status = await this.status()
    if (!status.configured || !status.fallback) return outcome
    try {
      return (
        (await this.resolve(ctx, target, changes, signal, outcome)) ?? outcome
      )
    } catch (error) {
      if (signal?.aborted) throw error
      this.log(`AI 识别条目 ${target.id} 失败：${(error as Error).message}`)
      return outcome
    }
  }

  /** 手动「用 AI 识别」：只处理待确认 / 未匹配的 TMDB 条目，错误向上抛（计入失败）。 */
  async manual(
    ctx: RunnerContext,
    target: IdentifyTarget,
    changes: ItemChanges,
    signal?: AbortSignal
  ): Promise<Outcome> {
    const state = target.matchState
    if (
      target.source !== 'tmdb' ||
      (state !== 'review' && state !== 'unmatched')
    )
      return 'skipped'
    return (await this.resolve(ctx, target, changes, signal)) ?? state
  }

  /**
   * 推断 + 验证。返回 null 表示没有可用结果（认不出、把握太低、TMDB 没有候选），条目保持原样。
   * prior 是常规识别的结果：已是待确认时验证没通过就不覆盖它的候选。
   */
  private async resolve(
    ctx: RunnerContext,
    target: IdentifyTarget,
    changes: ItemChanges,
    signal?: AbortSignal,
    prior?: Outcome
  ): Promise<Outcome | null> {
    const input = this.inputOf(ctx, target)
    if (!input) return null
    const guess = await this.guess(
      input,
      isPrivateSource(target.source),
      signal
    )
    if (!guess || guess.confidence < AI_MIN_CONFIDENCE) return null
    const { provider, store } = ctx.deps
    const files = store.files(target.id)
    const seconds = files[0]?.duration ?? undefined
    const result = await identify(
      guessToInput(guess, input.kind, {
        runtimeMinutes: seconds ? Math.round(seconds / 60) : undefined,
        episodes:
          input.kind === 'tv'
            ? summarizeEpisodes(store.children(target.id))
            : undefined,
      }),
      { provider, secondaryLanguage: provider.secondaryLanguage, signal }
    )
    if (
      result.status === 'matched' &&
      acceptAiMatch(guess, result, input.kind)
    ) {
      const scored = markAi(result.scored!, guess.confidence)
      await ctx.applyRef(
        target,
        result.ref,
        'auto',
        { ...result, scored },
        changes,
        signal
      )
      this.log(`AI 识别：条目 ${target.id} → ${scored.candidate.title}`)
      return 'matched'
    }
    const candidates = aiCandidates(result, guess.confidence)
    if (!candidates.length || prior === 'review') return null
    return ctx.writeUndecided(target, candidates, changes, 'review')
  }

  /** 条目的线索：第一个视频文件、相对媒体库根的最后两级目录、同目录其他视频文件名。 */
  private inputOf(
    ctx: RunnerContext,
    target: IdentifyTarget
  ): GuessInput | null {
    const { store } = ctx.deps
    const file = store.files(target.id)[0]
    if (!file) return null
    const root = store.libraryRoot(target.libraryId)
    return {
      kind: target.type === 'movie' ? 'movie' : 'tv',
      fileName: file.name,
      folder: folderLabel(file.displayPath, root?.root),
      siblings: store.videoNamesIn(file.dir).filter(name => name !== file.name),
    }
  }

  /** 问大模型（缓存 → 合并同时发起的同一请求 → 熔断 → 限速）。 */
  private guess(
    input: GuessInput,
    isPrivate: boolean,
    signal?: AbortSignal
  ): Promise<AiGuess | null> {
    const key = guessCacheKey(input)
    const now = this.now()
    const cached = this.deps.cache.get(key)
    if (cached && cached.expiresAt > now) {
      return Promise.resolve(parseGuess(JSON.parse(cached.body)))
    }
    const pending = this.inflight.get(key)
    if (pending) return pending
    if (this.pausedUntil > now) {
      return Promise.reject(new Error('AI 接口连续出错，稍后再试'))
    }
    const task = this.limit(async () => {
      signal?.throwIfAborted()
      const data = await this.deps.ai.chatJson(
        buildGuessRequest(input, isPrivate)
      )
      return parseGuess(data)
    })
      .then(
        guess => {
          this.failures = 0
          // 认不出（null）也缓存：同一个文件名不再重复花费
          this.deps.cache.set(
            key,
            {
              body: JSON.stringify(guess),
              etag: null,
              expiresAt: this.now() + GUESS_TTL_MS,
            },
            this.now()
          )
          return guess
        },
        (error: unknown) => {
          if (!signal?.aborted && ++this.failures >= BREAKER_FAILURES) {
            this.pausedUntil = this.now() + BREAKER_PAUSE_MS
            this.failures = 0
          }
          throw error
        }
      )
      .finally(() => this.inflight.delete(key))
    this.inflight.set(key, task)
    return task
  }
}

/** 有大模型调用口时创建 AI 识别兜底（并发 2）；没有时返回 undefined。 */
export function aiScraper(
  ai: LibraryAi | undefined,
  cache: ResponseCache,
  log?: (message: string) => void
): AiScraper | undefined {
  return ai ? new AiScraper({ ai, cache, log }) : undefined
}

/** 手动 AI 识别的前置检查：环境不支持或没有配置 AI 时抛 invalid-params。 */
export async function requireAiConfigured(
  scraper: AiScraper | undefined
): Promise<void> {
  if (!scraper) {
    throw new LibraryError('invalid-params', '当前环境不支持 AI 识别')
  }
  if (!(await scraper.status(true)).configured) {
    throw new LibraryError('invalid-params', '还没有配置 AI 服务（设置 → AI）')
  }
}

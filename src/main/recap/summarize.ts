/**
 * 摘要：一集台词太长时先分段摘要、再合成整集摘要（控制每次请求的 tokens），结果按键缓存；
 * 问剧情时本集已播部分复用整集分段里「已封口」的段，只把封口段之后的原始台词直接送给模型。
 * 每次模型调用前检查 signal：渲染层取消（recap.cancel）后不再发起剩下的分段请求。
 *
 * 不依赖 Electron：模型调用与缓存由 index.ts 注入，测试里 mock。
 */
import { cuesBefore } from '../../shared/ai-subtitles/srt'
import type { AiMessage } from '../../shared/ai/types'
import {
  QA_RECENT_TOKENS,
  chunkKey,
  chunkLines,
  closedChunks,
  cueLines,
  tailLines,
  truncateToTokens,
} from '../../shared/recap/budget'
import {
  chunkSummaryMessages,
  episodeSummaryMessages,
  mergeSummaryMessages,
} from '../../shared/recap/prompts'
import type {
  RecapCurrentPart,
  RecapEpisodeSummary,
} from '../../shared/recap/types'
import type { RecapCache } from './cache'
import type { EpisodeMaterial, LocatedMaterial } from './sources'

/** 分集简介的上限（tokens） */
const OVERVIEW_TOKENS = 600

/** 一次调用的选项 */
export interface SummarizeCall {
  /** 来自私密板块：模型按设置只用本地，缓存只放内存 */
  private: boolean
  /** 请求被取消时中止（还没发出的模型调用不再发） */
  signal?: AbortSignal
}

/** 取消导致的失败（AiError 的 cancelled，或 AbortError） */
export function isCancelled(error: unknown): boolean {
  const value = error as { code?: unknown; name?: unknown } | null
  return value?.code === 'cancelled' || value?.name === 'AbortError'
}

/** 已取消就抛 AbortError */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
}

/** 摘要依赖 */
export interface SummarizerDeps {
  chat: (
    messages: AiMessage[],
    options: { maxTokens: number; private: boolean; signal?: AbortSignal }
  ) => Promise<string>
  cache: RecapCache
  warn?: (message: string) => void
}

/** 摘要器 */
export interface Summarizer {
  /** 之前某一集的摘要；没有可用素材时返回 null */
  episode(
    show: string,
    located: LocatedMaterial,
    call: SummarizeCall
  ): Promise<RecapEpisodeSummary | null>
  /** 本集截到 seconds 的已播部分 */
  current(
    show: string,
    located: LocatedMaterial | null,
    seconds: number,
    call: SummarizeCall
  ): Promise<RecapCurrentPart>
}

/** 创建摘要器 */
export function createSummarizer(deps: SummarizerDeps): Summarizer {
  /** 同一个键同时只算一次（前情提要和问剧情可能同时要同一集） */
  const inflight = new Map<string, Promise<string>>()

  const cached = async (
    key: string,
    call: SummarizeCall,
    make: () => Promise<string>
  ): Promise<string> => {
    for (;;) {
      throwIfAborted(call.signal)
      const hit = await deps.cache.get(key)
      if (hit) return hit
      const running = inflight.get(key)
      if (running) {
        try {
          return await running
        } catch (error) {
          // 共用的那次被它自己的请求取消了：本请求还要，就自己重算
          if (call.signal?.aborted || !isCancelled(error)) throw error
          continue
        }
      }
      const task = (async () => {
        const text = (await make()).trim()
        if (text)
          await deps.cache.set(key, text, !call.private).catch(error => {
            deps.warn?.(`写摘要缓存失败：${String(error)}`)
          })
        return text
      })()
      inflight.set(key, task)
      try {
        return await task
      } finally {
        if (inflight.get(key) === task) inflight.delete(key)
      }
    }
  }

  /** 发一次模型请求（发之前先看是否已取消） */
  const ask = (
    messages: AiMessage[],
    maxTokens: number,
    call: SummarizeCall
  ): Promise<string> => {
    throwIfAborted(call.signal)
    return deps.chat(messages, {
      maxTokens,
      private: call.private,
      ...(call.signal ? { signal: call.signal } : {}),
    })
  }

  /** 各段摘要（顺序执行，避免本地模型被并发压垮） */
  const chunkSummaries = async (
    show: string,
    located: LocatedMaterial,
    chunks: readonly string[][],
    total: number,
    call: SummarizeCall
  ): Promise<string[]> => {
    const out: string[] = []
    for (let i = 0; i < chunks.length; i += 1) {
      const text = await cached(chunkKey(located.key, i), call, () =>
        ask(
          chunkSummaryMessages({
            show,
            label: located.file.label,
            part: i + 1,
            total,
            text: chunks[i].join('\n'),
          }),
          500,
          call
        )
      )
      if (text) out.push(text)
    }
    return out
  }

  const linesOf = (material: EpisodeMaterial | null): string[] =>
    material?.kind === 'subtitle'
      ? cueLines(material.cues, material.bilingual)
      : []

  return {
    async episode(show, located, call) {
      const ref = {
        label: located.file.label,
        episode: located.file.episode,
        ...(located.file.season === undefined
          ? {}
          : { season: located.file.season }),
      }
      const hit = await deps.cache.get(located.key)
      if (hit) return { ...ref, text: hit, source: located.identity.kind }
      const material = await located.read()
      if (!material) return null
      if (material.kind === 'overview')
        return {
          ...ref,
          text: truncateToTokens(material.text, OVERVIEW_TOKENS),
          source: 'overview',
        }
      const lines = linesOf(material)
      if (!lines.length) return null
      const chunks = chunkLines(lines)
      const text = await cached(located.key, call, async () => {
        if (chunks.length === 1)
          return ask(
            episodeSummaryMessages({
              show,
              label: ref.label,
              text: chunks[0].join('\n'),
            }),
            700,
            call
          )
        const parts = await chunkSummaries(
          show,
          located,
          chunks,
          chunks.length,
          call
        )
        if (parts.length <= 1) return parts[0] ?? ''
        return ask(
          mergeSummaryMessages({ show, label: ref.label, parts }),
          700,
          call
        )
      })
      return text ? { ...ref, text, source: 'subtitle' } : null
    },

    async current(show, located, seconds, call) {
      const empty: RecapCurrentPart = {
        seconds,
        summaries: [],
        recent: '',
        hasSubtitle: false,
      }
      const material = located ? await located.read() : null
      // 本集只用台词：分集简介会剧透本集后面的内容
      if (!located || material?.kind !== 'subtitle') return empty
      const all = linesOf(material)
      const prefix = cueLines(
        cuesBefore(material.cues, seconds),
        material.bilingual
      )
      const closed = closedChunks(prefix)
      const summaries = closed.chunks.length
        ? await chunkSummaries(
            show,
            located,
            closed.chunks,
            chunkLines(all).length,
            call
          )
        : []
      // 已封口段已经以摘要出现，原始台词只取它们之后的部分，避免同一段既摘要又原文
      const rest = prefix.slice(closed.covered)
      return {
        seconds,
        summaries,
        recent: tailLines(rest, QA_RECENT_TOKENS).join('\n'),
        hasSubtitle: true,
      }
    },
  }
}

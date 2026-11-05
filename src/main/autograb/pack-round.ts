/**
 * 追更 · 合集优先的一轮（ADR-0050）：逐集搜之前，到点等待的缺集不少于 {@link PACK_MIN_MISSING} 集的剧，
 * 先找一次合集（pack-finder.ts），认到的集写成「有候选」，和逐集搜到的一样交给确认 / 全自动流程；
 * 没认到的集保持等待，由后面的逐集搜接着找。同一部剧 {@link PACK_RETRY_MS} 内不重复找（内存里记，重启后重找）。
 */
import type { GrabPrefs } from '../../shared/contract/grab-prefs'
import type { createFinder } from './finder'
import { packKey } from './pack-finder'
import { isDue } from './schedule-rules'
import type { AutograbState, EpisodeRecord } from './state'

/** 缺多少集才先找合集 */
export const PACK_MIN_MISSING = 2
/** 同一部剧多久内不重复找合集 */
export const PACK_RETRY_MS = 6 * 3_600_000
/** 一次最多带多少个缺集去认 */
const PACK_MAX_TARGETS = 60

/** 上下文 */
export interface PackRoundContext {
  state(): AutograbState
  finder: Pick<ReturnType<typeof createFinder>, 'findPack'>
  paused(): boolean
  /** 这部剧实际方式不是「不追」 */
  tracked(seriesId: number): boolean
  prefs(seriesId: number): GrabPrefs
  originalTitle(seriesId: number): string | undefined
  dirty(): void
  log(message: string): void
}

/** 创建合集优先的一轮 */
export function createPackRound(ctx: PackRoundContext): {
  run(now: number): Promise<void>
} {
  const tried = new Map<number, number>()
  return {
    async run(now: number): Promise<void> {
      const bySeries = new Map<number, EpisodeRecord[]>()
      for (const r of Object.values(ctx.state().episodes))
        if (
          r.status === 'waiting' &&
          ctx.tracked(r.seriesId) &&
          isDue(r.airDate, r.nextTry, now)
        )
          bySeries.set(r.seriesId, [...(bySeries.get(r.seriesId) ?? []), r])
      for (const [seriesId, all] of bySeries) {
        if (ctx.paused()) return
        if (all.length < PACK_MIN_MISSING) continue
        if (now - (tried.get(seriesId) ?? -Infinity) < PACK_RETRY_MS) continue
        tried.set(seriesId, now)
        const records = all
          .sort((a, b) => a.airDate.localeCompare(b.airDate))
          .slice(0, PACK_MAX_TARGETS)
        const byKey = new Map(records.map(r => [packKey(r), r]))
        try {
          const found = await ctx.finder.findPack(
            {
              seriesTitle: records[0].seriesTitle,
              originalTitle: ctx.originalTitle(seriesId),
            },
            records,
            {
              prefs: ctx.prefs(seriesId),
              banned: target => byKey.get(packKey(target))?.banned ?? [],
            }
          )
          let hit = 0
          for (const [key, candidates] of found) {
            const record = byKey.get(key)
            if (!record || !candidates.length) continue
            record.attempts++
            record.candidates = candidates
            record.status = 'found'
            record.nextTry = null
            record.error = null
            hit++
          }
          if (hit) {
            ctx.log(
              `合集里认到 ${records[0].seriesTitle} 的 ${hit}/${records.length} 个缺集`
            )
            ctx.dirty()
          }
        } catch (error) {
          ctx.log(`找合集失败：${(error as Error).message}`)
        }
      }
    },
  }
}

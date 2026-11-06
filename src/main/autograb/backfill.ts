/**
 * 追更 · 存整部剧（ADR-0049）：在线剧建好片库条目后登记一次，开始追更的第一轮把它已播出的全部缺集建成记录
 * （平时的日历只往回看 14 天，会漏掉更早播出的集）。
 */
import type { AutograbDeps } from './deps'
import { applyCalendar } from './records'
import { localDate } from './schedule-rules'
import type { AutograbState } from './state'
import { seriesModeOf } from './policy'

/** 上下文 */
export interface BackfillContext {
  state(): AutograbState
  /** 取依赖时再读（测试会在建服务之后替换 seriesEpisodes） */
  deps(): Pick<AutograbDeps, 'seriesEpisodes' | 'log'>
  dirty(): void
}

/** 登记了「存整部剧」且已开始追更的剧：把已播出的全部缺集建成记录（一次性；查不到就留着下一轮再试） */
export async function runBackfill(
  ctx: BackfillContext,
  now: number
): Promise<void> {
  const state = ctx.state()
  const pending = state.backfill ?? []
  const { seriesEpisodes, log } = ctx.deps()
  if (!pending.length || !seriesEpisodes) return
  const today = localDate(now)
  for (const id of [...pending]) {
    if (seriesModeOf(state, id) === 'off') continue
    try {
      const episodes = await seriesEpisodes(id, today, state.series[String(id)])
      if (applyCalendar(state, episodes, today)) ctx.dirty()
      state.backfill = (state.backfill ?? []).filter(x => x !== id)
      ctx.dirty()
    } catch (error) {
      log(`存整部剧失败：${(error as Error).message}`)
    }
  }
}

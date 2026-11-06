/** 追剧任务的手动操作与共享闸门；所有操作先等待状态加载。 */
import type { AutograbDeps, AutograbService, Pan115Guard } from './deps'
import type { AutograbResult } from '../../shared/contract/autograb'
import type { Gate } from './gate'
import { episodeKey } from './schedule-rules'
import { revertEpisode } from './revert'
import { retryRecord, skipRecord } from './records'
import { type AutograbState, BLOCK_MS, type EpisodeRecord } from './state'
import type { createSaver } from './saver'

interface ControlContext {
  state(): AutograbState
  load(): Promise<void>
  gate(): Gate
  deps: AutograbDeps
  dirty(): void
  tick(): Promise<void>
  grab(
    record: EpisodeRecord,
    index: number,
    byUser: boolean
  ): Promise<AutograbResult>
  saver: Pick<ReturnType<typeof createSaver>, 'rescan'>
}

/** 创建任务手动操作，沿用统一状态、单飞转存与115闸门。 */
export function createControls(
  ctx: ControlContext
): Pick<
  AutograbService,
  | 'grab'
  | 'revert'
  | 'skip'
  | 'rescan'
  | 'retry'
  | 'resume'
  | 'gate'
  | 'isSaved'
  | 'guard'
> {
  return {
    async grab(key: string, index: number): Promise<AutograbResult> {
      await ctx.load()
      const record = ctx.state().episodes[key]
      if (!record) return { ok: false, error: '记录不存在' }
      if (ctx.gate().paused())
        return {
          ok: false,
          error: ctx.state().gate.pauseReason ?? '追更已暂停',
        }
      return ctx.grab(record, index, true)
    },
    async revert(key: string): Promise<AutograbResult> {
      await ctx.load()
      const record = ctx.state().episodes[key]
      if (!record) return { ok: false, error: '记录不存在' }
      if (ctx.gate().paused())
        return {
          ok: false,
          error: ctx.state().gate.pauseReason ?? '追更已暂停',
        }
      try {
        const result = await revertEpisode(
          { gate: () => ctx.gate(), deps: ctx.deps, dirty: ctx.dirty },
          record
        )
        if (result.ok) void ctx.tick()
        return result
      } catch (error) {
        return { ok: false, error: `撤销失败：${(error as Error).message}` }
      }
    },
    async skip(key: string): Promise<void> {
      await ctx.load()
      if (skipRecord(ctx.state().episodes[key])) ctx.dirty()
    },
    async rescan(key: string): Promise<AutograbResult> {
      await ctx.load()
      const record = ctx.state().episodes[key]
      if (!record) return { ok: false, error: '记录不存在' }
      if (ctx.gate().paused())
        return {
          ok: false,
          error: ctx.state().gate.pauseReason ?? '追更已暂停',
        }
      try {
        return await ctx.saver.rescan(record)
      } catch (error) {
        return { ok: false, error: `重新入库失败：${(error as Error).message}` }
      }
    },
    async retry(key: string): Promise<void> {
      await ctx.load()
      if (!retryRecord(ctx.state().episodes[key], ctx.deps.now())) return
      ctx.dirty()
      void ctx.tick()
    },
    async resume(): Promise<void> {
      await ctx.load()
      ctx.gate().resume()
      ctx.state().spacePause = null
      ctx.dirty()
    },
    async gate(): Promise<Gate> {
      await ctx.load()
      return ctx.gate()
    },
    isSaved(seriesId: number, season: number, episode: number): boolean {
      const state = ctx.state()
      const taskId =
        state.version === 2
          ? Object.entries(state.series).find(
              ([, task]) => task.libraryItemId === seriesId
            )?.[0]
          : String(seriesId)
      if (!taskId) return false
      const key = episodeKey(Number(taskId), season, episode)
      return ctx.state().episodes[key]?.status === 'saved'
    },
    async guard(): Promise<Pan115Guard> {
      await ctx.load()
      return {
        // 闸门在加载后会重建：每次调用都取当前的那一个
        run: (kind, task) => ctx.gate().run(kind, task),
        pauseReason: () =>
          ctx.gate().paused()
            ? (ctx.state().gate.pauseReason ?? '115 闸门已暂停')
            : null,
        blocked: code => (ctx.state().blacklist[code] ?? 0) > ctx.deps.now(),
        block: code => {
          ctx.state().blacklist[code] = ctx.deps.now() + BLOCK_MS
          ctx.dirty()
        },
      }
    },
  }
}

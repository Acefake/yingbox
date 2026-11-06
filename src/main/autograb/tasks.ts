/** 独立追剧任务的草稿、确认启动、设置与取消。 */
import type {
  AutograbResult,
  AutograbSeriesPatch,
} from '../../shared/contract/autograb'
import { effectiveMode } from '../../shared/contract/grab-policy'
import type { SeriesInfo } from './catalog'
import type { AutograbDeps, AutograbService } from './deps'
import { createSingleFlight } from './flight'
import { applySeriesPatch, seriesModeOf } from './policy'
import type { AutograbState, SeriesSetting } from './state'

interface TaskContext {
  state(): AutograbState
  load(): Promise<void>
  dirty(): void
  tick(): Promise<void>
  deps: Pick<AutograbDeps, 'pan' | 'save'>
  targetCid(
    setting: Pick<SeriesSetting, 'cid'> | undefined,
    seriesId?: number
  ): string
  titleOf(seriesId: number): string | undefined
  removed(seriesId: number): void
}

/** 设置草稿不运行；最终确认后才登记补全集任务并触发检查。 */
export function createTaskControls(
  ctx: TaskContext
): Pick<AutograbService, 'track' | 'startSeries' | 'backfill' | 'setSeries'> {
  const { load: ensureLoaded, dirty, tick, deps, targetCid } = ctx
  const settingOf = (id: number): SeriesSetting | undefined =>
    ctx.state().series[String(id)]
  const starts = createSingleFlight()
  return {
    async track(info: SeriesInfo, libraryItemId?: number): Promise<number> {
      await ensureLoaded()
      const state = ctx.state()
      const found = Object.entries(state.series).find(
        ([, s]) =>
          s.tmdbId === info.tmdbId ||
          (!s.tmdbId &&
            s.title.replace(/\s/g, '').toLowerCase() ===
              info.title.replace(/\s/g, '').toLowerCase() &&
            (!s.year || s.year === info.year))
      )
      if (found) {
        Object.assign(
          found[1],
          info,
          libraryItemId ? { libraryItemId, syncLibrary: true } : {}
        )
        if (
          !found[1].pending &&
          seriesModeOf(state, Number(found[0])) === 'off'
        )
          found[1].mode = state.policy.mode === 'off' ? 'confirm' : 'inherit'
        dirty()
        return Number(found[0])
      }
      const id = Math.max(
        state.nextSeriesId ?? 1,
        ...Object.keys(state.series).map(key => Number(key) + 1)
      )
      state.nextSeriesId = id + 1
      state.version = 2
      state.series[String(id)] = {
        ...info,
        pending: true,
        ...(libraryItemId ? { libraryItemId, syncLibrary: true } : {}),
        mode: state.policy.mode === 'off' ? 'confirm' : 'inherit',
        cid: '',
        cidName: '',
        confirmed: 0,
        prefs: {},
      }
      dirty()
      return id
    },
    startSeries: seriesId =>
      starts.run(String(seriesId), async (): Promise<AutograbResult> => {
        await ensureLoaded()
        const state = ctx.state()
        const setting = settingOf(seriesId)
        if (!setting)
          return { ok: false, error: '追剧任务不存在，请重新加入追剧' }
        if (!setting.pending) return { ok: true }
        if (!deps.pan.loggedIn())
          return { ok: false, error: '请先登录 115 网盘' }
        if (!deps.pan.pansouReady())
          return { ok: false, error: '请先配置 PanSou 搜索服务' }
        if (effectiveMode(setting.mode, state.policy) === 'off')
          return { ok: false, error: '请先选择追更方式' }
        if (targetCid(setting, seriesId) === '0')
          return { ok: false, error: '请先选择 115 转存目录（不能是根目录）' }
        const committed = structuredClone(state)
        committed.series[String(seriesId)].pending = false
        committed.backfill = [
          ...new Set([...(committed.backfill ?? []), seriesId]),
        ]
        await deps.save(committed)
        if (settingOf(seriesId) !== setting)
          return { ok: false, error: '追剧任务已取消' }
        setting.pending = false
        state.backfill = [...new Set([...(state.backfill ?? []), seriesId])]
        dirty()
        void tick()
        return { ok: true }
      }),
    async backfill(seriesId: number): Promise<void> {
      await ensureLoaded()
      const state = ctx.state()
      const list = state.backfill ?? []
      if (list.includes(seriesId)) return
      state.backfill = [...list, seriesId]
      dirty()
      if (seriesModeOf(state, seriesId) !== 'off') void tick()
    },
    async setSeries(
      seriesId: number,
      patch: AutograbSeriesPatch
    ): Promise<AutograbResult> {
      await ensureLoaded()
      const state = ctx.state()
      if (state.version === 2 && !settingOf(seriesId) && patch.mode !== 'off')
        return { ok: false, error: '追剧任务不存在，请重新加入追剧' }
      if (state.version === 2 && patch.mode === 'off') {
        delete state.series[String(seriesId)]
        for (const [key, record] of Object.entries(state.episodes))
          if (record.seriesId === seriesId) delete state.episodes[key]
        state.backfill = (state.backfill ?? []).filter(id => id !== seriesId)
        ctx.removed(seriesId)
        dirty()
        await deps.save(state)
        return { ok: true }
      }
      const result = applySeriesPatch(
        state,
        seriesId,
        ctx.titleOf(seriesId) || patch.title || '',
        patch,
        targetCid
      )
      if (!result.ok) return result
      dirty()
      if (patch.mode && seriesModeOf(state, seriesId) !== 'off') void tick()
      return { ok: true }
    },
  }
}

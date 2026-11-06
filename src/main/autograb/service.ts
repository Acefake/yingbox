/**
 * 追更服务：定时一轮「看日历 → 建缺集记录 → 搜候选 → （全自动时）转存 → 核对入库」。
 * 不依赖 Electron：日历、通知、115 / PanSou、状态读写、时钟都由 index.ts 注入，测试可全部替换。
 * 只处理已确认开启的任务；策略、目录、限额和文件归属由 policy、target、saver 校验。
 */
import type {
  AutograbOverview,
  AutograbResult,
} from '../../shared/contract/autograb'
import type {
  GrabPolicy,
  GrabPolicyPatch,
} from '../../shared/contract/grab-policy'
import type { CalendarEpisode } from '../../shared/library/ipc'
import type { AutograbDeps, AutograbService } from './deps'
import { createControls } from './controls'
import { createFinder } from './finder'
import { createRoundRunner, createSingleFlight } from './flight'
import { createGate } from './gate'
import { buildOverview } from './overview'
import {
  anyTracked,
  applyCategoryFolder,
  applyPolicyPatch,
  eligibleForAutomatic,
  seriesModeOf,
  seriesPrefsOf,
  targetResolver,
  trackedTasks,
} from './policy'
import {
  MAX_SEARCH_PER_TICK,
  addDays,
  calendarRange,
  isDue,
  localDate,
  nextTry,
} from './schedule-rules'
import { runBackfill } from './backfill'
import { createPackRound } from './pack-round'
import { adopt } from './reconcile'
import { applyCalendar } from './records'
import { createSaver } from './saver'
import { createTaskControls } from './tasks'
import { episodeTarget } from './target'
import {
  type AutograbState,
  BLOCK_MS,
  type EpisodeRecord,
  type SeriesSetting,
  emptyState,
  parseState,
  pruneEpisodes,
} from './state'

export type { AutograbService } from './deps'

/** 创建追更服务 */
export function createAutograbService(deps: AutograbDeps): AutograbService {
  let state: AutograbState = emptyState(deps.now())
  let loaded: Promise<void> | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let running = false
  /** 最近一次日历里出现的剧 */
  let airing = new Map<number, string>()
  let lastCalendar: CalendarEpisode[] = []
  /** 上一轮就绪后真正开始检查的时间 */
  let lastRunAt: number | null = null
  /** 第一次打开界面时的日历兜底只试一次（库里没有匹配的剧时日历一直是空的，不能每次刷新都重拉） */
  let calendarTried = false
  let lastError: string | null = null
  const loadCalendar = (): ReturnType<AutograbDeps['calendar']> =>
    deps.calendar(calendarRange(deps.now()), trackedTasks(state))

  // 闸门持有 state.gate 的引用：load 之后要重建
  let gateRef = createGate(
    state.gate,
    { now: deps.now, sleep: deps.sleep },
    dirty
  )

  /** 加载后改一下状态并保存 */
  async function change(edit: () => void): Promise<void> {
    await ensureLoaded()
    edit()
    dirty()
  }

  function dirty(): void {
    deps.emit()
    if (saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      void deps
        .save(state)
        .catch(e => deps.log(`保存失败：${(e as Error).message}`))
    }, 500)
  }

  function ensureLoaded(): Promise<void> {
    loaded ??= deps
      .load()
      .then(raw => {
        state = parseState(raw, deps.now())
      })
      .catch(error => {
        loaded = null
        throw error
      })
      .then(() => {
        gateRef = createGate(
          state.gate,
          { now: deps.now, sleep: deps.sleep },
          dirty
        )
      })
    return loaded
  }

  const finder = createFinder({
    search: keyword => deps.pan.search(keyword),
    snap: (item, dir, offset) =>
      gateRef.run('snap', () =>
        deps.pan.snap(item.url, item.receiveCode, dir, offset)
      ),
    blocked: code => (state.blacklist[code] ?? 0) > deps.now(),
    block: code => {
      state.blacklist[code] = deps.now() + BLOCK_MS
      dirty()
    },
    now: deps.now,
  })

  const settingOf = (seriesId: number): SeriesSetting | undefined =>
    state.series[String(seriesId)]

  const targetCid = targetResolver(
    () => state,
    () => deps.defaultFolder(),
    () => lastCalendar
  )

  async function syncRecords(
    episodes: CalendarEpisode[],
    now: number
  ): Promise<void> {
    airing = new Map(episodes.map(e => [e.seriesId, e.seriesTitle]))
    if (
      state.version === 1 &&
      (await adopt(state, episodes, deps.seriesExists))
    )
      dirty()
    const saved = Object.values(state.episodes).filter(
      r => r.status === 'saved'
    )
    if (applyCalendar(state, episodes, localDate(now))) dirty()
    const landed = saved.filter(r => r.status === 'done')
    if (landed.length) deps.landed?.(landed)
  }

  async function searchOne(record: EpisodeRecord, now: number): Promise<void> {
    const prefs = seriesPrefsOf(state, record.seriesId)
    const result = await finder.find(
      {
        seriesTitle: record.seriesTitle,
        originalTitle:
          lastCalendar.find(e => e.seriesId === record.seriesId)
            ?.originalTitle ?? undefined,
        season: record.season,
        episode: record.episode,
      },
      { prefs, banned: record.banned }
    )
    if (state.episodes[record.key] !== record || record.status !== 'waiting')
      return
    record.attempts++
    record.candidates = result.candidates
    record.error = result.note
    if (result.candidates.length) {
      record.status = 'found'
      record.nextTry = null
    } else {
      record.nextTry = nextTry(record.airDate, now)
      record.status = record.nextTry === null ? 'notFound' : 'waiting'
    }
    dirty()
    if (autoGrabbable(record)) await grab(record, 0, false)
  }

  const autoGrabbable = (record: EpisodeRecord): boolean =>
    deps.pan.loggedIn() &&
    deps.pan.pansouReady() &&
    eligibleForAutomatic(state, record, targetCid(settingOf(record.seriesId)))

  const saver = createSaver({
    automaticAllowed: autoGrabbable,
    state: () => state,
    gate: () => gateRef,
    deps,
    dirty,
    targetCid: episodeTarget(
      deps,
      () => gateRef,
      id => settingOf(id)?.cid ?? '',
      id => targetCid(undefined, id)
    ),
  })
  const backfillCtx = {
    state: () => state,
    deps: () => deps,
    dirty,
  }
  const packRound = createPackRound({
    state: () => state,
    finder,
    paused: () => gateRef.paused(),
    tracked: id =>
      (state.version === 1 || !!settingOf(id)) &&
      seriesModeOf(state, id) !== 'off',
    prefs: id => seriesPrefsOf(state, id),
    originalTitle: id =>
      lastCalendar.find(e => e.seriesId === id)?.originalTitle ?? undefined,
    dirty,
    changed: () => deps.emit(),
    log: message => deps.log(message),
  })
  /** 同一集的转存单飞：全自动与手动点、连点撞在一起时只发一次 */
  const grabs = createSingleFlight()
  const grab = (
    record: EpisodeRecord,
    index: number,
    byUser: boolean
  ): Promise<AutograbResult> =>
    grabs.run(record.key, () => saver.grab(record, index, byUser))

  /** 跑一轮；已在跑时这一轮完了再补跑一轮（不并发两轮，见 flight.ts） */
  const rounds = createRoundRunner(() => runOnce())
  const tick = (): Promise<void> => rounds.run()

  async function runOnce(): Promise<void> {
    await ensureLoaded()
    if (!state.enabled) return
    if (!anyTracked(state)) return
    running = true
    deps.emit()
    try {
      const now = deps.now()
      if (state.gate.loginPause && deps.pan.loggedIn()) gateRef.resume()
      const result = await loadCalendar()
      lastError = result.failed
        ? `${result.failed} 部剧获取分集失败，请检查 TMDB 设置后重试`
        : null
      lastCalendar = result.episodes.filter(
        ep => state.version === 1 || !!settingOf(ep.seriesId)
      )
      await syncRecords(lastCalendar, now)
      dirty()
      await runBackfill(backfillCtx, now)
      pruneEpisodes(state, addDays(localDate(now), -60))
      if (gateRef.paused() || !deps.pan.loggedIn() || !deps.pan.pansouReady())
        return
      lastRunAt = deps.now()
      await packRound.run(now)
      const records = Object.values(state.episodes)
      for (const record of records.filter(r => r.status === 'saved'))
        await saver
          .followSaved(record, now)
          .catch(e => deps.log((e as Error).message))
      // 合集候选先转存再补搜；失败候选不自动重试，避免耗尽 115 限额。
      const waiting = records
        .filter(r => r.error === null && autoGrabbable(r))
        .sort((a, b) => a.airDate.localeCompare(b.airDate))
      for (const record of waiting) {
        if (gateRef.paused()) break
        if (!autoGrabbable(record)) continue
        const result = await grab(record, 0, false).catch(e =>
          deps.log((e as Error).message)
        )
        if (result && !result.ok && result.retryLater) return
      }
      const due = records
        .filter(
          r =>
            r.status === 'waiting' && seriesModeOf(state, r.seriesId) !== 'off'
        )
        .filter(r => isDue(r.airDate, r.nextTry, now))
        .sort((a, b) => a.airDate.localeCompare(b.airDate))
        .slice(0, MAX_SEARCH_PER_TICK)
      for (const record of due) {
        if (!state.enabled || !deps.pan.loggedIn() || !deps.pan.pansouReady())
          return
        if (gateRef.paused()) break
        if (state.episodes[record.key] !== record) continue
        try {
          await searchOne(record, deps.now())
        } catch (error) {
          record.error = (error as Error).message
          record.nextTry = nextTry(record.airDate, deps.now())
          if (record.nextTry === null) record.status = 'notFound'
          dirty()
        }
      }
    } catch (error) {
      lastError = (error as Error).message
      deps.log(`追更一轮失败：${(error as Error).message}`)
    } finally {
      running = false
      deps.emit()
    }
  }

  return {
    ...createTaskControls({
      state: () => state,
      load: ensureLoaded,
      dirty,
      tick,
      deps,
      targetCid,
      titleOf: id => airing.get(id),
      removed: id => {
        lastCalendar = lastCalendar.filter(ep => ep.seriesId !== id)
        airing.delete(id)
        packRound.forget(id)
      },
    }),
    tick,
    async overview(): Promise<AutograbOverview> {
      await ensureLoaded()
      if (!lastCalendar.length && !running && !calendarTried) {
        calendarTried = true
        const result = await loadCalendar().catch(() => null)
        if (result) {
          lastCalendar = result.episodes.filter(
            ep => state.version === 1 || !!settingOf(ep.seriesId)
          )
          await syncRecords(lastCalendar, deps.now())
        }
      }
      gateRef.paused()
      return {
        ...buildOverview(state, {
          ready: {
            loggedIn: deps.pan.loggedIn(),
            pansou: deps.pan.pansouReady(),
          },
          airing,
          calendar: lastCalendar,
          today: localDate(deps.now()),
          lastRunAt,
          intervalMs: deps.intervalMs ?? null,
          running,
          packSearch: packRound.progress(),
          automatic: record =>
            !record.error && !gateRef.paused() && autoGrabbable(record),
          defaultFolder: deps.defaultFolder(),
        }),
        calendarEpisodes: lastCalendar,
        error: lastError,
      }
    },
    setEnabled: enabled => change(() => void (state.enabled = enabled)),
    setPrefs: prefs =>
      change(() => void (state.policy = { ...state.policy, prefs })),
    setCategoryFolder: (category, cid, name) =>
      change(() => applyCategoryFolder(state, category, cid, name)),
    async policy(): Promise<GrabPolicy> {
      await ensureLoaded()
      return state.policy
    },
    async setPolicy(patch: GrabPolicyPatch): Promise<AutograbResult> {
      await ensureLoaded()
      const result = applyPolicyPatch(state, patch, targetCid(undefined))
      if (!result.ok) return result
      dirty()
      if (patch.mode && patch.mode !== 'off') void tick()
      return result
    },
    ...createControls({
      state: () => state,
      load: ensureLoaded,
      gate: () => gateRef,
      deps,
      dirty,
      tick,
      grab,
      saver,
    }),
  }
}

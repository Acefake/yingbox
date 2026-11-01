/**
 * 追更服务：定时一轮「看日历 → 建缺集记录 → 搜候选 → （全自动时）转存 → 核对入库」。
 * 不依赖 Electron：日历、通知、115 / PanSou、状态读写、时钟都由 index.ts 注入，测试可全部替换。
 * 安全边界：只追实际方式不是「不追」的剧，本地已有这一集就不搜；全自动要匹配分过 {@link AUTO_SCORE}、
 * 手动确认够门槛集数、转存目标不是根目录（目标 = 这部剧的文件夹 > 所属分类的文件夹 > 剧集默认目录，见 policy.ts）；
 * 转存前列目标文件夹（同名已在不存）、查剩余空间（不够暂停自动转存）；撤销只删记录里的文件；115 请求全过闸门。
 */
import type {
  AutograbOverview,
  AutograbResult,
  AutograbSeriesPatch,
} from '../../shared/contract/autograb'
import type {
  GrabPolicy,
  GrabPolicyPatch,
} from '../../shared/contract/grab-policy'
import type { CalendarEpisode } from '../../shared/library/ipc'
import type { AutograbDeps, AutograbService, Pan115Guard } from './deps'
import { createFinder } from './finder'
import { createRoundRunner, createSingleFlight } from './flight'
import { type Gate, createGate } from './gate'
import { AUTO_SCORE } from './match-rules'
import { buildOverview } from './overview'
import {
  anyTracked,
  applyCategoryFolder,
  applyPolicyPatch,
  applySeriesPatch,
  confirmFirstOf,
  seriesModeOf,
  seriesPrefsOf,
  targetResolver,
} from './policy'
import { revertEpisode } from './revert'
import {
  MAX_SEARCH_PER_TICK,
  addDays,
  calendarRange,
  episodeKey,
  isDue,
  localDate,
  nextTry,
} from './schedule-rules'
import { adopt } from './reconcile'
import { applyCalendar } from './records'
import { createSaver } from './saver'
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
      .catch(() => {
        state = emptyState(deps.now())
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
    if (await adopt(state, episodes, deps.seriesExists)) dirty()
    const saved = Object.values(state.episodes).filter(
      r => r.status === 'saved'
    )
    if (applyCalendar(state, episodes, localDate(now))) dirty()
    const landed = saved.filter(r => r.status === 'done')
    if (landed.length) deps.landed?.(landed)
  }

  async function searchOne(record: EpisodeRecord, now: number): Promise<void> {
    const setting = settingOf(record.seriesId)
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
    const best = record.candidates[0]
    if (
      record.status === 'found' &&
      state.spacePause === null &&
      seriesModeOf(state, record.seriesId) === 'auto' &&
      targetCid(setting) !== '0' &&
      (setting?.confirmed ?? 0) >= confirmFirstOf(state, setting) &&
      best.score >= AUTO_SCORE
    )
      await grab(record, 0, false)
  }

  const saver = createSaver({
    state: () => state,
    gate: () => gateRef,
    deps,
    dirty,
    targetCid: record => targetCid(settingOf(record.seriesId), record.seriesId),
  })
  /** 同一集的转存单飞：全自动与手动点、连点撞在一起时只发一次 */
  const grabs = createSingleFlight()
  const grab = (
    record: EpisodeRecord,
    index: number,
    byUser: boolean
  ): Promise<AutograbResult> =>
    grabs.run(record.key, () => saver.grab(record, index, byUser))
  const followSaved = saver.followSaved

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
      const result = await deps.calendar(calendarRange(now))
      lastCalendar = result.episodes
      await syncRecords(result.episodes, now)
      pruneEpisodes(state, addDays(localDate(now), -60))
      if (gateRef.paused() || !deps.pan.loggedIn() || !deps.pan.pansouReady())
        return
      lastRunAt = deps.now()
      const records = Object.values(state.episodes)
      for (const record of records.filter(r => r.status === 'saved'))
        await followSaved(record, now).catch(e =>
          deps.log((e as Error).message)
        )
      const due = records
        .filter(
          r =>
            r.status === 'waiting' && seriesModeOf(state, r.seriesId) !== 'off'
        )
        .filter(r => isDue(r.airDate, r.nextTry, now))
        .sort((a, b) => a.airDate.localeCompare(b.airDate))
        .slice(0, MAX_SEARCH_PER_TICK)
      for (const record of due) {
        if (gateRef.paused()) break
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
      deps.log(`追更一轮失败：${(error as Error).message}`)
    } finally {
      running = false
      deps.emit()
    }
  }

  return {
    tick,
    async overview(): Promise<AutograbOverview> {
      await ensureLoaded()
      if (!lastCalendar.length && !running && !calendarTried) {
        calendarTried = true
        const result = await deps
          .calendar(calendarRange(deps.now()))
          .catch(() => null)
        if (result) {
          lastCalendar = result.episodes
          await syncRecords(result.episodes, deps.now())
        }
      }
      gateRef.paused()
      return buildOverview(state, {
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
        defaultFolder: deps.defaultFolder(),
      })
    },
    setEnabled: enabled => change(() => void (state.enabled = enabled)),
    async setSeries(
      seriesId: number,
      patch: AutograbSeriesPatch
    ): Promise<AutograbResult> {
      await ensureLoaded()
      const result = applySeriesPatch(
        state,
        seriesId,
        airing.get(seriesId) || patch.title || '',
        patch,
        targetCid
      )
      if (!result.ok) return result
      dirty()
      if (patch.mode && seriesModeOf(state, seriesId) !== 'off') void tick()
      return { ok: true }
    },
    async grab(key: string, index: number): Promise<AutograbResult> {
      await ensureLoaded()
      const record = state.episodes[key]
      if (!record) return { ok: false, error: '记录不存在' }
      if (gateRef.paused())
        return { ok: false, error: state.gate.pauseReason ?? '追更已暂停' }
      return grab(record, index, true)
    },
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
    async revert(key: string): Promise<AutograbResult> {
      await ensureLoaded()
      const record = state.episodes[key]
      if (!record) return { ok: false, error: '记录不存在' }
      if (gateRef.paused())
        return { ok: false, error: state.gate.pauseReason ?? '追更已暂停' }
      try {
        const result = await revertEpisode(
          { gate: () => gateRef, deps, dirty },
          record
        )
        if (result.ok) void tick()
        return result
      } catch (error) {
        return { ok: false, error: `撤销失败：${(error as Error).message}` }
      }
    },
    async skip(key: string): Promise<void> {
      await ensureLoaded()
      const record = state.episodes[key]
      if (!record || record.status === 'done') return
      record.status = 'skipped'
      record.nextTry = null
      dirty()
    },
    async retry(key: string): Promise<void> {
      await ensureLoaded()
      const record = state.episodes[key]
      if (!record || record.status === 'done' || record.status === 'saved')
        return
      record.status = 'waiting'
      record.candidates = []
      record.error = null
      record.nextTry = deps.now()
      dirty()
      void tick()
    },
    async resume(): Promise<void> {
      await ensureLoaded()
      gateRef.resume()
      state.spacePause = null
      dirty()
    },
    async gate(): Promise<Gate> {
      await ensureLoaded()
      return gateRef
    },
    isSaved(seriesId: number, season: number, episode: number): boolean {
      const key = episodeKey(seriesId, season, episode)
      return state.episodes[key]?.status === 'saved'
    },
    async guard(): Promise<Pan115Guard> {
      await ensureLoaded()
      return {
        // 闸门在加载后会重建：每次调用都取当前的那一个
        run: (kind, task) => gateRef.run(kind, task),
        pauseReason: () =>
          gateRef.paused()
            ? (state.gate.pauseReason ?? '115 闸门已暂停')
            : null,
        blocked: code => (state.blacklist[code] ?? 0) > deps.now(),
        block: code => {
          state.blacklist[code] = deps.now() + BLOCK_MS
          dirty()
        },
      }
    },
  }
}

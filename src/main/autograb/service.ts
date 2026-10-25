/**
 * 追更服务：定时一轮「看日历 → 建缺集记录 → 搜候选 → （全自动时）转存 → 核对入库」。
 *
 * 不依赖 Electron：日历、媒体库通知、115 / PanSou、状态读写、时钟都由 index.ts 注入，测试可全部替换。
 * 安全边界：
 * - 只追用户打开了追更的剧；本地已有这一集（任何来源）就不搜；
 * - 全自动只在分数过 {@link AUTO_SCORE}、这部剧已确认过 {@link AUTO_AFTER_CONFIRMED} 集、且设了 115 文件夹时才转存；
 * - 转存前先列目标文件夹，同名文件已在就不再转存；每集一条记录，转存过的集不会再转存；
 * - 115 请求全部过闸门（限速、限额、熔断，见 gate.ts）。
 */
import type {
  AutograbOverview,
  AutograbResult,
  AutograbSeriesPatch,
} from '../../shared/contract/autograb'
import type { NetdiskItem, ShareSnap } from '../../shared/contract/pan115'
import type {
  CalendarEpisode,
  CalendarRequest,
  CalendarResult,
  FileChangeNotice,
} from '../../shared/library/ipc'
import { createFinder } from './finder'
import { type Gate, createGate } from './gate'
import { AUTO_SCORE } from './match-rules'
import {
  addDays,
  calendarRange,
  isDue,
  localDate,
  nextTry,
} from './schedule-rules'
import { applyCalendar, seriesList } from './records'
import { createSaver } from './saver'
import {
  type AutograbState,
  type EpisodeRecord,
  type SeriesSetting,
  emptyState,
  parseState,
  pruneEpisodes,
} from './state'

/** 全自动前要先手动确认几集 */
export const AUTO_AFTER_CONFIRMED = 3
/** 一轮最多搜几集 */
const MAX_SEARCH_PER_TICK = 6
/** 打不开的分享拉黑多久 */
export const BLOCK_MS = 7 * 24 * 3_600_000

/** 依赖 */
export interface AutograbDeps {
  calendar(range: CalendarRequest): Promise<CalendarResult>
  notify(changes: FileChangeNotice[]): Promise<void>
  pan: {
    loggedIn(): boolean
    pansouReady(): boolean
    search(keyword: string): Promise<NetdiskItem[]>
    snap(url: string, password: string, dirCid: string): Promise<ShareSnap>
    receive(
      url: string,
      password: string,
      fileIds: string[],
      cid: string
    ): Promise<void>
    names(cid: string): Promise<string[]>
    /** 文件夹 cid 从根开始的各级名字（不含根） */
    dirPath(cid: string): Promise<string[]>
  }
  /** 设置里的转存目标 cid */
  defaultCid(): string
  load(): Promise<unknown>
  save(state: AutograbState): Promise<void>
  now(): number
  sleep(ms: number): Promise<void>
  emit(): void
  log(message: string): void
}

/** 追更服务 */
export interface AutograbService {
  /** 跑一轮（已在跑时直接返回） */
  tick(): Promise<void>
  overview(): Promise<AutograbOverview>
  setEnabled(enabled: boolean): Promise<void>
  setSeries(
    seriesId: number,
    patch: AutograbSeriesPatch
  ): Promise<AutograbResult>
  grab(key: string, index: number): Promise<AutograbResult>
  skip(key: string): Promise<void>
  retry(key: string): Promise<void>
  resume(): Promise<void>
  /** 状态加载后的闸门：洗版、电影追踪的 115 请求也走它（同一队列、同一份限额与熔断） */
  gate(): Promise<Gate>
}

/** 创建追更服务 */
export function createAutograbService(deps: AutograbDeps): AutograbService {
  let state: AutograbState = emptyState(deps.now())
  let loaded: Promise<void> | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let current: Promise<void> | null = null
  /** 最近一次日历里出现的剧 */
  let airing = new Map<number, string>()
  let lastCalendar: CalendarEpisode[] = []

  // 闸门持有 state.gate 的引用：load 之后要重建
  let gateRef = createGate(
    state.gate,
    { now: deps.now, sleep: deps.sleep },
    dirty
  )

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
    snap: (item, dir) =>
      gateRef.run('snap', () => deps.pan.snap(item.url, item.receiveCode, dir)),
    blocked: code => (state.blacklist[code] ?? 0) > deps.now(),
    block: code => {
      state.blacklist[code] = deps.now() + BLOCK_MS
      dirty()
    },
    now: deps.now,
  })

  const settingOf = (seriesId: number): SeriesSetting | undefined =>
    state.series[String(seriesId)]

  function targetCid(setting: SeriesSetting | undefined): string {
    const cid = setting?.cid || deps.defaultCid()
    return /^\d+$/.test(cid) ? cid : '0'
  }

  function syncRecords(episodes: CalendarEpisode[], now: number): void {
    airing = new Map(episodes.map(e => [e.seriesId, e.seriesTitle]))
    if (applyCalendar(state, episodes, localDate(now))) dirty()
  }

  async function searchOne(record: EpisodeRecord, now: number): Promise<void> {
    const result = await finder.find({
      seriesTitle: record.seriesTitle,
      season: record.season,
      episode: record.episode,
    })
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
    const setting = settingOf(record.seriesId)
    const best = record.candidates[0]
    if (
      record.status === 'found' &&
      setting?.mode === 'auto' &&
      setting.cid &&
      setting.confirmed >= AUTO_AFTER_CONFIRMED &&
      best.score >= AUTO_SCORE
    )
      await grab(record, 0, false)
  }

  const saver = createSaver({
    state: () => state,
    gate: () => gateRef,
    deps,
    dirty,
    targetCid: record => targetCid(settingOf(record.seriesId)),
  })
  const grab = saver.grab
  const followSaved = saver.followSaved

  /** 跑一轮；已在跑时等那一轮跑完（不并发两轮） */
  function tick(): Promise<void> {
    current ??= runOnce().finally(() => (current = null))
    return current
  }

  async function runOnce(): Promise<void> {
    await ensureLoaded()
    if (!state.enabled) return
    if (!Object.values(state.series).some(s => s.mode !== 'off')) return
    running = true
    deps.emit()
    try {
      const now = deps.now()
      if (state.gate.loginPause && deps.pan.loggedIn()) gateRef.resume()
      const result = await deps.calendar(calendarRange(now))
      lastCalendar = result.episodes
      syncRecords(result.episodes, now)
      pruneEpisodes(state, addDays(localDate(now), -60))
      if (gateRef.paused() || !deps.pan.loggedIn() || !deps.pan.pansouReady())
        return
      const records = Object.values(state.episodes)
      for (const record of records.filter(r => r.status === 'saved'))
        await followSaved(record, now).catch(e =>
          deps.log((e as Error).message)
        )
      const due = records
        .filter(
          r => r.status === 'waiting' && settingOf(r.seriesId)?.mode !== 'off'
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
      if (!lastCalendar.length && !running) {
        // 第一次打开面板时也要列出在播的剧
        const result = await deps
          .calendar(calendarRange(deps.now()))
          .catch(() => null)
        if (result) {
          lastCalendar = result.episodes
          syncRecords(result.episodes, deps.now())
        }
      }
      gateRef.paused()
      return {
        enabled: state.enabled,
        pausedUntil: state.gate.pausedUntil,
        pauseReason: state.gate.pauseReason,
        ready: {
          loggedIn: deps.pan.loggedIn(),
          pansou: deps.pan.pansouReady(),
        },
        today: { snaps: state.gate.snaps, receives: state.gate.receives },
        series: seriesList(state, airing),
        episodes: Object.values(state.episodes)
          .filter(r => settingOf(r.seriesId)?.mode !== 'off')
          .sort(
            (a, b) =>
              b.airDate.localeCompare(a.airDate) || b.episode - a.episode
          )
          .slice(0, 60)
          .map(
            ({
              savedAt: _a,
              savedName: _b,
              savedCid: _c,
              notified: _d,
              ...rest
            }) => rest
          ),
        running,
      }
    },
    async setEnabled(enabled: boolean): Promise<void> {
      await ensureLoaded()
      state.enabled = enabled
      dirty()
    },
    async setSeries(
      seriesId: number,
      patch: AutograbSeriesPatch
    ): Promise<AutograbResult> {
      await ensureLoaded()
      const key = String(seriesId)
      const setting = state.series[key] ?? {
        title: airing.get(seriesId) ?? '',
        mode: 'off',
        cid: '',
        cidName: '',
        confirmed: 0,
      }
      const next = { ...setting, ...patch }
      if (next.mode === 'auto' && !next.cid)
        return { ok: false, error: '全自动要先给这部剧选一个 115 文件夹' }
      state.series[key] = next
      dirty()
      if (patch.mode && patch.mode !== 'off') void tick()
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
    },
    async gate(): Promise<Gate> {
      await ensureLoaded()
      return gateRef
    },
  }
}

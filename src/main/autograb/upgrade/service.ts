/**
 * 洗版服务：每周清点片库 → 低分辨率文件每周搜一次更高清的 115 分享 → 列成可替换 →
 * 用户确认后把新文件存进旧文件所在的 115 文件夹 → 新文件出现在本地挂载里就记为已替换（旧文件不动）。
 *
 * 不依赖 Electron：片库、115、闸门、文件系统、状态读写、时钟都由 index.ts 注入。
 * 安全边界：
 * - 不自动替换、不自动删除；删旧文件只在用户点了之后，并且新文件已在本地；
 * - 转存前核对目标文件夹里确实有旧文件（防止存进认错的文件夹）；
 * - 115 请求都过剧集追更的闸门，另有每天 {@link UPGRADE_SNAPS_PER_DAY} 次的子限额。
 */
import type {
  GrabResult,
  UpgradeOptionsPatch,
  UpgradeOverview,
  UpgradeStatus,
} from '../../../shared/contract/autograb-upgrade'
import type {
  NetdiskItem,
  Pan115DirListing,
  ShareSnap,
} from '../../../shared/contract/pan115'
import { createRoundRunner, createSingleFlight } from '../flight'
import { type Gate, GateClosed } from '../gate'
import { dirOf, joinPath } from './folder-path'
import {
  type LibraryReader,
  scanLibraries,
  upgradableLibraries,
} from './library-scan'
import { upgradePlan } from './plan'
import {
  BudgetSpent,
  UPGRADE_INTERVAL_MS,
  UPGRADE_SNAPS_PER_DAY,
  budgetLeft,
} from './quality-rules'
import { type ReplaceResult, createReplacer } from './replace'
import { createShareScanner } from './share-scan'
import {
  type UpgradeRecord,
  type UpgradeState,
  applyScan,
  emptyUpgradeState,
  parseUpgradeState,
} from './state'

export type { ReplaceResult } from './replace'

/** 一轮最多搜几个文件 */
const MAX_SEARCH_PER_TICK = 4
/** 新文件转存后多久还没出现在本地就报错 */
const STALE_AFTER_MS = 24 * 3_600_000
const BLOCK_MS = 7 * 24 * 3_600_000

/** 依赖 */
export interface UpgradeDeps {
  library: LibraryReader
  /** 剧集追更的闸门（加载完状态后的那一个） */
  gate(): Promise<Gate>
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
    dirs(cid: string): Promise<Pan115DirListing>
  }
  /** 设置里的挂载根目录（空串 = 没填） */
  mountRoot(): string
  fileExists(path: string): Promise<boolean>
  removeFile(path: string): Promise<void>
  /** 通知媒体库这些本地路径有变化 */
  notify(paths: string[]): Promise<void>
  load(): Promise<unknown>
  save(state: UpgradeState): Promise<void>
  now(): number
  emit(): void
  log(message: string): void
}

/** 洗版服务 */
export interface UpgradeService {
  /** 跑一轮；force 时先重新清点片库 */
  tick(force?: boolean): Promise<void>
  overview(): Promise<UpgradeOverview>
  setOptions(patch: UpgradeOptionsPatch): Promise<void>
  replace(key: string, index: number, cid?: string): Promise<ReplaceResult>
  ignore(key: string): Promise<void>
  retry(key: string): Promise<void>
  deleteOld(key: string): Promise<GrabResult>
}

/** 创建洗版服务 */
export function createUpgradeService(deps: UpgradeDeps): UpgradeService {
  let state = emptyUpgradeState(deps.now())
  let loaded: Promise<void> | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let cloudLibraries = false

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
      .then(raw => void (state = parseUpgradeState(raw, deps.now())))
      .catch(() => void (state = emptyUpgradeState(deps.now())))
    return loaded
  }

  /** 洗版的查询：过闸门，并记进洗版自己的子限额 */
  async function snap(item: NetdiskItem, dir: string): Promise<ShareSnap> {
    const gate = await deps.gate()
    if (budgetLeft(state.budget, deps.now(), UPGRADE_SNAPS_PER_DAY) <= 0)
      throw new BudgetSpent('洗版')
    state.budget.snaps++
    return gate.run('snap', () =>
      deps.pan.snap(item.url, item.receiveCode, dir)
    )
  }

  const scanner = createShareScanner({
    search: keyword => deps.pan.search(keyword),
    snap,
    blocked: code => (state.blacklist[code] ?? 0) > deps.now(),
    block: code => {
      state.blacklist[code] = deps.now() + BLOCK_MS
      dirty()
    },
    now: deps.now,
  })

  const replacer = createReplacer({ state: () => state, deps, dirty })

  async function searchOne(record: UpgradeRecord): Promise<void> {
    const result = await scanner.scan(upgradePlan(record, state.target))
    record.attempts++
    record.candidates = result.candidates
    record.error = null
    record.status = result.candidates.length ? 'found' : 'waiting'
    record.nextTry = result.candidates.length
      ? null
      : deps.now() + UPGRADE_INTERVAL_MS
    dirty()
  }

  /** 已转存：新文件出现在本地就记为已替换并通知媒体库；已替换：旧文件没了就记为已清理 */
  async function follow(record: UpgradeRecord): Promise<void> {
    if (
      record.status === 'saved' &&
      record.savedName &&
      record.savedAt !== null
    ) {
      const fresh = joinPath(dirOf(record.filePath), record.savedName)
      if (await deps.fileExists(fresh)) {
        record.status = 'replaced'
        record.error = null
        dirty()
        await deps.notify([fresh])
      } else if (
        deps.now() - record.savedAt >= STALE_AFTER_MS &&
        !record.error
      ) {
        record.error = '已转存一天仍没出现在本地：检查 CloudDrive2 挂载是否同步'
        dirty()
      }
    } else if (
      record.status === 'replaced' &&
      !(await deps.fileExists(record.filePath))
    ) {
      record.status = 'cleaned'
      dirty()
    }
  }

  async function runOnce(force: boolean): Promise<void> {
    await ensureLoaded()
    if (!state.enabled) return
    running = true
    deps.emit()
    try {
      const now = deps.now()
      if (
        force ||
        state.scannedAt === null ||
        now - state.scannedAt >= UPGRADE_INTERVAL_MS
      ) {
        const libraries = await deps.library.listLibraries()
        cloudLibraries = upgradableLibraries(libraries).length > 0
        applyScan(state, await scanLibraries(deps.library, state.target), now)
        state.scannedAt = now
        dirty()
      }
      for (const record of Object.values(state.records))
        await follow(record).catch(e => deps.log((e as Error).message))
      const gate = await deps.gate()
      if (gate.paused() || !deps.pan.loggedIn() || !deps.pan.pansouReady())
        return
      const due = Object.values(state.records)
        .filter(
          r => r.status === 'waiting' && r.nextTry !== null && r.nextTry <= now
        )
        .sort((a, b) => (a.nextTry ?? 0) - (b.nextTry ?? 0))
        .slice(0, MAX_SEARCH_PER_TICK)
      for (const record of due) {
        if (
          gate.paused() ||
          budgetLeft(state.budget, deps.now(), UPGRADE_SNAPS_PER_DAY) <= 0
        )
          break
        try {
          await searchOne(record)
        } catch (error) {
          // 闸门关了 / 子限额用完：这一条下一轮接着搜，不算失败
          if (error instanceof GateClosed || error instanceof BudgetSpent) break
          record.error = (error as Error).message
          record.nextTry = deps.now() + UPGRADE_INTERVAL_MS
          dirty()
        }
      }
    } catch (error) {
      deps.log(`洗版一轮失败：${(error as Error).message}`)
    } finally {
      running = false
      deps.emit()
    }
  }

  function counts(): Record<UpgradeStatus, number> {
    const out: Record<UpgradeStatus, number> = {
      waiting: 0,
      found: 0,
      saved: 0,
      replaced: 0,
      cleaned: 0,
      ignored: 0,
    }
    for (const r of Object.values(state.records)) out[r.status]++
    return out
  }

  /** 跑一轮；已在跑时这一轮完了再补跑一轮，force 取并集（不并发两轮，见 flight.ts） */
  const rounds = createRoundRunner(force => runOnce(force))
  const tick = (force = false): Promise<void> => rounds.run(force)
  /** 同一条洗版的替换单飞：连点只发一次转存 */
  const replacing = createSingleFlight()

  return {
    tick,
    async overview(): Promise<UpgradeOverview> {
      await ensureLoaded()
      if (!cloudLibraries)
        cloudLibraries = await deps.library
          .listLibraries()
          .then(l => upgradableLibraries(l).length > 0)
          .catch(() => false)
      const gate = await deps.gate()
      const show = (r: UpgradeRecord): boolean =>
        r.status === 'found' ||
        r.status === 'saved' ||
        r.status === 'replaced' ||
        r.error !== null
      return {
        enabled: state.enabled,
        target: state.target,
        ready: {
          loggedIn: deps.pan.loggedIn(),
          pansou: deps.pan.pansouReady(),
          cloudLibraries,
        },
        scannedAt: state.scannedAt,
        pauseReason: gate.paused()
          ? '115 闸门暂停中（和剧集追更共用），恢复后继续'
          : null,
        counts: counts(),
        entries: Object.values(state.records)
          .filter(show)
          .sort(
            (a, b) =>
              a.title.localeCompare(b.title, 'zh') ||
              (a.season ?? 0) - (b.season ?? 0) ||
              (a.episode ?? 0) - (b.episode ?? 0)
          )
          .slice(0, 100)
          .map(({ savedAt: _a, savedCid: _b, ...rest }) => rest),
        running,
      }
    },
    async setOptions(patch: UpgradeOptionsPatch): Promise<void> {
      await ensureLoaded()
      const retarget =
        patch.target !== undefined && patch.target !== state.target
      Object.assign(state, patch)
      dirty()
      if (state.enabled) void tick(retarget || patch.enabled === true)
    },
    async replace(key, index, picked): Promise<ReplaceResult> {
      await ensureLoaded()
      const record = state.records[key]
      if (!record) return { ok: false, error: '记录不存在' }
      const gate = await deps.gate()
      if (gate.paused())
        return { ok: false, error: '115 闸门暂停中，恢复后再试' }
      return replacing.run(key, () =>
        replacer.replace(record, index, gate, picked)
      )
    },
    async ignore(key: string): Promise<void> {
      await ensureLoaded()
      const record = state.records[key]
      if (!record || record.status === 'saved' || record.status === 'replaced')
        return
      record.status = 'ignored'
      record.nextTry = null
      dirty()
    },
    async retry(key: string): Promise<void> {
      await ensureLoaded()
      const record = state.records[key]
      if (!record || record.status === 'saved' || record.status === 'replaced')
        return
      Object.assign(record, {
        status: 'waiting',
        candidates: [],
        error: null,
        nextTry: deps.now(),
      })
      dirty()
      void tick()
    },
    async deleteOld(key: string): Promise<GrabResult> {
      await ensureLoaded()
      const record = state.records[key]
      if (!record) return { ok: false, error: '记录不存在' }
      return replacer.deleteOld(record)
    },
  }
}

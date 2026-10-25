/**
 * 桌面端 ↔ 片库服务的观看进度同步：先拉后推，按 updatedAt 后写胜出，时间相同以服务端为准。
 *
 * 不依赖 Electron（本地引擎调用、服务端请求、游标存取、时钟都注入），单测直接用。
 *
 * 一轮同步：
 * 1. 拉：服务端 progress.export(since) → 本地 progress.import(preferIncoming)；
 * 2. 推：本地 progress.export(since) → 服务端 progress.import（同时间戳服务端保留自己的）；
 * 3. 成功后把本轮开始时间记成游标。since = 游标 − SKEW_MS，容忍两台机器的时钟差；
 *    第一次（或换了服务端地址）游标为 0，全量合并。
 * 同一时刻只跑一轮，重复触发复用正在跑的那一轮。
 */
import {
  PROGRESS_BATCH_LIMIT,
  type ProgressImportResult,
  type ProgressSyncEntry,
} from '../../../shared/library/ipc'
import type { ProgressSyncStatus } from '../../../shared/contract/progress-sync'

/** 游标往回让的时间：两台机器的时钟差在这之内不会漏同步。 */
export const SKEW_MS = 10 * 60_000

/** 进度的一端（本地引擎或服务端）。 */
export interface ProgressPeer {
  export(since: number): Promise<ProgressSyncEntry[]>
  import(
    entries: ProgressSyncEntry[],
    preferIncoming: boolean
  ): Promise<ProgressImportResult>
}

/** 游标：按服务端地址记，换地址从 0 开始。 */
export interface SyncCursor {
  server: string
  lastSync: number
}

/** 依赖。 */
export interface SyncerDeps {
  local: ProgressPeer
  /** 当前配置的服务端；没配置为 null */
  remote: () => { server: string; peer: ProgressPeer } | null
  readCursor: () => SyncCursor | null
  writeCursor: (cursor: SyncCursor) => void
  now?: () => number
  onStatus?: (status: ProgressSyncStatus) => void
  /** 拉下来写进本地的条目 */
  onApplied?: (itemIds: number[]) => void
}

/** 同步器。 */
export interface ProgressSyncer {
  status(): ProgressSyncStatus
  /** 跑一轮；没配置时直接返回状态。 */
  sync(): Promise<ProgressSyncStatus>
}

/** 分批导入（每批不超过 RPC 上限），合计结果。 */
async function importAll(
  peer: ProgressPeer,
  entries: ProgressSyncEntry[],
  preferIncoming: boolean
): Promise<ProgressImportResult> {
  const total: ProgressImportResult = { applied: 0, unmatched: 0, itemIds: [] }
  for (let i = 0; i < entries.length; i += PROGRESS_BATCH_LIMIT) {
    const part = await peer.import(
      entries.slice(i, i + PROGRESS_BATCH_LIMIT),
      preferIncoming
    )
    total.applied += part.applied
    total.unmatched += part.unmatched
    total.itemIds.push(...part.itemIds)
  }
  return total
}

export function createProgressSyncer(deps: SyncerDeps): ProgressSyncer {
  const now = deps.now ?? Date.now
  let current: ProgressSyncStatus = {
    configured: deps.remote() !== null,
    syncing: false,
    lastSyncAt: null,
    error: null,
    pulled: 0,
    pushed: 0,
  }
  let running: Promise<ProgressSyncStatus> | null = null

  const publish = (patch: Partial<ProgressSyncStatus>): ProgressSyncStatus => {
    current = { ...current, ...patch }
    deps.onStatus?.(current)
    return current
  }

  const run = async (): Promise<ProgressSyncStatus> => {
    const remote = deps.remote()
    if (!remote) return publish({ configured: false, syncing: false })
    publish({ configured: true, syncing: true })
    const startedAt = now()
    const cursor = deps.readCursor()
    const since =
      cursor && cursor.server === remote.server
        ? Math.max(0, cursor.lastSync - SKEW_MS)
        : 0
    try {
      const incoming = await remote.peer.export(since)
      const pulled = await importAll(deps.local, incoming, true)
      if (pulled.itemIds.length) deps.onApplied?.(pulled.itemIds)
      const outgoing = await deps.local.export(since)
      const pushed = await importAll(remote.peer, outgoing, false)
      deps.writeCursor({ server: remote.server, lastSync: startedAt })
      return publish({
        syncing: false,
        lastSyncAt: startedAt,
        error: null,
        pulled: pulled.applied,
        pushed: pushed.applied,
      })
    } catch (error) {
      return publish({
        syncing: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    status: () => current,
    sync() {
      running ??= run().finally(() => (running = null))
      return running
    },
  }
}

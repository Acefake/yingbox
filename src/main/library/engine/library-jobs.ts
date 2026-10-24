/**
 * 媒体库后台任务：扫描、重解析、计算指纹、探测视频动态范围。由 LibraryService 注册进任务队列，
 * 同一媒体库的扫描 / 解析由服务层的 KeyedMutex 互斥；探测按小批进同一把锁（避开整理任务移文件）。
 * 扫描 / 重解析的后继写在任务定义里（changeFollowups）：有变化排识别，扫描有新增 / 变化再排指纹；
 * 本地库每次都补排探测（没有待探测的文件时是空转），装上 ffmpeg 后重扫即可补上。
 */
import { type CatalogStore, ItemChanges } from '../catalog/catalog-store'
import { type LibraryDb, transaction } from '../db/database'
import type { FollowupSpec } from '../jobs/followups'
import type { KeyedMutex } from '../jobs/keyed-mutex'
import type { JobContext, JobQueue } from '../jobs/queue'
import type { LibraryRecord } from '../libraries/library-store'
import { PARSER_VERSION, parseLibraryFile } from '../scanner/parse'
import {
  type RemoteClients,
  type UnsettledFiles,
  scanLibrary,
} from '../scanner/scan-library'
import type { ScanStore } from '../scanner/scan-store'
import {
  PROBE_MAX_PROCESSES,
  type VideoProbeOutcome,
} from '../scanner/video-probe'
import type { SettleTracker } from '../scanner/settle'
import {
  BACKGROUND_BATCH,
  FINGERPRINT_CONCURRENCY,
  type LibraryPayload,
  SCAN_WARNING_LOG_LIMIT,
  type ScanPayload,
  chunks,
  libraryJobSpec,
  mergeScanPayload,
} from './service-rules'

/** 扫描 / 重解析的结果，后继据此决定派什么。 */
export interface LibraryChangeResult {
  libraryId: number
  /** 条目有新增 / 变化 / 删除。 */
  itemsChanged: boolean
  /** 有新增或内容变了的文件（要补指纹）；重解析不读文件，恒为 false。 */
  filesChanged: boolean
}

/** 后台任务需要的服务能力。 */
export interface LibraryJobDeps {
  db: LibraryDb
  scanStore: ScanStore
  catalog: CatalogStore
  fingerprint: (path: string) => Promise<string | undefined>
  /** 视频动态范围探测（ffprobe）；宿主没提供时不排探测任务。 */
  probeVideo?: (path: string) => Promise<VideoProbeOutcome>
  /** 远程源（WebDAV）的客户端；宿主没提供时远程媒体库扫描报错。 */
  remote?: RemoteClients
  /** 取媒体库；已被删除时抛 PermanentJobError（任务直接失败、不重试）。 */
  libraryFor: (libraryId: number) => LibraryRecord
  /** 整库扫描完成：记扫描时间并广播媒体库列表。 */
  onLibraryScanned: (libraryId: number) => void
  emitItems: (libraryId: number, changes: ItemChanges) => void
  /** 这个库的自动识别后继；库关了自动识别、或 TMDB 库没令牌时为 null。 */
  identifyFollowup: (libraryId: number) => FollowupSpec | null
  /** 库是否按网盘处理（网盘不读视频内容、不排指纹）。 */
  isCloudLibrary: (libraryId: number) => Promise<boolean>
  /** 这个库的写入稳定判定；null 表示不判定。 */
  settleFor: (
    library: LibraryRecord
  ) => { tracker: SettleTracker; initial: boolean } | null
  /** 有还在写入、这一轮没入库的文件：排定向复扫。 */
  onUnsettled: (libraryId: number, unsettled: UnsettledFiles) => void
  log: (message: string) => void
}

/** 扫描（整库或指定目录）。 */
export async function runScan(
  deps: LibraryJobDeps,
  payload: ScanPayload,
  ctx: JobContext
): Promise<LibraryChangeResult> {
  const lib = deps.libraryFor(payload.libraryId)
  const summary = await scanLibrary(
    {
      db: deps.db,
      scanStore: deps.scanStore,
      catalog: deps.catalog,
      fingerprint: f => deps.fingerprint(f.displayPath),
      remote: deps.remote,
    },
    lib,
    {
      full: payload.full,
      scope: payload.dirs,
      signal: ctx.signal,
      onProgress: ctx.progress,
      settle: deps.settleFor(lib) ?? undefined,
    }
  )
  if (summary.unsettled) deps.onUnsettled(lib.id, summary.unsettled)
  for (const warning of summary.warnings.slice(0, SCAN_WARNING_LOG_LIMIT)) {
    deps.log(warning)
  }
  if (!payload.dirs) deps.onLibraryScanned(lib.id)
  deps.emitItems(lib.id, summary.changes)
  return {
    libraryId: lib.id,
    itemsChanged: !summary.changes.empty,
    filesChanged: summary.added > 0 || summary.changed > 0,
  }
}

/** 重解析解析版本落后的文件，并按新结果重新分组。 */
export async function runParse(
  deps: LibraryJobDeps,
  payload: LibraryPayload,
  ctx: JobContext
): Promise<LibraryChangeResult> {
  const { db, scanStore, catalog } = deps
  const lib = deps.libraryFor(payload.libraryId)
  const parseCtx = {
    libraryId: lib.id,
    kind: lib.kind,
    rootKey: lib.rootKey,
    source: lib.source,
  }
  const changes = new ItemChanges()
  let afterId = 0
  for (;;) {
    ctx.signal.throwIfAborted()
    const batch = scanStore.staleParsed(
      lib.id,
      PARSER_VERSION,
      afterId,
      BACKGROUND_BATCH
    )
    if (!batch.length) break
    transaction(db, () => {
      const now = Date.now()
      for (const file of batch) {
        const parse = parseLibraryFile(parseCtx, { ...file, kind: 'video' })
        scanStore.setParsed(file.id, parse.columns, now)
        catalog.linkFile(lib.id, file.id, parse.grouping, false, now, changes)
      }
    })
    afterId = batch.at(-1)!.id
    await new Promise(resolve => setImmediate(resolve))
  }
  transaction(db, () => {
    catalog.collectGarbage(lib.id, changes)
    catalog.bumpUpdated(changes, Date.now())
  })
  deps.emitItems(lib.id, changes)
  return {
    libraryId: lib.id,
    itemsChanged: !changes.empty,
    filesChanged: false,
  }
}

/**
 * 扫描 / 重解析的后继：条目有变化排识别（只处理没识别过或文件变过的），文件有新增 / 变化排指纹；
 * 本地库无条件补排探测（上一轮因没有 ffprobe 停下、或有瞬时失败的文件，这次补上）。网盘都不排。
 */
export async function changeFollowups(
  deps: Pick<
    LibraryJobDeps,
    'identifyFollowup' | 'isCloudLibrary' | 'probeVideo'
  >,
  result: LibraryChangeResult
): Promise<FollowupSpec[]> {
  const specs: FollowupSpec[] = []
  const identify = result.itemsChanged
    ? deps.identifyFollowup(result.libraryId)
    : null
  if (identify) specs.push(identify)
  if (!result.filesChanged && !deps.probeVideo) return specs
  if (await deps.isCloudLibrary(result.libraryId)) return specs
  if (result.filesChanged)
    specs.push(libraryJobSpec('fingerprint', result.libraryId))
  if (deps.probeVideo) specs.push(libraryJobSpec('probe', result.libraryId))
  return specs
}

/**
 * 为还没探测的视频文件读动态范围（ffprobe）。没有 ffprobe 时整轮停下、什么都不写，下次扫描再补。
 * 读不出视频流记 ''，不再重试；瞬时失败（'failed'）保持未探测，下一轮再试——本轮按 id 游标往后走，
 * 每个文件最多试一次，不会原地反复重试。每一小批在库锁里跑，避开整理任务改名 / 移动文件。
 */
export async function runProbe(
  deps: LibraryJobDeps,
  payload: LibraryPayload,
  ctx: JobContext,
  locks: KeyedMutex<number>
): Promise<void> {
  const probe = deps.probeVideo
  if (!probe) return
  const lib = deps.libraryFor(payload.libraryId)
  let afterId = 0
  // 第一个文件单独探测：没有 ffprobe 时只试这一次
  let width = 1
  for (;;) {
    ctx.signal.throwIfAborted()
    const batch = deps.scanStore.unprobed(lib.id, afterId, BACKGROUND_BATCH)
    if (!batch.length) return
    for (const chunk of [
      batch.slice(0, width),
      ...chunks(batch.slice(width), PROBE_MAX_PROCESSES),
    ]) {
      if (!chunk.length) continue
      width = 0
      ctx.signal.throwIfAborted()
      const stop = await locks.run(lib.id, async () => {
        const results = await Promise.all(chunk.map(f => probe(f.displayPath)))
        if (results.includes('unavailable')) return true
        transaction(deps.db, () => {
          for (const [i, result] of results.entries())
            if (result !== 'failed' && result !== 'unavailable')
              deps.scanStore.setVideoProbe(chunk[i].id, result)
        })
        return false
      })
      if (stop) return
    }
    afterId = batch.at(-1)!.id
  }
}

/** 为还没有指纹的视频文件分批计算指纹（读头尾各 64 KiB）；算不出的本轮不再重试。 */
export async function runFingerprint(
  deps: LibraryJobDeps,
  payload: LibraryPayload,
  ctx: JobContext
): Promise<void> {
  const lib = deps.libraryFor(payload.libraryId)
  const failed = new Set<number>()
  for (;;) {
    ctx.signal.throwIfAborted()
    const batch = deps.scanStore
      .unfingerprinted(lib.id, BACKGROUND_BATCH + failed.size)
      .filter(f => !failed.has(f.id))
    if (!batch.length) return
    const results: Array<{ id: number; hash: string | undefined }> = []
    for (const chunk of chunks(batch, FINGERPRINT_CONCURRENCY)) {
      ctx.signal.throwIfAborted()
      results.push(
        ...(await Promise.all(
          chunk.map(async f => ({
            id: f.id,
            hash: await deps.fingerprint(f.displayPath),
          }))
        ))
      )
    }
    transaction(deps.db, () => {
      for (const { id, hash } of results) {
        if (hash) deps.scanStore.setFingerprint(id, hash)
        else failed.add(id)
      }
    })
  }
}

/** 把扫描 / 解析 / 指纹 / 探测四种任务注册进队列：同一媒体库的扫描、解析与探测（按小批）经 locks 互斥，扫描载荷可合并。 */
export function registerLibraryJobs(
  queue: JobQueue,
  locks: KeyedMutex<number>,
  deps: LibraryJobDeps
): void {
  const followups = {
    next: ({ result }: { result: unknown }) =>
      changeFollowups(deps, result as LibraryChangeResult),
  }
  queue.register(
    'scan',
    (p, ctx) =>
      locks.run((p as ScanPayload).libraryId, () =>
        runScan(deps, p as ScanPayload, ctx)
      ),
    { merge: mergeScanPayload, followups }
  )
  queue.register(
    'parse',
    (p, ctx) =>
      locks.run((p as LibraryPayload).libraryId, () =>
        runParse(deps, p as LibraryPayload, ctx)
      ),
    { followups }
  )
  queue.register('fingerprint', (p, ctx) =>
    runFingerprint(deps, p as LibraryPayload, ctx)
  )
  queue.register('probe', (p, ctx) =>
    runProbe(deps, p as LibraryPayload, ctx, locks)
  )
}

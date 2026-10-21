/**
 * 媒体库后台任务：扫描、重解析、计算指纹。由 LibraryService 注册进任务队列，
 * 同一媒体库的扫描 / 解析由服务层的 KeyedMutex 互斥。
 */
import { type CatalogStore, ItemChanges } from '../catalog/catalog-store'
import { type LibraryDb, transaction } from '../db/database'
import type { JobContext } from '../jobs/queue'
import type { LibraryRecord } from '../libraries/library-store'
import { PARSER_VERSION, parseLibraryFile } from '../scanner/parse'
import { scanLibrary } from '../scanner/scan-library'
import type { ScanStore } from '../scanner/scan-store'
import {
  BACKGROUND_BATCH,
  FINGERPRINT_CONCURRENCY,
  type LibraryPayload,
  SCAN_WARNING_LOG_LIMIT,
  type ScanPayload,
  chunks,
} from './service-rules'

/** 后台任务需要的服务能力。 */
export interface LibraryJobDeps {
  db: LibraryDb
  scanStore: ScanStore
  catalog: CatalogStore
  fingerprint: (path: string) => Promise<string | undefined>
  /** 取媒体库；已被删除时抛 PermanentJobError（任务直接失败、不重试）。 */
  libraryFor: (libraryId: number) => LibraryRecord
  /** 整库扫描完成：记扫描时间并广播媒体库列表。 */
  onLibraryScanned: (libraryId: number) => void
  emitItems: (libraryId: number, changes: ItemChanges) => void
  enqueueFingerprint: (libraryId: number) => void
  /** 有新增 / 变化的条目时排自动识别。 */
  enqueueIdentify: (libraryId: number) => void
  log: (message: string) => void
}

/** 扫描（整库或指定目录）。 */
export async function runScan(
  deps: LibraryJobDeps,
  payload: ScanPayload,
  ctx: JobContext
): Promise<void> {
  const lib = deps.libraryFor(payload.libraryId)
  const summary = await scanLibrary(
    {
      db: deps.db,
      scanStore: deps.scanStore,
      catalog: deps.catalog,
      fingerprint: f => deps.fingerprint(f.displayPath),
    },
    lib,
    {
      full: payload.full,
      scope: payload.dirs,
      signal: ctx.signal,
      onProgress: ctx.progress,
    }
  )
  for (const warning of summary.warnings.slice(0, SCAN_WARNING_LOG_LIMIT)) {
    deps.log(warning)
  }
  if (!payload.dirs) deps.onLibraryScanned(lib.id)
  deps.emitItems(lib.id, summary.changes)
  if (summary.added || summary.changed) deps.enqueueFingerprint(lib.id)
  // 有新增 / 变化的条目就排自动识别（只处理没识别过或文件变过的）
  if (!summary.changes.empty) deps.enqueueIdentify(lib.id)
}

/** 重解析解析版本落后的文件，并按新结果重新分组。 */
export async function runParse(
  deps: LibraryJobDeps,
  payload: LibraryPayload,
  ctx: JobContext
): Promise<void> {
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
  if (!changes.empty) deps.enqueueIdentify(lib.id)
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

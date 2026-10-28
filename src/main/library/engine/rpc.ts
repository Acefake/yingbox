/**
 * 引擎的 RPC 入口：解析请求参数（系统边界）、调用服务方法、把结果或错误包成响应。
 * 纯函数式，不依赖 Electron：桌面端引擎入口（entry.ts）与独立服务（server/routes/library.ts）共用，
 * 单测直接喂 { method, params }。结果就是 library:invoke 的 InvokeResult。
 */
import {
  type InvokeResult,
  LibraryError,
  type LibraryMethod,
  type LibraryRpcMap,
  type ParsedRpcParams,
  isLibraryMethod,
  parseRpcParams,
} from '../../../shared/library/ipc'
import { CalendarModule } from '../calendar/calendar-module'
import { ScrapePrefsStore } from '../providers/scrape-prefs-store'
import { createItemPreviews } from '../catalog/item-preview'
import { ProgressStore } from '../progress/progress-store'
import { MergeModule } from '../catalog/merge/merge-module'
import type { LibraryService } from './service'

/** 每个服务一份合并展示（详情合并、版本、拆分），事件经服务推送。 */
const merges = new WeakMap<LibraryService, MergeModule>()

/** 服务的合并模块（第一次用时创建）。 */
export function mergeFor(s: LibraryService): MergeModule {
  let found = merges.get(s)
  if (!found) {
    found = new MergeModule({ db: s.db, emit: event => s.emit(event) })
    merges.set(s, found)
  }
  return found
}

/** 每个服务一份预览查询（网盘判定见 engine/storage-mode.ts）。 */
const previews = new WeakMap<
  LibraryService,
  ReturnType<typeof createItemPreviews>
>()

function previewsFor(s: LibraryService): ReturnType<typeof createItemPreviews> {
  let found = previews.get(s)
  if (!found) {
    found = createItemPreviews({
      getItem: itemId => mergeFor(s).getItem(itemId),
      isCloud: id => s.isCloudLibrary(id),
    })
    previews.set(s, found)
  }
  return found
}

/** 每个服务一份追剧日历（TMDB 走识别模块的 provider，共用限速与缓存）。 */
const calendars = new WeakMap<LibraryService, CalendarModule>()

function calendarFor(s: LibraryService): CalendarModule {
  let found = calendars.get(s)
  if (!found) {
    found = new CalendarModule({
      db: s.db,
      provider: () => s.identifier.provider,
    })
    calendars.set(s, found)
  }
  return found
}

/** 每个服务一份观看进度表。 */
const progress = new WeakMap<LibraryService, ProgressStore>()

function progressFor(s: LibraryService): ProgressStore {
  let found = progress.get(s)
  if (!found) {
    found = new ProgressStore(s.db)
    progress.set(s, found)
  }
  return found
}

/** 每个方法如何调用服务。参数已经过 parseRpcParams 解析。 */
type Handlers = {
  [M in LibraryMethod]: (
    service: LibraryService,
    params: ParsedRpcParams<M>
  ) => LibraryRpcMap[M]['result'] | Promise<LibraryRpcMap[M]['result']>
}

const HANDLERS: Handlers = {
  listLibraries: s => s.listLibraries(),
  listActiveJobs: s => s.queue.activeJobs(),
  cancelJob: (s, p) => s.cancelJob(p.jobId),
  addLibrary: (s, p) => s.addLibrary(p),
  removeLibrary: (s, p) => s.removeLibrary(p),
  updateLibrary: (s, p) => s.updateLibrary(p),
  scan: (s, p) => s.scan(p),
  query: (s, p) => s.query(p),
  'facets.list': (s, p) => s.facetValues(p),
  'visual.status': s => s.visual.status(),
  'visual.index': s => s.visual.index(),
  'visual.search': (s, p) => s.visual.search(p),
  'visual.setFrames': (s, p) => s.visual.setFrames(p),
  'calendar.episodes': (s, p) => calendarFor(s).episodes(p),
  'progress.list': (s, p) => progressFor(s).list(p.itemIds),
  'progress.save': (s, p) => progressFor(s).save(p.reports),
  'progress.summary': (s, p) => progressFor(s).summary(p.itemIds),
  'progress.recent': (s, p) => progressFor(s).recent(p.limit),
  'progress.export': (s, p) => progressFor(s).export(p.since),
  'progress.import': (s, p) =>
    progressFor(s).import(p.entries, p.preferIncoming),
  'merge.split': (s, p) => mergeFor(s).split(p),
  'merge.join': (s, p) => mergeFor(s).join(p),
  getItem: (s, p) => mergeFor(s).getItem(p.itemId),
  getPreview: (s, p) => previewsFor(s).get(p.itemId),
  identify: (s, p) => (p.ai ? s.identifier.aiIdentify(p) : s.identify(p)),
  getMatchCandidates: (s, p) => s.getMatchCandidates(p),
  applyMatch: (s, p) => s.applyMatch(p),
  lockMatch: (s, p) => s.lockMatch(p),
  unlockMatch: (s, p) => s.unlockMatch(p),
  refreshMetadata: (s, p) => s.refreshMetadata(p),
  setProviderToken: (s, p) => s.setProviderToken(p),
  getProviderStatus: s => s.getProviderStatus(),
  getScrapePrefs: s => new ScrapePrefsStore(s.db).get(),
  setScrapePrefs: (s, p) => new ScrapePrefsStore(s.db).set(p),
  notifyChanges: (s, p) => s.notifyChanges(p),
  'writer.getSettings': s => s.writer.getSettings(),
  'writer.setSettings': (s, p) => s.writer.setSettings(p),
  'writer.write': (s, p) => s.writer.write(p.itemIds),
  'writer.previewOrganize': (s, p) => s.writer.previewOrganize(p.itemIds),
  'writer.applyOrganize': (s, p) => s.writer.applyOrganize(p.planId),
  'writer.undoOrganize': (s, p) => s.writer.undoOrganize(p.batchId),
  'writer.listOrganizeBatches': s => s.writer.listOrganizeBatches(),
  'jav.getSettings': s => s.identifier.getJavSettings(),
  'jav.setSettings': (s, p) => s.identifier.setJavSettings(p),
  'actors.list': (s, p) => s.actors.list(p),
  'actors.get': (s, p) => s.actors.get(p.actorId),
  'actors.forItem': (s, p) => s.actors.forItem(p.itemId),
  'actors.update': (s, p) => s.actors.update(p),
  'actors.refresh': (s, p) => s.actors.refresh(p),
  'actors.cancelRefresh': s => s.actors.cancelRefresh(),
  'actors.getSettings': s => s.actors.getSettings(),
  'actors.setSettings': (s, p) => s.actors.setSettings(p),
}

/** 处理一次调用，永不抛出：任何错误都变成 ok: false 的结果。 */
export async function handleRpc(
  service: LibraryService,
  request: { method: unknown; params: unknown }
): Promise<InvokeResult> {
  try {
    if (!isLibraryMethod(request.method)) {
      throw new LibraryError(
        'unknown-method',
        `未知方法：${String(request.method)}`
      )
    }
    const method = request.method
    const params = parseRpcParams(method, request.params)
    const handler = HANDLERS[method] as (
      s: LibraryService,
      p: typeof params
    ) => unknown
    const result = await handler(service, params)
    return { ok: true, result }
  } catch (error) {
    const known = error instanceof LibraryError
    return {
      ok: false,
      error: {
        code: known ? error.code : 'internal',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

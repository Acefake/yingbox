/**
 * 115 离线下载服务：添加磁力 / 电驴任务、记下经影盒添加的任务、同步 115 云下载的进度，完成后通知媒体库入库。
 *
 * 不依赖 Electron 与 115 客户端细节：115 调用、保存目录、入库通知、状态读写都由 index.ts 注入，测试可全部替换。
 * - 只跟进经影盒添加的任务（115 里别的离线任务不显示、不入库）；
 * - 有没结束的任务（等待 / 下载中，或已完成还没入库）时才向 115 查列表，没有时一轮什么都不做；
 * - 完成的任务按 115 路径（保存目录的路径 + 任务名）通知媒体库一次，失败下一轮再试；
 * - 列表最多翻 {@link MAX_PAGES} 页；翻完全部页仍找不到、且添加超过 {@link MISSING_AFTER_MS} 的任务记为失败（多半在 115 里删了）。
 */
import type {
  OfflineAddItem,
  OfflineAddResult,
  OfflineList,
  OfflineStatus,
  OfflineTask,
} from '../../shared/contract/offline'
import { folderOf } from '../../shared/netdisk/target-folder'
import { Pan115Error } from '../pan115/errors'
import { parseOfflineLink } from '../pan115/magnet-link'
import type { OfflineTaskPage, RawOfflineTask } from '../pan115/offline'

/** 列表最多翻几页 */
export const MAX_PAGES = 5
/** 添加多久后还在 115 列表里找不到才记为失败 */
export const MISSING_AFTER_MS = 10 * 60_000
/** 界面连续打开时，两次向 115 同步至少隔多久 */
export const MIN_SYNC_GAP_MS = 15_000
/** 最多记多少个任务；结束超过 {@link KEEP_DONE_MS} 的先删 */
export const MAX_RECORDS = 100
const KEEP_DONE_MS = 30 * 24 * 3600_000

const NOT_LOGGED_IN = '请先在设置 · 网盘里扫码登录 115'
const MISSING = '115 离线列表里找不到这个任务（可能已删除）'

/** 记下的一个任务（落盘） */
export interface OfflineRecord extends OfflineTask {
  link: string
  /** 添加时的保存目录 cid */
  cid: string
  /** 115 报的实际保存目录 cid（没报时用 cid） */
  folderCid?: string
}

/** 落盘的状态 */
export interface OfflineState {
  tasks: OfflineRecord[]
}

/** 服务依赖 */
export interface OfflineDeps {
  pan: {
    loggedIn(): Promise<boolean>
    add(links: readonly string[], cid: string): Promise<OfflineAddItem[]>
    list(page: number): Promise<OfflineTaskPage>
    /** 文件夹 cid 的路径（不含根目录）；根目录为空数组 */
    dirPath(cid: string): Promise<string[]>
  }
  /** 没指定文件夹时新任务的保存目录（电影默认目录） */
  folder(): { cid: string; name: string }
  /** 通知媒体库：115 上这个路径有新文件 */
  notify(path: string): Promise<void>
  load(): Promise<unknown>
  save(state: OfflineState): Promise<void>
  now(): number
  /** 推送 changed 事件 */
  emit(): void
  log(message: string): void
}

/** 离线下载服务 */
export interface OfflineService {
  /** 添加任务：folder 不传时存到 deps.folder() */
  add(
    links: readonly string[],
    folder?: { cid: string; name: string } | null
  ): Promise<OfflineAddResult>
  tasks(): Promise<OfflineList>
  /** 定时一轮：有没结束的任务时同步一次 */
  tick(): Promise<void>
}

const STATUSES: readonly OfflineStatus[] = [
  'waiting',
  'running',
  'done',
  'failed',
]

/** 读盘的内容 → 状态；坏的条目丢掉 */
export function parseOfflineState(raw: unknown): OfflineState {
  const list =
    raw && typeof raw === 'object' && Array.isArray((raw as OfflineState).tasks)
      ? (raw as OfflineState).tasks
      : []
  return {
    tasks: list.filter(
      (t): t is OfflineRecord =>
        Boolean(t) &&
        typeof t.hash === 'string' &&
        Boolean(t.hash) &&
        typeof t.link === 'string' &&
        STATUSES.includes(t.status)
    ),
  }
}

/** 还要跟进：没结束，或完成了还没入库 */
const pending = (t: OfflineRecord): boolean =>
  t.status === 'waiting' ||
  t.status === 'running' ||
  (t.status === 'done' && !t.imported)

/** 给界面的任务（去掉链接与 cid） */
const view = ({
  link: _link,
  cid: _cid,
  folderCid: _folderCid,
  ...task
}: OfflineRecord): OfflineTask => task

const reason = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** 创建离线下载服务 */
export function createOfflineService(deps: OfflineDeps): OfflineService {
  let state: OfflineState | null = null
  let loading: Promise<OfflineState> | null = null
  let syncing: Promise<void> | null = null
  let checkedAt: number | null = null
  let lastError: string | undefined

  function load(): Promise<OfflineState> {
    if (state) return Promise.resolve(state)
    loading ??= deps
      .load()
      .catch(() => null)
      .then(raw => (state = parseOfflineState(raw)))
    return loading
  }

  /** 删掉太旧的已结束任务，超出上限时从最旧的删 */
  function prune(current: OfflineState): void {
    const now = deps.now()
    current.tasks = current.tasks
      .filter(t => pending(t) || now - t.addedAt < KEEP_DONE_MS)
      .sort((a, b) => b.addedAt - a.addedAt)
      .slice(0, MAX_RECORDS)
  }

  async function persist(current: OfflineState): Promise<void> {
    prune(current)
    try {
      await deps.save(current)
    } catch (error) {
      deps.log(`保存离线任务失败：${reason(error)}`)
    }
    deps.emit()
  }

  /** 115 的一条 → 更新记录 */
  function apply(record: OfflineRecord, raw: RawOfflineTask): void {
    record.name = raw.name || record.name
    record.size = raw.size || record.size
    record.percent = raw.status === 'done' ? 100 : raw.percent
    record.status = raw.status
    record.error = raw.error
    if (raw.folderCid && /^\d+$/.test(raw.folderCid))
      record.folderCid = raw.folderCid
  }

  /** 通知媒体库：保存目录路径 + 任务名 */
  async function importDone(record: OfflineRecord): Promise<void> {
    try {
      const dirs = await deps.pan.dirPath(record.folderCid || record.cid)
      await deps.notify(`/${[...dirs, record.name].join('/')}`)
      record.imported = true
      deps.log(`已通知媒体库入库：${record.name}`)
    } catch (error) {
      deps.log(`通知媒体库失败（下一轮再试）：${reason(error)}`)
    }
  }

  async function syncOnce(current: OfflineState): Promise<void> {
    const open = current.tasks.filter(pending)
    if (!open.length) return
    const waiting = new Map(open.map(t => [t.hash, t]))
    let scannedAll = false
    try {
      for (let page = 1; page <= MAX_PAGES && waiting.size; page++) {
        const result = await deps.pan.list(page)
        for (const raw of result.tasks) {
          const record =
            waiting.get(raw.hash) ??
            open.find(
              t => waiting.has(t.hash) && raw.name && t.name === raw.name
            )
          if (!record) continue
          waiting.delete(record.hash)
          apply(record, raw)
        }
        if (page >= result.pageCount) {
          scannedAll = true
          break
        }
      }
      lastError = undefined
    } catch (error) {
      lastError = reason(error)
      deps.log(`同步离线任务失败：${lastError}`)
    }
    checkedAt = deps.now()
    if (scannedAll)
      for (const record of waiting.values())
        if (
          record.status !== 'done' &&
          deps.now() - record.addedAt > MISSING_AFTER_MS
        ) {
          record.status = 'failed'
          record.error = MISSING
        }
    for (const record of open)
      if (record.status === 'done' && !record.imported) await importDone(record)
    await persist(current)
  }

  /** 同步（并发调用共用一次） */
  function sync(): Promise<void> {
    syncing ??= load()
      .then(syncOnce)
      .finally(() => (syncing = null))
    return syncing
  }

  async function list(loggedIn: boolean): Promise<OfflineList> {
    const current = await load()
    return {
      loggedIn,
      folder: deps.folder().name,
      tasks: current.tasks.map(view),
      checkedAt,
      ...(lastError ? { error: lastError } : {}),
    }
  }

  return {
    async add(
      links: readonly string[],
      target?: { cid: string; name: string } | null
    ): Promise<OfflineAddResult> {
      try {
        if (!(await deps.pan.loggedIn()))
          return { ok: false, error: NOT_LOGGED_IN, setup: 'login' }
      } catch {
        return { ok: false, error: NOT_LOGGED_IN, setup: 'login' }
      }
      const folder = target?.cid
        ? folderOf(target.cid, target.name)
        : deps.folder()
      let items: OfflineAddItem[]
      try {
        items = await deps.pan.add(links, folder.cid)
      } catch (error) {
        const message =
          error instanceof Pan115Error
            ? error.message
            : `添加失败：${reason(error)}`
        return { ok: false, error: message }
      }
      const current = await load()
      const now = deps.now()
      for (const item of items) {
        if (!item.ok) continue
        const parsed = parseOfflineLink(item.link)
        const hash = (item.hash || parsed?.hash || item.link).toLowerCase()
        const found = current.tasks.find(t => t.hash === hash)
        if (found && found.status !== 'failed') continue
        if (found) current.tasks.splice(current.tasks.indexOf(found), 1)
        current.tasks.push({
          hash,
          link: item.link,
          name: item.name || parsed?.name || item.link.slice(0, 80),
          size: parsed?.size ?? 0,
          percent: 0,
          status: 'waiting',
          addedAt: now,
          cid: folder.cid,
          folder: folder.name,
          imported: false,
        })
      }
      await persist(current)
      return { ok: true, items, folder: folder.name }
    },

    async tasks(): Promise<OfflineList> {
      let loggedIn = false
      try {
        loggedIn = await deps.pan.loggedIn()
      } catch {
        loggedIn = false
      }
      const current = await load()
      const stale =
        checkedAt === null || deps.now() - checkedAt >= MIN_SYNC_GAP_MS
      if (loggedIn && stale && current.tasks.some(pending)) await sync()
      return list(loggedIn)
    },

    async tick(): Promise<void> {
      const current = await load()
      if (!current.tasks.some(pending)) return
      try {
        if (!(await deps.pan.loggedIn())) return
      } catch {
        return
      }
      await sync()
    },
  }
}

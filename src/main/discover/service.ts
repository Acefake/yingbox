/**
 * 库外发现服务：discover 域每个方法的实现。
 *
 * 不依赖 Electron：115 / PanSou、追更的闸门、设置、媒体库通知、时钟与定时器都由 index.ts 注入，测试可全部替换。
 * 安全边界：
 * - 只在用户点了「找 115 资源」/「转存」时才发请求，从不自动转存；
 * - 115 请求全部过追更的闸门（同一队列、同一份每日限额与熔断），打不开的分享进同一张拉黑表；
 * - 候选留在主进程，渲染层只回传 searchId 与序号；转存只传那一个 file_id，目标文件夹里同名文件已在就不再存；
 * - 转存 {@link NOTIFY_AFTER_MS} 后按 115 路径主动通知媒体库扫一次（不靠 CloudDrive2 webhook）。
 */
import type { AutograbCandidate } from '../../shared/contract/autograb'
import type {
  DiscoverFindResult,
  DiscoverReady,
  DiscoverSaveResult,
  DiscoverTarget,
} from '../../shared/contract/discover'
import type { NetdiskItem, ShareSnap } from '../../shared/contract/pan115'
import type { FileChangeNotice } from '../../shared/library/ipc'
import { isDeadShare } from '../autograb/finder'
import { GateClosed } from '../autograb/gate'
import { ALREADY_RECEIVED, NOTIFY_AFTER_MS } from '../autograb/saver'
import type { Pan115Guard } from '../autograb/deps'
import { parseShareLink } from '../pan115/share-link'
import { createMovieFinder } from './movie-finder'

/** 主进程最多记住几次搜索结果 */
const MAX_RESULTS = 20
/** 搜索结果多久后作废（分享可能失效） */
export const RESULT_TTL_MS = 3_600_000

/** 依赖 */
export interface DiscoverDeps {
  pan: {
    loggedIn(): Promise<boolean>
    pansouReady(): boolean
    search(keyword: string): Promise<NetdiskItem[]>
    snap(
      url: string,
      password: string,
      dirCid: string,
      offset: number
    ): Promise<ShareSnap>
    receive(
      url: string,
      password: string,
      fileIds: string[],
      cid: string
    ): Promise<void>
    /** 文件夹 cid 第一页条目的文件名（查重用） */
    names(cid: string): Promise<string[]>
    /** 文件夹 cid 从根开始的各级名字（不含根） */
    dirPath(cid: string): Promise<string[]>
  }
  /** 追更的闸门与拉黑表 */
  guard(): Promise<Pan115Guard>
  /** 转存目标文件夹：cid 与显示名 */
  folder(): { cid: string; name: string }
  notify(changes: FileChangeNotice[]): Promise<void>
  now(): number
  /** 延时执行（主动通知媒体库用） */
  later(run: () => void, ms: number): void
  log(message: string): void
}

/** 库外发现服务：方法与 discover 域一一对应 */
export interface DiscoverService {
  status(): Promise<DiscoverReady>
  find(target: DiscoverTarget): Promise<DiscoverFindResult>
  save(searchId: string, index: number): Promise<DiscoverSaveResult>
}

/** 一次搜索结果（主进程内） */
interface StoredResult {
  at: number
  candidates: AutograbCandidate[]
  /** 已转存的 file_id（重复点转存直接算成功） */
  saved: Set<string>
}

const NOT_LOGGED_IN = '请先在设置 · 网盘里扫码登录 115'
const NO_PANSOU = '请先在设置 · 网盘里填写 PanSou 地址'

/** 目标 cid 不是数字时退回根目录 */
export function safeCid(cid: string): string {
  return /^\d+$/.test(cid) ? cid : '0'
}

/** 创建库外发现服务 */
export function createDiscoverService(deps: DiscoverDeps): DiscoverService {
  const results = new Map<string, StoredResult>()
  let seq = 0
  let guardRef: Pan115Guard | null = null

  async function guard(): Promise<Pan115Guard> {
    guardRef ??= await deps.guard()
    return guardRef
  }

  const finder = createMovieFinder({
    search: keyword => deps.pan.search(keyword),
    snap: async (item, dir, offset) =>
      (await guard()).run('snap', () =>
        deps.pan.snap(item.url, item.receiveCode, dir, offset)
      ),
    blocked: code => guardRef?.blocked(code) ?? false,
    block: code => guardRef?.block(code),
    now: deps.now,
  })

  function remember(candidates: AutograbCandidate[]): string {
    const now = deps.now()
    for (const [id, item] of results)
      if (now - item.at > RESULT_TTL_MS) results.delete(id)
    while (results.size >= MAX_RESULTS)
      results.delete(results.keys().next().value as string)
    const id = `d${++seq}`
    results.set(id, { at: now, candidates, saved: new Set() })
    return id
  }

  /** 转存后过一会儿还没入库：按 115 路径通知媒体库扫一次 */
  function notifyLater(cid: string, fileName: string): void {
    deps.later(() => {
      void (async () => {
        const dirs = await (
          await guard()
        ).run('snap', () => deps.pan.dirPath(cid))
        await deps.notify([
          { action: 'create', path: `/${[...dirs, fileName].join('/')}` },
        ])
      })().catch(e => deps.log(`通知媒体库失败：${(e as Error).message}`))
    }, NOTIFY_AFTER_MS)
  }

  return {
    async status(): Promise<DiscoverReady> {
      const gate = await guard()
      return {
        loggedIn: await deps.pan.loggedIn(),
        pansou: deps.pan.pansouReady(),
        paused: gate.pauseReason(),
        folder: deps.folder().name || '根目录',
      }
    },

    async find(target: DiscoverTarget): Promise<DiscoverFindResult> {
      if (!deps.pan.pansouReady())
        return { ok: false, error: NO_PANSOU, setup: 'pansou' }
      if (!(await deps.pan.loggedIn()))
        return { ok: false, error: NOT_LOGGED_IN, setup: 'login' }
      const paused = (await guard()).pauseReason()
      if (paused) return { ok: false, error: paused }
      try {
        const found = await finder.find(target)
        return {
          ok: true,
          searchId: remember(found.candidates),
          candidates: found.candidates.map(c => ({
            fileName: c.fileName,
            size: c.size,
            score: c.score,
            reasons: c.reasons,
            shareTitle: c.shareTitle,
          })),
          note: found.note,
        }
      } catch (error) {
        return { ok: false, error: (error as Error).message }
      }
    },

    async save(searchId: string, index: number): Promise<DiscoverSaveResult> {
      const stored = results.get(searchId)
      const candidate = stored?.candidates[index]
      if (!stored || !candidate || deps.now() - stored.at > RESULT_TTL_MS)
        return { ok: false, error: '候选已过期，请重新搜索' }
      const folder = deps.folder()
      const name = folder.name || '根目录'
      if (stored.saved.has(candidate.fileId))
        return { ok: true, fileName: candidate.fileName, folder: name }
      if (!(await deps.pan.loggedIn()))
        return { ok: false, error: NOT_LOGGED_IN, setup: 'login' }
      const gate = await guard()
      const cid = safeCid(folder.cid)
      try {
        const existing = await gate.run('snap', () => deps.pan.names(cid))
        if (!existing.includes(candidate.fileName))
          await gate.run('receive', () =>
            deps.pan.receive(
              candidate.shareUrl,
              candidate.password,
              [candidate.fileId],
              cid
            )
          )
      } catch (error) {
        if ((error as { code?: number }).code !== ALREADY_RECEIVED) {
          if (isDeadShare(error)) {
            const ref = parseShareLink(candidate.shareUrl, candidate.password)
            if (ref) gate.block(ref.shareCode)
          }
          const message = (error as Error).message
          return {
            ok: false,
            error:
              error instanceof GateClosed ? message : `转存失败：${message}`,
          }
        }
      }
      stored.saved.add(candidate.fileId)
      deps.log(`已转存 ${candidate.fileName} → ${name}`)
      notifyLater(cid, candidate.fileName)
      return { ok: true, fileName: candidate.fileName, folder: name }
    },
  }
}

/**
 * 追更 · 转存与入库核对：把选中的候选只存那一个文件到这部剧的 115 文件夹（target.ts 现算），之后跟进到媒体库里出现这一集。
 *
 * - 转存前列目标文件夹，同名文件已在就不再转存（重启后不会重复存）；115 说「已经接收过」也算成功；
 * - 真要转存时先查 115 剩余空间：不够「候选体积 + {@link SPACE_MARGIN}」就把这一集标成空间不足、
 *   全局暂停自动转存（state.spacePause），等用户清理后点恢复或手动转存成功；
 * - 存完再列一次目标文件夹，记下新文件在自己 115 里的 id 和体积（撤销只删它，见 revert.ts）；
 * - 分享失效 / 提取码错：拉黑分享、去掉这个候选，没有候选了就回到等待、按计划再搜；
 * - 转存 {@link NOTIFY_AFTER_MS} 后仍没入库，按 115 路径主动通知媒体库扫一次（不靠 CloudDrive2 webhook）；
 *   {@link STALE_AFTER_MS} 后仍没有就再通知一次并在记录上报错（写明 115 路径），提示检查文件夹与媒体库的对应。
 */
import type {
  AutograbCandidate,
  AutograbResult,
} from '../../shared/contract/autograb'
import { parseShareLink } from '../pan115/share-link'
import { isDeadShare } from './finder'
import { type Gate, GateClosed } from './gate'
import { nextTry } from './schedule-rules'
import type { AutograbDeps } from './deps'
import {
  type AutograbState,
  BLOCK_MS,
  type EpisodeRecord,
  candidateKey,
  ensureSetting,
} from './state'

/** 转存后多久还没入库就主动通知媒体库 */
export const NOTIFY_AFTER_MS = 10 * 60_000
/** 转存后多久还没入库就报错 */
export const STALE_AFTER_MS = 3_600_000
/** 115 说「已经接收过」 */
export const ALREADY_RECEIVED = 4100024
/** 转存后至少还要剩这么多空间 */
export const SPACE_MARGIN = 1024 ** 3

/** 字节 → 「1.2 GB」 */
function gbText(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

/** 候选的身份（分享码取不到时退回用链接） */
function keyOf(candidate: AutograbCandidate): string {
  const ref = parseShareLink(candidate.shareUrl, candidate.password)
  return candidateKey(ref?.shareCode ?? candidate.shareUrl, candidate.fileId)
}

/** 转存需要的上下文 */
export interface SaverContext {
  automaticAllowed?(record: EpisodeRecord): boolean
  state(): AutograbState
  gate(): Gate
  deps: Pick<AutograbDeps, 'pan' | 'notify' | 'now' | 'log' | 'followsLibrary'>
  dirty(): void
  /** 这一集转存到哪个 cid（每次现算，见 target.ts）；解析不出时抛错 */
  targetCid(record: EpisodeRecord): Promise<string>
}

/** 创建转存器 */
export function createSaver(ctx: SaverContext): {
  grab(
    record: EpisodeRecord,
    index: number,
    byUser: boolean
  ): Promise<AutograbResult>
  followSaved(record: EpisodeRecord, now: number): Promise<void>
  rescan(record: EpisodeRecord): Promise<AutograbResult>
} {
  /** 转存一个候选；byUser 时算一次确认 */
  async function grab(
    record: EpisodeRecord,
    index: number,
    byUser: boolean
  ): Promise<AutograbResult> {
    const current = (): boolean => ctx.state().episodes[record.key] === record
    if (!current()) return { ok: false, error: '追剧任务已取消' }
    if (record.status === 'saved' || record.status === 'done')
      return { ok: true }
    const candidate = record.candidates[index]
    if (!candidate) return { ok: false, error: '候选不存在，请重新搜索' }
    let cid: string
    try {
      cid = await ctx.targetCid(record)
    } catch (error) {
      return failed(record, index, error)
    }
    // 真的发了转存（含 115 说已接收过）才记文件 id：同名文件本来就在时不归追更管，不能撤销
    let received = false
    try {
      const gate = ctx.gate()
      const existing = await gate.run('snap', () => ctx.deps.pan.entries(cid))
      if (!existing.some(e => !e.isDir && e.name === candidate.fileName)) {
        const space = await gate.run('snap', () => ctx.deps.pan.space())
        const need = Math.max(0, candidate.size) + SPACE_MARGIN
        if (!current()) return { ok: false, error: '追剧任务已取消' }
        if (space.remain < need) return noSpace(record, space.remain, need)
        await receive(record, candidate, cid, byUser)
        received = true
      }
    } catch (error) {
      const code = (error as { code?: number }).code
      if (code !== ALREADY_RECEIVED) return failed(record, index, error)
      received = true
    }
    let savedFile: { id: string; size: number } | null = null
    if (received) {
      try {
        savedFile = await locate(cid, candidate.fileName)
        if (!savedFile)
          throw new Error('所选目录中未找到文件，请核对 115 转存位置后重试')
      } catch (error) {
        return failed(record, index, error)
      }
    }
    if (!current()) return { ok: true }
    if (byUser) ctx.state().spacePause = null
    record.status = 'saved'
    record.savedAt = ctx.deps.now()
    record.savedName = candidate.fileName
    record.savedCid = cid
    record.notified = false
    record.savedFileId = savedFile?.id ?? null
    record.savedSize = savedFile?.size ?? null
    record.savedFrom = keyOf(candidate)
    record.revertedName = null
    record.error = null
    record.libraryError = null
    record.nextTry = null
    // 跟随全局、没设过的剧也要记确认次数（全自动的前几集门槛）
    if (byUser)
      ensureSetting(ctx.state(), record.seriesId, record.seriesTitle)
        .confirmed++
    ctx.deps.log(
      `已转存 ${record.seriesTitle} S${record.season}E${record.episode}：${candidate.fileName}`
    )
    ctx.dirty()
    return { ok: true }
  }

  /** 只把那一个文件存到 cid */
  function receive(
    record: EpisodeRecord,
    candidate: AutograbCandidate,
    cid: string,
    byUser: boolean
  ): Promise<void> {
    return ctx.gate().run('receive', () => {
      if (!byUser && ctx.automaticAllowed?.(record) === false)
        throw new GateClosed('自动转存已暂停，稍后继续')
      if (ctx.state().episodes[record.key] !== record)
        throw new Error('追剧任务已取消')
      return ctx.deps.pan.receive(
        candidate.shareUrl,
        candidate.password,
        [candidate.fileId],
        cid
      )
    })
  }

  /** 转存后在目标文件夹里找到那个文件（新上传的排在前面） */
  async function locate(
    cid: string,
    name: string
  ): Promise<{ id: string; size: number } | null> {
    const after = await ctx.gate().run('snap', () => ctx.deps.pan.entries(cid))
    const file = after.find(e => !e.isDir && e.name === name)
    return file ? { id: file.id, size: file.size } : null
  }

  /** 空间不够：这一集标成空间不足（候选留着），全局暂停自动转存 */
  function noSpace(
    record: EpisodeRecord,
    remain: number,
    need: number
  ): AutograbResult {
    const message = `115 剩余空间不足：还剩 ${gbText(remain)}，这一集需要 ${gbText(need)}（含 1 GB 余量）`
    record.status = 'noSpace'
    record.error = message
    ctx.state().spacePause =
      '115 剩余空间不足，自动转存已暂停：清理空间后点「恢复」'
    ctx.deps.log(message)
    ctx.dirty()
    return { ok: false, error: message }
  }

  /** 转存失败：分享失效就拉黑分享、去掉这个候选，没有候选了回到等待 */
  function failed(
    record: EpisodeRecord,
    index: number,
    error: unknown
  ): AutograbResult {
    const message = (error as Error).message
    if (error instanceof GateClosed)
      return { ok: false, error: message, retryLater: true }
    if (isDeadShare(error)) {
      const candidate = record.candidates[index]
      const ref = parseShareLink(candidate.shareUrl, candidate.password)
      if (ref) ctx.state().blacklist[ref.shareCode] = ctx.deps.now() + BLOCK_MS
      record.candidates.splice(index, 1)
      if (!record.candidates.length) {
        record.status = 'waiting'
        record.nextTry = nextTry(record.airDate, ctx.deps.now())
      }
    }
    record.error = `转存失败：${message}`
    ctx.dirty()
    return { ok: false, error: message }
  }

  /** 已转存文件的 115 路径（通知媒体库、报错提示都用它） */
  async function savedPath(record: EpisodeRecord): Promise<string> {
    const dirs = await ctx
      .gate()
      .run('snap', () => ctx.deps.pan.dirPath(record.savedCid!))
    return `/${[...dirs, record.savedName ?? ''].join('/')}`
  }

  /** 已转存的集：没入库就主动通知一次，太久没入库就再通知一次并报错（写明路径） */
  async function followSaved(
    record: EpisodeRecord,
    now: number
  ): Promise<void> {
    if (ctx.deps.followsLibrary?.(record.seriesId) === false) return
    if (record.savedAt === null || !record.savedCid) return
    const waited = now - record.savedAt
    if (!record.notified && waited >= NOTIFY_AFTER_MS) {
      record.notified = true
      ctx.dirty()
      await ctx.deps.notify([
        { action: 'create', path: await savedPath(record) },
      ])
    } else if (waited >= STALE_AFTER_MS && !record.libraryError) {
      const path = await savedPath(record)
      record.libraryError = `已转存 1 小时仍没入库：${path} 可能不在媒体库监控的文件夹里，请检查后重新扫描`
      ctx.dirty()
      await ctx.deps.notify([{ action: 'create', path }])
    }
  }

  /** 手动重新入库：再通知一次媒体库扫这个 115 路径；没有媒体库接住就把路径告诉用户 */
  async function rescan(record: EpisodeRecord): Promise<AutograbResult> {
    if (ctx.deps.followsLibrary?.(record.seriesId) === false)
      return { ok: false, error: '此任务仅转存到 115 网盘，未关联媒体库' }
    if (record.status !== 'saved' || !record.savedCid)
      return { ok: false, error: '这一集还没有转存，没有可入库的文件' }
    const path = await savedPath(record)
    const result = await ctx.deps.notify([{ action: 'create', path }])
    if (result && result.accepted === 0)
      return {
        ok: false,
        error: `没有媒体库接住 ${path}：请把对应的 115 文件夹添加为媒体库，或在「设置 · 媒体库」里检查网盘挂载目录`,
      }
    record.libraryError = null
    record.notified = true
    record.savedAt = ctx.deps.now()
    ctx.dirty()
    return { ok: true }
  }

  return { grab, followSaved, rescan }
}

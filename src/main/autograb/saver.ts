/**
 * 追更 · 转存与入库核对：把选中的候选只存那一个文件到这部剧的 115 文件夹，之后跟进到媒体库里出现这一集。
 *
 * - 转存前列目标文件夹，同名文件已在就不再转存（重启后不会重复存）；115 说「已经接收过」也算成功；
 * - 真要转存时先查 115 剩余空间：不够「候选体积 + {@link SPACE_MARGIN}」就把这一集标成空间不足、
 *   全局暂停自动转存（state.spacePause），等用户清理后点恢复或手动转存成功；
 * - 存完再列一次目标文件夹，记下新文件在自己 115 里的 id 和体积（撤销只删它，见 revert.ts）；
 * - 分享失效 / 提取码错：拉黑分享、去掉这个候选，没有候选了就回到等待、按计划再搜；
 * - 转存 {@link NOTIFY_AFTER_MS} 后仍没入库，按 115 路径主动通知媒体库扫一次（不靠 CloudDrive2 webhook）；
 *   {@link STALE_AFTER_MS} 后仍没有就在记录上报错，提示检查文件夹与媒体库的对应。
 */
import type {
  AutograbCandidate,
  AutograbResult,
} from '../../shared/contract/autograb'
import { parseShareLink } from '../pan115/share-link'
import { isDeadShare } from './finder'
import type { Gate } from './gate'
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
export const STALE_AFTER_MS = 24 * 3_600_000
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
  state(): AutograbState
  gate(): Gate
  deps: Pick<AutograbDeps, 'pan' | 'notify' | 'now' | 'log'>
  dirty(): void
  /** 这一集转存到哪个 cid */
  targetCid(record: EpisodeRecord): string
}

/** 创建转存器 */
export function createSaver(ctx: SaverContext): {
  grab(
    record: EpisodeRecord,
    index: number,
    byUser: boolean
  ): Promise<AutograbResult>
  followSaved(record: EpisodeRecord, now: number): Promise<void>
} {
  /** 转存一个候选；byUser 时算一次确认 */
  async function grab(
    record: EpisodeRecord,
    index: number,
    byUser: boolean
  ): Promise<AutograbResult> {
    if (record.status === 'saved' || record.status === 'done')
      return { ok: true }
    const candidate = record.candidates[index]
    if (!candidate) return { ok: false, error: '候选不存在，请重新搜索' }
    const cid = ctx.targetCid(record)
    // 真的发了转存（含 115 说已接收过）才记文件 id：同名文件本来就在时不归追更管，不能撤销
    let received = false
    try {
      const gate = ctx.gate()
      const existing = await gate.run('snap', () => ctx.deps.pan.entries(cid))
      if (!existing.some(e => e.name === candidate.fileName)) {
        const space = await gate.run('snap', () => ctx.deps.pan.space())
        const need = Math.max(0, candidate.size) + SPACE_MARGIN
        if (space.remain < need) return noSpace(record, space.remain, need)
        await receive(candidate, cid)
        received = true
      }
    } catch (error) {
      const code = (error as { code?: number }).code
      if (code !== ALREADY_RECEIVED) return failed(record, index, error)
      received = true
    }
    const savedFile = received
      ? await locate(cid, candidate.fileName).catch(() => null)
      : null
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
  function receive(candidate: AutograbCandidate, cid: string): Promise<void> {
    return ctx
      .gate()
      .run('receive', () =>
        ctx.deps.pan.receive(
          candidate.shareUrl,
          candidate.password,
          [candidate.fileId],
          cid
        )
      )
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

  /** 已转存的集：没入库就主动通知一次，太久没入库就报错 */
  async function followSaved(
    record: EpisodeRecord,
    now: number
  ): Promise<void> {
    if (record.savedAt === null) return
    if (
      !record.notified &&
      now - record.savedAt >= NOTIFY_AFTER_MS &&
      record.savedCid
    ) {
      record.notified = true
      ctx.dirty()
      const dirs = await ctx
        .gate()
        .run('snap', () => ctx.deps.pan.dirPath(record.savedCid!))
      const path = `/${[...dirs, record.savedName ?? ''].join('/')}`
      await ctx.deps.notify([{ action: 'create', path }])
    } else if (now - record.savedAt >= STALE_AFTER_MS && !record.error) {
      record.error = '已转存一天仍没入库：检查这部剧的 115 文件夹是否在媒体库里'
      ctx.dirty()
    }
  }

  return { grab, followSaved }
}

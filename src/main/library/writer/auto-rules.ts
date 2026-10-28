/**
 * 识别后的自动后续（纯规则）：按条目所在媒体库的自动化设置，给出识别任务的后继——哪些条目自动写出、
 * 哪些自动整理（整理任务自己的后继是整理后写出，见 writer-module 的任务定义）。
 *
 * - 写出：库设置 write 为 on / off 时以库为准；inherit 跟随写出设置里的「识别后自动写出」。
 * - 整理：库设置 organize 开启，且写出设置里「允许整理文件」也开启（全局总闸，默认关）。
 * - 同时要整理又要写出的条目，先整理、后写出：NFO 与图片直接写到最终位置，不用再搬一次。
 */
import type {
  LibraryAutomation,
  MatchState,
  WriterSettings,
} from '../../../shared/library/ipc'
import type { FollowupSpec } from '../jobs/followups'
import { PRIORITY, writeJobSpec } from './writer-rules'

/** 自动整理任务载荷。 */
export interface AutoOrganizePayload {
  /** 要整理的顶层条目。 */
  itemIds: number[]
  /** 整理结束后再写出的条目。 */
  writeAfter: number[]
}

/** 分组需要的查询。 */
export interface AutoFollowupDeps {
  /** 条目所在媒体库；条目已不存在时 undefined。 */
  libraryOf: (itemId: number) => number | undefined
  /** 媒体库的自动化设置；媒体库已不存在时 undefined。 */
  automationOf: (libraryId: number) => LibraryAutomation | undefined
}

/** 按库设置把识别出变化的条目分成“立即写出”和“先整理再写出”两种后继（都是自动优先级）。 */
export function autoFollowups(
  itemIds: readonly number[],
  settings: WriterSettings,
  deps: AutoFollowupDeps
): FollowupSpec[] {
  const write: number[] = []
  const organize: number[] = []
  const writeAfter: number[] = []
  const cache = new Map<number, LibraryAutomation | undefined>()
  for (const id of new Set(itemIds)) {
    const libraryId = deps.libraryOf(id)
    if (libraryId === undefined) continue
    if (!cache.has(libraryId))
      cache.set(libraryId, deps.automationOf(libraryId))
    const automation = cache.get(libraryId)
    if (!automation) continue
    const shouldWrite =
      automation.write === 'inherit'
        ? settings.autoWriteAfterIdentify
        : automation.write === 'on'
    const shouldOrganize = automation.organize && settings.organize.enabled
    if (shouldOrganize) {
      organize.push(id)
      if (shouldWrite) writeAfter.push(id)
    } else if (shouldWrite) {
      write.push(id)
    }
  }
  const specs: FollowupSpec[] = []
  if (write.length) specs.push(writeJobSpec(write, PRIORITY.auto))
  if (organize.length)
    specs.push(autoOrganizeSpec({ itemIds: organize, writeAfter }))
  return specs
}

/** writer-auto-organize 任务：全局一个键，只试一次（改名移动失败不自动重来）。 */
export const autoOrganizeSpec = (
  payload: AutoOrganizePayload
): FollowupSpec => ({
  type: 'writer-auto-organize',
  key: 'writer-auto-organize',
  payload,
  priority: PRIORITY.auto,
  maxAttempts: 1,
})

/** 自动整理结束（成功或失败）后的后继：整理时带上的条目写出到最终位置。 */
export const afterAutoOrganize = (
  payload: AutoOrganizePayload
): FollowupSpec[] =>
  payload.writeAfter.length
    ? [writeJobSpec(payload.writeAfter, PRIORITY.auto)]
    : []

/** 合并排队中的自动整理：两组条目各取并集。 */
export const mergeAutoOrganizePayload = (
  a: unknown,
  b: unknown
): AutoOrganizePayload => {
  const x = a as AutoOrganizePayload
  const y = b as AutoOrganizePayload
  return {
    itemIds: [...new Set([...x.itemIds, ...y.itemIds])],
    writeAfter: [...new Set([...x.writeAfter, ...y.writeAfter])],
  }
}

/** 只有确定的匹配才自动整理：待确认 / 未匹配的条目按模板改名很可能改错。 */
export const canAutoOrganize = (state: MatchState): boolean =>
  state === 'auto' || state === 'locked'

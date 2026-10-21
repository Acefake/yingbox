/**
 * 识别后的自动后续（纯规则）：按条目所在媒体库的自动化设置，决定哪些条目自动写出、哪些自动整理。
 *
 * - 写出：库设置 write 为 on / off 时以库为准；inherit 跟随写出设置里的「识别后自动写出」。
 * - 整理：库设置 organize 开启，且写出设置里「允许整理文件」也开启（全局总闸，默认关）。
 * - 同时要整理又要写出的条目，先整理、后写出：NFO 与图片直接写到最终位置，不用再搬一次。
 *
 * 行为参考 Amane 的库级 auto_organize（刮削成功后随任务成链整理）与 write_nfo，代码独立实现。
 */
import type {
  LibraryAutomation,
  MatchState,
  WriterSettings,
} from '../../../shared/library/ipc'

/** 自动整理任务载荷。 */
export interface AutoOrganizePayload {
  /** 要整理的顶层条目。 */
  itemIds: number[]
  /** 整理结束后再写出的条目。 */
  writeAfter: number[]
}

/** 自动后续的分组结果。 */
export interface AutoFollowups {
  /** 立即写出。 */
  write: number[]
  /** 自动整理（载荷里带着整理后要写出的条目）；没有要整理的条目时为 null。 */
  organize: AutoOrganizePayload | null
}

/** 分组需要的查询。 */
export interface AutoFollowupDeps {
  /** 条目所在媒体库；条目已不存在时 undefined。 */
  libraryOf: (itemId: number) => number | undefined
  /** 媒体库的自动化设置；媒体库已不存在时 undefined。 */
  automationOf: (libraryId: number) => LibraryAutomation | undefined
}

/** 按库设置把识别出变化的条目分成“立即写出”和“先整理再写出”。 */
export function autoFollowups(
  itemIds: readonly number[],
  settings: WriterSettings,
  deps: AutoFollowupDeps
): AutoFollowups {
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
  return {
    write,
    organize: organize.length ? { itemIds: organize, writeAfter } : null,
  }
}

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

/** CMS 列表测活的判定：不只要有列表，列表里还得有能播的地址。 */
import { asRecord, asText } from '../../../../../shared/json'

/** 抽查前几条影片的播放地址 */
const SAMPLE = 5

/**
 * 列表接口响应的问题；没有问题返回 null。
 * 空列表、前几条影片都没有 http(s) 播放地址的源即使接口通也不可用（只通列表、播不了）。
 */
export function videoListError(
  data: { list?: unknown } | undefined
): string | null {
  if (!Array.isArray(data?.list)) return '接口响应缺少列表'
  if (!data.list.length) return '接口没有任何影片'
  const playable = data.list
    .slice(0, SAMPLE)
    .some(item =>
      /https?:\/\//i.test(asText(asRecord(item)?.vod_play_url) ?? '')
    )
  return playable ? null : '接口没有可播放地址'
}

/** 列表响应有问题就抛错（测活用，错误文案进健康记录） */
export function assertVideoList(data: { list?: unknown } | undefined): void {
  const problem = videoListError(data)
  if (problem) throw new Error(problem)
}

/** 一天的毫秒数 */
export const DAY_MS = 24 * 60 * 60_000
/** 完整自检的间隔：应用一直开着时每 12 小时重新检测全部源 */
export const FULL_CHECK_MS = 12 * 60 * 60_000

/** 连续不通的天数（向下取整；不到一天或没记录为 0） */
export function deadDays(since: number | undefined, now: number): number {
  return since === undefined
    ? 0
    : Math.max(0, Math.floor((now - since) / DAY_MS))
}

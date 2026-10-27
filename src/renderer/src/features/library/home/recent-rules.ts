/**
 * 首页「刚入库」横卡的纯规则：入库时间的说法、卡片右上角的画质角标。
 * 入库来源（115 转存 / 磁力离线）片库里没有记录，卡上不写。
 */
import { type SpecBadge, releaseSpecs } from '@/components/ui/spec-badge'
import type { VideoRange } from '../../../../../shared/video-range'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 本机时区某天 0 点 */
const dayStart = (ms: number): number => new Date(ms).setHours(0, 0, 0, 0)

/**
 * 入库时间：「今天」「昨天」，一周内写星期（「周一」），再早写「10月3日」，跨年加年份。
 * @param addedAt 入库时间（毫秒）
 * @param now 当前时间（毫秒）
 */
export function addedLabel(addedAt: number, now: number): string {
  const days = Math.round((dayStart(now) - dayStart(addedAt)) / 86_400_000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  const d = new Date(addedAt)
  if (days < 7) return WEEKDAYS[d.getDay()]
  const date = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === new Date(now).getFullYear()
    ? date
    : `${d.getFullYear()}年${date}`
}

/**
 * 画质角标：视频文件名里认出 4K / 1080P 就用它；文件名没写、但探测到杜比视界 / HDR 时用动态范围；都没有为 null。
 * @param fileNames 视频文件路径或文件名
 * @param videoRange 探测到的动态范围
 */
export function qualityBadge(
  fileNames: readonly string[],
  videoRange?: VideoRange | null
): SpecBadge | null {
  const names = fileNames.map(path => path.split(/[\\/]/).pop() ?? path)
  const resolution = releaseSpecs(names).find(
    spec => spec.text === '4K' || spec.text === '1080P'
  )
  if (resolution) return resolution
  if (videoRange === 'dv') return { variant: 'dolby', text: 'VISION' }
  if (videoRange === 'hdr10' || videoRange === 'hlg')
    return { variant: 'solid', text: 'HDR' }
  return null
}

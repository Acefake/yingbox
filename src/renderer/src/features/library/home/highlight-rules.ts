/**
 * 首页 Hero 的片库条目信息：规格标签、元信息行（年份 · 类型 · 时长 / 季数）的纯规则。
 *
 * 规格标签：分级圆标在前，其余取 spec-badge.ts 的 mediaSpecs（探测到的动态范围 + 视频文件名里的 4K / 全景声 / 中字）。
 */
import { type SpecBadge, mediaSpecs } from '@/components/ui/spec-badge'
import type { LibraryItemNode } from '../../../../../shared/library/ipc'
import type { VideoRange } from '../../../../../shared/video-range'

/** 分级圆标最多放几个字（更长的如 PG-13 改用描边小方块）。 */
const RATING_CIRCLE_MAX = 3

/**
 * Hero 上的规格标签。
 * @param input.certification 分级（TMDB，如「13+」「PG-13」）
 * @param input.videoRange 条目全部文件里最好的一档动态范围
 * @param input.fileNames 视频文件路径或文件名
 */
export function highlightSpecs(input: {
  certification?: string | null
  videoRange?: VideoRange | null
  fileNames: readonly string[]
}): SpecBadge[] {
  const cert = input.certification?.trim()
  const rating: SpecBadge[] = cert
    ? [
        {
          variant: cert.length <= RATING_CIRCLE_MAX ? 'rating' : 'outline',
          text: cert,
        },
      ]
    : []
  return [...rating, ...mediaSpecs(input)]
}

/** 时长：「2 小时 46 分」「45 分钟」；未知为空串。 */
export function runtimeLabel(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return ''
  const m = Math.round(minutes)
  if (m < 60) return `${m} 分钟`
  const rest = m % 60
  return `${Math.floor(m / 60)} 小时${rest ? ` ${rest} 分` : ''}`
}

/**
 * 元信息行：年份、前两个类型、电影时长或剧集季数，空的项跳过。
 * @example ['2024 年', '科幻、冒险', '2 小时 46 分']
 */
export function highlightMeta(node: LibraryItemNode): string[] {
  const seasons = node.children.filter(child => child.type === 'season').length
  return [
    node.year ? `${node.year} 年` : '',
    node.genres.slice(0, 2).join('、'),
    node.type === 'movie'
      ? runtimeLabel(node.runtime)
      : seasons
        ? `${seasons} 季`
        : '',
  ].filter(Boolean)
}

/** 条目下的视频文件路径（剧集逐季逐集收集），最多 limit 个。 */
export function videoNamesOf(node: LibraryItemNode, limit = 24): string[] {
  const names: string[] = []
  const walk = (n: LibraryItemNode): void => {
    for (const file of n.files) {
      if (names.length >= limit) return
      if (file.kind === 'video') names.push(file.path)
    }
    for (const child of n.children) {
      if (names.length >= limit) return
      walk(child)
    }
  }
  walk(node)
  return names
}

/** 分级：元数据里的 certification（只有电影 / 剧集层级有）。 */
export function certificationOf(node: LibraryItemNode): string | null {
  const meta = node.metadata
  return meta && meta.level === 'title' ? (meta.certification ?? null) : null
}

/**
 * 详情里「版本」的纯规则：选哪个版本播放、版本 / 来源的展示文字。
 *
 * 引擎已按「分辨率 > 动态范围 > 体积」排好 versions，默认取第一个。用户的选择用一个字符串记：
 * - 电影选某个版本：版本的 key（`f<首个文件 id>`）；
 * - 剧集选某个来源（合并进来的一个本地条目）：`i<条目 id>`，每一集优先用这个来源里最好的版本，
 *   这一集在那里没有时退回整体最好的。
 */
import type {
  LibraryItemNode,
  LibraryVersion,
  MergeMember,
} from '../../../../../shared/library/ipc'
import { videoRangeSpec } from '@/components/ui/spec-badge'
import { formatBytes } from '../shared/format'

/** 来源选择的键。 */
export const sourceKey = (itemId: number): string => `i${itemId}`

/** 按用户的选择挑版本；没有版本返回 undefined。 */
export function pickVersion(
  node: LibraryItemNode,
  prefer?: string | null
): LibraryVersion | undefined {
  const versions = node.versions
  if (!versions?.length) return undefined
  if (prefer) {
    const exact = versions.find(v => v.key === prefer)
    if (exact) return exact
    const fromSource = versions.find(v => sourceKey(v.itemId) === prefer)
    if (fromSource) return fromSource
  }
  return versions[0]
}

/** 版本里的动态范围文字：取规格标签的同一份映射，杜比视界在一行文字里写作 DV */
function rangeText(range: LibraryVersion['range']): string {
  const spec = videoRangeSpec(range)
  if (!spec) return ''
  return spec.variant === 'dolby' ? 'DV' : spec.text
}

/** 版本规格：「2160p · DV · 23.4 GB」；分辨率读不出时省略。 */
export function versionLabel(version: LibraryVersion): string {
  return [
    version.height ? `${version.height}p` : '',
    rangeText(version.range),
    version.fileIds.length > 1 ? `${version.fileIds.length} 段` : '',
    formatBytes(version.size),
  ]
    .filter(Boolean)
    .join(' · ')
}

/** 剧集一个来源的汇总：有几集、最好的分辨率、总大小。 */
export interface SourceSummary {
  member: MergeMember
  episodes: number
  label: string
}

/** 剧集各来源的汇总（按 merge.members 顺序）；没合并返回空数组。 */
export function sourceSummaries(series: LibraryItemNode): SourceSummary[] {
  const members = series.merge?.members ?? []
  if (members.length < 2) return []
  const stats = new Map(
    members.map(m => [m.itemId, { episodes: 0, height: 0, size: 0 }])
  )
  const visit = (node: LibraryItemNode): void => {
    if (node.type === 'episode') {
      const seen = new Set<number>()
      for (const v of node.versions ?? []) {
        const s = stats.get(v.itemId)
        if (!s) continue
        if (!seen.has(v.itemId)) s.episodes++
        seen.add(v.itemId)
        s.height = Math.max(s.height, v.height ?? 0)
        s.size += v.size
      }
    }
    node.children.forEach(visit)
  }
  visit(series)
  return members.map(member => {
    const s = stats.get(member.itemId)!
    return {
      member,
      episodes: s.episodes,
      label: [
        `${s.episodes} 集`,
        s.height ? `最高 ${s.height}p` : '',
        formatBytes(s.size),
      ]
        .filter(Boolean)
        .join(' · '),
    }
  })
}

/** 详情要不要显示版本区块：电影有多个版本，或剧集合并了多个来源，或条目被拆出过。 */
export function showVersions(node: LibraryItemNode | null): boolean {
  if (!node) return false
  if (node.merge) return true
  return node.type === 'movie' && (node.versions?.length ?? 0) > 1
}

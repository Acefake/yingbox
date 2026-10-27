/**
 * 网盘页结果行：先按用户选的方式排序（默认 / 画质 / 时间 / 体积），搜索词带集号时再按这一集分档：
 * 正好这一集 → 包含这一集（更新至 / 全集 / 区间）→ 没写集号；明确是别的集的分享 / 磁力折叠起来，
 * 点「其他集」展开后接在最后。失效的 115 分享仍沉到所在列表末尾（linkOrder）。
 * 新搜索（意图变了）时折叠回去。
 * 「最佳版本」的候选：有写明这一集（或包含这一集）的就只在这些里挑，免得没写集号的 4K 整部剧盖过它。
 */
import { type ComputedRef, type Ref, computed, ref, watch } from 'vue'

import type {
  MagnetItem,
  NetdiskItem,
} from '../../../../../shared/contract/pan115'
import {
  episodeHint,
  rankByEpisode,
} from '../../../../../shared/netdisk/episode-hint'
import {
  type EpisodeTarget,
  type SearchIntent,
  episodeTargetOf,
} from '../../../../../shared/netdisk/search-intent'

import { type ReleaseSort, sortReleases } from '../utils/release-quality'

/** 结果行状态 */
export interface EpisodeRows {
  /** 要找的那一集；搜索词没写集号为 null */
  target: ComputedRef<EpisodeTarget | null>
  /** 列表里显示的 115 分享（展开时含其他集） */
  shareRows: ComputedRef<NetdiskItem[]>
  magnetRows: ComputedRef<MagnetItem[]>
  /** 「最佳版本」的候选 115 分享 */
  bestShares: ComputedRef<NetdiskItem[]>
  bestMagnets: ComputedRef<MagnetItem[]>
  /** 折叠起来的其他集条数 */
  others: ComputedRef<{ share: number; magnet: number }>
  /** 其他集已展开 */
  showOthers: Ref<boolean>
  /** 当前页签折叠起来的其他集条数 */
  hiddenCount: ComputedRef<number>
  /** 展开 / 收起按钮的文字 */
  othersLabel: ComputedRef<string>
  toggleOthers(): void
}

/** 依赖：搜索结果、意图、排序与失效沉底 */
export interface EpisodeRowsDeps {
  items: Ref<NetdiskItem[]>
  magnets: Ref<MagnetItem[]>
  intent: Ref<SearchIntent | null>
  sort: Ref<ReleaseSort>
  /** 失效的分享沉到最后（useLinkCheck.order） */
  linkOrder: (items: NetdiskItem[]) => NetdiskItem[]
  /** 当前页签（share / magnet / offline） */
  tab: () => string
}

/**
 * 最佳版本候选：写明这一集或包含这一集的；一条都没有时用全部相关结果。
 * @param main 和这一集相关的结果（已去掉别的集）
 */
function bestPool<T extends { title: string }>(
  main: T[],
  target: EpisodeTarget | null
): T[] {
  if (!target) return main
  const sure = main.filter(
    item => episodeHint(item.title, target) !== 'unknown'
  )
  return sure.length ? sure : main
}

/** 搜索结果 → 列表行 */
export function useEpisodeRows(deps: EpisodeRowsDeps): EpisodeRows {
  const showOthers = ref(false)
  const target = computed(() =>
    deps.intent.value ? episodeTargetOf(deps.intent.value) : null
  )
  watch(deps.intent, () => void (showOthers.value = false))

  const shares = computed(() =>
    rankByEpisode(
      sortReleases(deps.items.value, deps.sort.value, item => item),
      target.value,
      item => item.title
    )
  )
  const links = computed(() =>
    rankByEpisode(
      sortReleases(deps.magnets.value, deps.sort.value, item => item),
      target.value,
      item => item.title
    )
  )

  const others = computed(() => ({
    share: shares.value.others.length,
    magnet: links.value.others.length,
  }))
  const onMagnet = (): boolean => deps.tab() === 'magnet'
  const hiddenCount = computed(() =>
    onMagnet() ? others.value.magnet : others.value.share
  )
  const othersLabel = computed(() => {
    if (showOthers.value) return '收起其他集'
    const main = onMagnet() ? links.value.main : shares.value.main
    return `${main.length ? '' : '没有这一集 · '}其他集 ${hiddenCount.value} 条`
  })

  return {
    target,
    shareRows: computed(() => {
      const main = deps.linkOrder(shares.value.main)
      return showOthers.value
        ? [...main, ...deps.linkOrder(shares.value.others)]
        : main
    }),
    magnetRows: computed(() =>
      showOthers.value
        ? [...links.value.main, ...links.value.others]
        : links.value.main
    ),
    bestShares: computed(() => bestPool(shares.value.main, target.value)),
    bestMagnets: computed(() => bestPool(links.value.main, target.value)),
    others,
    showOthers,
    hiddenCount,
    othersLabel,
    toggleOthers: () => void (showOthers.value = !showOthers.value),
  }
}

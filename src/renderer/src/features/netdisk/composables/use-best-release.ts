/**
 * 网盘页的「最佳版本」：画质最高的 115 分享（「转存最佳版本」转存它）、全部结果里最好的一条，
 * 以及 Hero 小结（数量 + 最佳画质与体积）与最佳版本的规格标签。
 */
import { type ComputedRef, type Ref, computed } from 'vue'

import { type SpecBadge, releaseSpecs } from '@/components/ui/spec-badge'
import type {
  MagnetItem,
  NetdiskItem,
} from '../../../../../shared/contract/pan115'

import type { HeroSummary } from '../utils/hero-status'
import { formatBytes } from '../utils/netdisk-rules'
import { pickBest, qualityLabel, sizeFromTitle } from '../utils/release-quality'

/** 最佳版本相关的派生状态 */
export interface BestRelease {
  bestShare: ComputedRef<ReturnType<typeof pickBest<NetdiskItem>>>
  summary: ComputedRef<HeroSummary | null>
  bestSpecs: ComputedRef<SpecBadge[]>
}

/** 搜索状态 → 最佳版本 */
export function useBestRelease(search: {
  items: Ref<NetdiskItem[]>
  magnets: Ref<MagnetItem[]>
  searched: Ref<boolean>
  error: Ref<string>
  /** 挑最佳版本的范围（搜某一集时只在这一集相关的结果里挑）；不传为全部结果 */
  candidates?: {
    items: Readonly<Ref<NetdiskItem[]>>
    magnets: Readonly<Ref<MagnetItem[]>>
  }
}): BestRelease {
  const { items, magnets, searched, error } = search
  const pool = search.candidates ?? { items, magnets }
  const bestShare = computed(() =>
    pickBest(pool.items.value, item => item.title)
  )
  const bestOverall = computed(() => {
    const magnet = pickBest(pool.magnets.value, item => item.title)
    const share = bestShare.value
    if (!share || (magnet && magnet.quality.rank > share.quality.rank))
      return magnet
        ? { ...magnet, size: magnet.item.size ?? 0, title: magnet.item.title }
        : null
    return { ...share, size: 0, title: share.item.title }
  })
  const summary = computed<HeroSummary | null>(() => {
    if (!searched.value || error.value) return null
    const best = bestOverall.value
    const label = best ? qualityLabel(best.quality) : ''
    const size = best ? formatBytes(best.size || sizeFromTitle(best.title)) : ''
    return {
      shares: items.value.length,
      magnets: magnets.value.length,
      best: label ? [label, size].filter(Boolean).join(' ') : '',
    }
  })
  const bestSpecs = computed(() =>
    bestOverall.value ? releaseSpecs([bestOverall.value.title]) : []
  )
  return { bestShare, summary, bestSpecs }
}

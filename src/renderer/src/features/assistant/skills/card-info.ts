/**
 * 结果卡补片库信息：库里的条目（继续播放的片库记录、库外发现里已入库的、私密随机一部）按 id 取卡片信息
 * （说明行、规格标签、评分、想看、详情路由，见 features/library 的 libraryCardInfo），补进卡片。
 * 最多等 {@link CARD_INFO_WAIT_MS}，等不到就按原样出卡片，不拖住回答。
 */
import { type LibraryCardInfo, libraryCardInfo } from '@/features/library'

import type { AssistantMediaCard } from './skill-types'

/** 最多等多久 */
export const CARD_INFO_WAIT_MS = 1500

/**
 * 一组条目的卡片信息（与 ids 一一对应；id 为 null、取不到或超时为 null）。
 * @param ids 片库条目 id
 */
export async function cardInfos(
  ids: readonly (number | null)[]
): Promise<(LibraryCardInfo | null)[]> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>(resolve => {
    timer = setTimeout(() => resolve(null), CARD_INFO_WAIT_MS)
  })
  try {
    return await Promise.all(
      ids.map(id =>
        id === null
          ? null
          : Promise.race([libraryCardInfo(id).catch(() => null), timeout])
      )
    )
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 卡片补上片库信息：说明行与规格标签换成片库的，卡片自己没给评分时用片库评分。
 * @param card 卡片
 * @param info 卡片信息；null 时原样返回
 */
export function withLibraryInfo(
  card: AssistantMediaCard,
  info: LibraryCardInfo | null
): AssistantMediaCard {
  if (!info) return card
  return {
    ...card,
    meta: info.meta.join(' · ') || card.meta,
    specs: info.specs,
    rating: card.rating || info.rating,
    library: info,
  }
}

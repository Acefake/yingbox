/**
 * 防剧透的取数：读设置 ui.spoilerGuard、这部剧的「继续播放」记录与播放进度表，
 * 算出当前季里要遮住的集（剧照模糊、简介折叠，悬停显示）。规则在 spoiler-rules.ts。
 *
 * 继续播放记录是响应式的：播完一集回到详情，遮挡跟着更新（进度表本身不是响应式，随记录变化一起重读）。
 */
import { type ComputedRef, computed } from 'vue'

import type { LibraryItemNode } from '../../../../../shared/library/ipc'
import { continueRecords, readMediaProgress } from '@/features/player'
import { useSetting } from '@/features/settings'
import { serverFileUrl } from '@/services/library-server'

import { usesLibraryServer } from '../api/bridge'
import { continueMetaOf, videoFileEntries } from './playback'
import { seenKeysFromContinue, spoilerHidden } from './spoiler-rules'

/** 一集的进度键：桌面端文件路径，网页端片库服务的流地址（与播放时一致）。 */
function episodeKeys(episode: LibraryItemNode): string[] {
  const web = usesLibraryServer()
  return videoFileEntries(episode).map(file =>
    web ? serverFileUrl(file.id) : file.path
  )
}

/**
 * @param series 剧集条目（继续播放按它登记）
 * @param episodes 当前显示的集
 * @returns 要遮住的集 id
 */
export function useSpoilerGuard(
  series: () => LibraryItemNode,
  episodes: () => LibraryItemNode[]
): ComputedRef<Set<number>> {
  const enabled = useSetting('ui.spoilerGuard')
  const records = continueRecords()
  return computed(() => {
    if (!enabled.value) return new Set<number>()
    const meta = continueMetaOf(series())
    const id = `${meta.section}:${meta.key}`
    const seen = seenKeysFromContinue(records.value.find(r => r.id === id))
    return new Set(
      episodes()
        .filter(ep =>
          spoilerHidden(true, episodeKeys(ep), seen, readMediaProgress)
        )
        .map(ep => ep.id)
    )
  })
}

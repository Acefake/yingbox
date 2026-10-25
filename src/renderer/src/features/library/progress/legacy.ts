/**
 * 本地进度表里的媒体库进度：播放条目没带媒体库标记时（例如存储里没带标记的继续播放记录），播放器按文件
 * 记在本地进度表与「已看完」集合里（键是文件路径，网页端是片库服务的流地址）。作品第一次读进来时，
 * 片库里还没有的那几条搬进片库，带记录时的时间。本地那两份不删，在线等其它条目照常用。
 */
import type {
  LibraryItemNode,
  ProgressReport,
} from '../../../../../shared/library/ipc'
import { readMediaProgress } from '@/features/player'
import { serverFileUrl } from '@/services/library-server'

import { usesLibraryServer } from '../api/bridge'

/** 树里的电影与集（有视频文件的）。 */
function playableNodes(node: LibraryItemNode): LibraryItemNode[] {
  const own =
    (node.type === 'movie' || node.type === 'episode') &&
    node.files.some(f => f.kind === 'video')
      ? [node]
      : []
  return [...own, ...node.children.flatMap(playableNodes)]
}

/**
 * 要搬进片库的老进度。
 * @param item 作品详情树
 * @param known 片库里已经有进度的条目（不搬）
 */
export function legacyReports(
  item: LibraryItemNode,
  known: (itemId: number) => boolean
): ProgressReport[] {
  const web = usesLibraryServer()
  const out: ProgressReport[] = []
  for (const node of playableNodes(item)) {
    if (known(node.id)) continue
    for (const file of node.files) {
      if (file.kind !== 'video') continue
      const old = readMediaProgress(web ? serverFileUrl(file.id) : file.path)
      if (!old) continue
      out.push({
        itemId: node.id,
        fileId: file.id,
        position: old.progress,
        duration: old.duration,
        ...(old.finished ? { watched: true } : {}),
        ...(old.updatedAt > 0 ? { at: old.updatedAt } : {}),
      })
      break
    }
  }
  return out
}

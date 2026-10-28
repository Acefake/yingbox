import type { LibraryItemNode } from '../../../../../shared/library/ipc'
import {
  type ContinueRecord,
  metaOf,
  openMediaPlayer,
  replayOptions,
} from '@/features/player'
import { serverFileUrl } from '@/services/library-server'

import { libraryBridge, usesLibraryServer } from '../api/bridge'

/** 按文件 ID 更新续播列表，保留集号和观看进度。 */
export function currentLibraryReplay(
  record: ContinueRecord,
  node: LibraryItemNode
): ReturnType<typeof replayOptions> | null {
  const replay = replayOptions(record)
  const files = new Map<
    number,
    { file: LibraryItemNode['files'][number]; itemId: number }
  >()
  const collect = (item: LibraryItemNode): void => {
    for (const file of item.files)
      if (file.kind === 'video') files.set(file.id, { file, itemId: item.id })
    for (const child of item.children) collect(child)
  }
  collect(node)
  const entries = replay.playlist?.length
    ? replay.playlist
    : [{ filePath: replay.filePath, url: replay.url }]
  const playlist = entries.map(entry => {
    const matched = entry.library
      ? files.get(entry.library.fileId)
      : ([...files.values()].find(
          value => value.file.path === entry.filePath
        ) ??
        (entries.length === 1 && files.size === 1
          ? [...files.values()][0]
          : undefined))
    if (!matched) return null
    const { file, itemId } = matched
    const { filePath: _path, url: _url, ...rest } = entry
    return {
      ...rest,
      library: { itemId, fileId: file.id },
      ...(usesLibraryServer()
        ? { url: serverFileUrl(file.id) }
        : { filePath: file.path }),
      video: file.video,
    }
  })
  const index = replay.index ?? 0
  const current = playlist[index]
  if (!current || playlist.some(entry => !entry)) return null
  const { filePath: _path, url: _url, ...rest } = replay
  return {
    ...rest,
    playlist: playlist.filter(entry => entry !== null),
    ...('filePath' in current
      ? { filePath: current.filePath }
      : { url: current.url }),
  }
}

/** 播放前从当前片库获取文件位置，整理或改名后不使用缓存路径。 */
export async function resumeLibrary(
  record: ContinueRecord,
  fromStart: boolean
): Promise<boolean> {
  const bridge = libraryBridge()
  const detailId = (record.detail as { itemId?: unknown } | undefined)?.itemId
  const itemId = Number(detailId ?? record.key)
  if (!bridge || !Number.isSafeInteger(itemId) || itemId <= 0) return false
  const node = await bridge.getItem(itemId).catch(() => null)
  if (!node) return false
  const replay = currentLibraryReplay(record, node)
  if (!replay) return false
  return openMediaPlayer({
    ...replay,
    ...(fromStart ? { startAt: 0 } : {}),
    continueAs: metaOf(record),
  })
}

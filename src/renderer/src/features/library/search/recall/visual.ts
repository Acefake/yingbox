/** CLIP 在本地运行；只使用已就绪的番号索引，不隐式下载或创建索引。 */
import { libraryBridge } from '../../api/bridge'
import { visualRequest } from '../../visual/visual-request'
import type { SearchRecall } from '../types'
export const recallVisual: SearchRecall = async request => {
  const empty = { kind: 'visual' as const, candidates: [] }
  if (request.scope !== 'jav') return empty
  const api = libraryBridge()
  if (!api?.visual) return empty
  const status = await api.visual.status()
  if (request.signal.aborted) return empty
  if (
    !status.runtime ||
    status.model !== 'ready' ||
    (!status.indexed && !status.frames?.frames)
  )
    return {
      ...empty,
      message: '画面索引尚未就绪，可在片库的“按画面搜”中配置。',
    }
  if (request.visualSource === 'image' && !status.indexed)
    return {
      ...empty,
      message: '尚无图片索引，请先在“按画面搜”中建立图片索引。',
    }
  const hits = await visualRequest(
    () => !request.signal.aborted,
    () =>
      api.visual.search({
        text: request.text.slice(0, 100),
        source: request.visualSource ?? 'all',
        limit: 20,
      })
  )
  if (!hits?.length || request.signal.aborted) return empty
  const ids = [...new Set(hits.map(hit => hit.itemId))].filter(
    id => !request.base.ids || request.base.ids.includes(id)
  )
  if (!ids.length || request.signal.aborted) return empty
  const page = await api.query({
    ...request.base,
    ids,
    includeVersions: true,
    limit: ids.length,
  })
  if (request.signal.aborted) return empty
  const items = new Map(page.items.map(item => [item.id, item]))
  return {
    kind: 'visual',
    ...(!status.indexed
      ? { message: '当前仅有视频抽帧索引，尚无图片索引。' }
      : {}),
    candidates: hits.flatMap(visual => {
      const item = items.get(visual.itemId)
      return item
        ? [
            {
              item,
              visual,
              reason: visual.frame
                ? `画面命中 · ${Math.floor(visual.frame.at / 60)}:${String(Math.floor(visual.frame.at % 60)).padStart(2, '0')}`
                : '封面 / 剧照画面匹配',
            },
          ]
        : []
    }),
  }
}

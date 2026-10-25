/** CLIP 在本地运行；只使用已就绪的番号索引，不隐式下载或创建索引。 */
import { libraryBridge } from '../../api/bridge'
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
  const hits = await api.visual.search({ text: request.text, limit: 20 })
  if (!hits.length || request.signal.aborted) return empty
  // 每个时间点按原条目过滤，随后按引擎合并键融合，保留实际文件所属版本。
  const candidates = await Promise.all(
    hits.map(async visual => {
      if (
        request.signal.aborted ||
        (request.base.ids && !request.base.ids.includes(visual.itemId))
      )
        return []
      const page = await api.query({
        ...request.base,
        ids: [visual.itemId],
        limit: 1,
      })
      const item = page.items[0]
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
    })
  )
  return { kind: 'visual', candidates: candidates.flat() }
}

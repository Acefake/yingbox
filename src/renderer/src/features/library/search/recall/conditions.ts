/** 已有条件查询复用同一个 LibraryQuery，不另建搜索索引。 */
import { libraryBridge } from '../../api/bridge'
import type { SearchRecall } from '../types'
export const recallConditions: SearchRecall = async request => {
  if (!request.filter || !Object.keys(request.filter).length)
    return { kind: 'conditions', candidates: [] }
  const page = await libraryBridge()?.query({ ...request.base, limit: 30 })
  return {
    kind: 'conditions',
    candidates: (page?.items ?? []).map(item => ({
      item,
      reason: '符合筛选条件',
    })),
  }
}

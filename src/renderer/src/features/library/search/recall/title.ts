/** 片名召回沿用引擎 FTS 的原名、简繁和大小写匹配。 */
import { libraryBridge } from '../../api/bridge'
import type { SearchRecall } from '../types'
export const recallTitle: SearchRecall = async request => {
  const page = await libraryBridge()?.query({
    ...request.base,
    search: request.base.search ?? request.text,
    limit: 30,
  })
  const normalized = request.text.normalize('NFKC').toLocaleLowerCase()
  return {
    kind: 'title',
    candidates: (page?.items ?? []).map(item => {
      const exact = [item.title, item.originalTitle].some(
        title => title?.normalize('NFKC').toLocaleLowerCase() === normalized
      )
      return { item, exact, reason: exact ? '片名完全匹配' : '片名 / 原名匹配' }
    }),
  }
}

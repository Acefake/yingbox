/** 全局搜索遵守板块锁；全库范围只查询已解锁的电影 / 剧集。 */
import type { LibraryQuery } from '../../../../../shared/library/ipc'
import { isPathLocked } from '@/features/section-lock'
import { scopeQuery } from './search-rules'
import type { SearchScope } from './types'
export function accessibleQuery(scope: SearchScope): LibraryQuery | null {
  const base = scopeQuery(scope)
  const types =
    scope === 'all'
      ? (['movie', 'series'] as const).filter(
          type => !isPathLocked(type === 'movie' ? '/movie' : '/tv')
        )
      : isPathLocked(
            scope === 'jav' ? '/jav' : scope === 'tv' ? '/tv' : '/movie'
          )
        ? []
        : (base.types ?? [])
  return types.length ? { ...base, types: [...types] } : null
}
export const searchAccessKey = (scope: SearchScope): string =>
  JSON.stringify(accessibleQuery(scope))

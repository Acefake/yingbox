import { isSearchCommand } from '@/utils/search-command'
/** 并行召回、逐路发布；任何一路失败不阻塞其他结果，取消后不发布迟到结果。 */
import type { LibraryQuery } from '../../../../../shared/library/ipc'
import { continueRecords } from '@/features/player'
import { libraryBridge } from '../api/bridge'
import { applyNlFilter } from '../nl-search/nl-rules'
import { recallTitle } from './recall/title'
import { recallPeople } from './recall/people'
import { recallConditions } from './recall/conditions'
import { recallVisual } from './recall/visual'
import { routeSearch, ruleFilter } from './search-rules'
import { accessibleQuery, searchAccessKey } from './search-access'
import type {
  RecallBatch,
  RecallKind,
  SearchRecall,
  SearchRequest,
} from './types'

const recalls = [recallTitle, recallPeople, recallConditions, recallVisual]

export async function searchLibrary(
  request: SearchRequest,
  publish: (batch: RecallBatch) => void,
  providers: SearchRecall[] = recalls
): Promise<void> {
  const text = request.text.trim().slice(0, 500)
  if (!text || isSearchCommand(text) || request.signal.aborted) return
  const filter = request.filter ?? ruleFilter(text)
  const scope = request.scope
  const base = accessibleQuery(scope)
  if (!base) {
    publish({
      kind: 'title',
      candidates: [],
      message: '搜索范围已锁定，请先进入板块解锁。',
    })
    return
  }
  const access = searchAccessKey(scope)
  const section =
    scope === 'all' ? (filter.type === 'series' ? 'tv' : 'movie') : scope
  const vocabulary = filter.genres?.length
    ? ((await libraryBridge()
        ?.facets?.list({ field: 'tag', source: base.source, limit: 80 })
        .catch(() => [])) ?? [])
    : []
  if (request.signal.aborted) return
  const filtered: LibraryQuery = applyNlFilter(base, filter, {
    section,
    genres: vocabulary.map(value => value.value),
    watchedIds: continueRecords()
      .value.filter(record =>
        scope === 'all'
          ? ['movie', 'tv'].includes(record.section)
          : record.section === scope
      )
      .map(record => Number(record.key))
      .filter(Number.isFinite),
  })
  if (filter.type && scope === 'all') filtered.types = [filter.type]
  if (filter.type && !base.types?.includes(filter.type)) {
    publish({
      kind: 'conditions',
      candidates: [],
      message: '类别与当前范围不同，请切换搜索范围。',
    })
    return
  }
  const context = {
    ...request,
    text,
    filter,
    base: filtered,
    weights: routeSearch(text),
  }
  await Promise.allSettled(
    providers.map(async (recall, index) => {
      try {
        const batch = await recall(context)
        if (!request.signal.aborted && access === searchAccessKey(scope))
          publish(batch)
      } catch {
        if (!request.signal.aborted)
          publish({
            kind:
              (['title', 'people', 'conditions', 'visual'] as RecallKind[])[
                index
              ] ?? 'title',
            candidates: [],
            message: '部分搜索暂不可用，其他结果仍可使用。',
          })
      }
    })
  )
}

/** 读取可用性，不启动模型。 */
export const searchAvailable = (): boolean => libraryBridge() !== null

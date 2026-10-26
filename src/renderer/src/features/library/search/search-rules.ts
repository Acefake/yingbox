/** 多意图权重、轻量条件解析与加权 RRF；不依赖模型或界面状态。 */
import type {
  LibraryItemSummary,
  LibraryQuery,
} from '../../../../../shared/library/ipc'
import type { NlFilter } from '../nl-search/nl-filter'
import { looksNatural } from '../nl-search/nl-rules'
import type { RecallBatch, RecallKind, SearchHit, SearchScope } from './types'

export function routeSearch(text: string): Record<RecallKind, number> {
  return {
    title: 1,
    people: /主演|导演|演的|拍的/.test(text) ? 1.2 : 0.7,
    conditions: looksNatural(text) ? 1.1 : 0.6,
    visual: /画面|场景|穿着|海边|街道|镜头|颜色/.test(text) ? 1.2 : 0.5,
    ai: 1.1,
  }
}

/** 只解析明确写出的条件；高分只表示评分排序，不猜分数。 */
export function ruleFilter(text: string): NlFilter {
  const filter: NlFilter = {}
  const decade = /(?:^|\D)(\d{2}|\d{4})\s*年代/.exec(text)
  if (decade) {
    const n = Number(decade[1])
    filter.yearFrom = n < 100 ? (n >= 30 ? 1900 : 2000) + n : n
    filter.yearTo = filter.yearFrom + 9
  }
  const rating =
    /(?<![\d.])(10(?:\.0)?|[0-9](?:\.[0-9])?)\s*分(?:以上|及以上|起)/.exec(text)
  if (rating) filter.ratingMin = Number(rating[1])
  const genres = [
    '科幻',
    '动作',
    '喜剧',
    '爱情',
    '恐怖',
    '悬疑',
    '犯罪',
    '动画',
    '纪录',
    '战争',
    '奇幻',
    '惊悚',
    '武侠',
  ]
  if (looksNatural(text)) {
    const found = genres.filter(genre => text.includes(genre))
    if (found.length) filter.genres = found
    if (/高分|评分高/.test(text))
      filter.sort = { field: 'rating', order: 'desc' }
    const country = Object.entries({
      港片: 'HK',
      韩剧: 'KR',
      美剧: 'US',
      日剧: 'JP',
      国产: 'CN',
    }).find(([word]) => text.includes(word))
    if (country) filter.countries = [country[1]]
    if (/电视剧|韩剧|美剧|日剧/.test(text)) filter.type = 'series'
    else if (/电影|港片/.test(text)) filter.type = 'movie'
  }
  return filter
}

export function scopeQuery(scope: SearchScope): LibraryQuery {
  return scope === 'jav'
    ? { source: 'jav', types: ['movie'] }
    : {
        source: 'tmdb',
        ...(scope === 'all'
          ? {}
          : { types: [scope === 'tv' ? 'series' : 'movie'] }),
      }
}

/** 使用引擎合并键，尊重手动拆分；服务未提供键时按条目 id 合并各路召回。 */
export function workKey(item: LibraryItemSummary): string {
  return item.mergeKey
    ? `${item.type}:merge:${item.mergeKey}`
    : `item:${item.id}`
}

export function fuseSearch(
  batches: RecallBatch[],
  weights: Record<RecallKind, number>
): SearchHit[] {
  const works = new Map<string, SearchHit>()
  for (const batch of batches) {
    const seen = new Set<string>()
    let rank = 0
    batch.candidates.forEach(candidate => {
      const key = workKey(candidate.item)
      let hit = works.get(key)
      if (!hit) {
        hit = {
          key,
          item: candidate.item,
          versions: [],
          score: 0,
          exact: false,
          reasons: [],
        }
        works.set(key, hit)
      }
      if (!hit.versions.some(item => item.id === candidate.item.id))
        hit.versions.push(candidate.item)
      if (!seen.has(key)) hit.score += weights[batch.kind] / (60 + ++rank)
      seen.add(key)
      hit.exact ||= candidate.exact === true
      if (!hit.reasons.includes(candidate.reason))
        hit.reasons.push(candidate.reason)
      if (
        candidate.visual &&
        (!hit.visual || candidate.visual.score > hit.visual.score)
      )
        hit.visual = candidate.visual
    })
  }
  return [...works.values()].sort(
    (a, b) =>
      Number(b.exact) - Number(a.exact) ||
      b.score - a.score ||
      a.item.id - b.item.id
  )
}

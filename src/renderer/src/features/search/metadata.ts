import { tmdb } from '@/features/online'
import { normalize } from './rules'
import type { SearchQuery, SearchResource, WorkKind } from './types'

export interface SearchTitle {
  id: string
  title: string
  original: string
  year?: number
  type: WorkKind
}
interface TmdbHit {
  id: number
  media_type: string
  title?: string
  name?: string
  original_title?: string
  original_name?: string
  release_date?: string
  first_air_date?: string
}
/** 仅把精确片名与明确年份对上的元数据用于补查，不用模糊首条结果替换查询。 */
export async function lookupTitles(
  query: SearchQuery,
  signal: AbortSignal
): Promise<SearchTitle[]> {
  const reply = await tmdb<{ results: TmdbHit[] }>('/search/multi', {
    query: query.keyword,
    language: 'zh-CN',
  })
  if (signal.aborted) return []
  return (reply?.results ?? []).flatMap(item => {
    if (item.media_type !== 'movie' && item.media_type !== 'tv') return []
    const title = item.title || item.name || ''
    const original = item.original_title || item.original_name || ''
    const year =
      Number((item.release_date || item.first_air_date || '').slice(0, 4)) ||
      undefined
    if (
      ![title, original].some(
        name => normalize(name) === normalize(query.keyword)
      )
    )
      return []
    if (query.year && year !== query.year) return []
    if (
      (query.season !== undefined || query.episode !== undefined) &&
      item.media_type !== 'tv'
    )
      return []
    return [
      {
        id: String(item.id),
        title,
        original,
        year,
        type:
          item.media_type === 'tv' ? ('series' as const) : ('movie' as const),
      },
    ]
  })
}

export function enrichResource(
  resource: SearchResource,
  titles: SearchTitle[]
): SearchResource {
  if (resource.local?.mergeKey === null) return resource
  const hits = titles.filter(title =>
    resource.tmdbId
      ? resource.tmdbId === title.id && resource.type === title.type
      : resource.year === title.year &&
        Boolean(resource.year) &&
        (!resource.type || resource.type === title.type) &&
        [title.title, title.original].some(
          name => normalize(name) === normalize(resource.workTitle)
        )
  )
  if (hits.length !== 1) return resource
  const hit = hits[0]
  return {
    ...resource,
    tmdbId: hit.id,
    type: hit.type,
    aliases: [
      ...new Set(
        [...(resource.aliases ?? []), hit.title, hit.original].filter(Boolean)
      ),
    ],
  }
}

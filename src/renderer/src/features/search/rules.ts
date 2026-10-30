import { parseSearchIntent } from '../../../../shared/netdisk/search-intent'
import {
  episodeHint,
  seasonOfTitle,
} from '../../../../shared/netdisk/episode-hint'
import { parseReleaseQuality } from '../../../../shared/release/quality'
import type { SearchQuery, SearchResource, SearchWork } from './types'

export const normalize = (text: string): string =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')

export function parseQuery(text: string): SearchQuery {
  const intent = parseSearchIntent(text.slice(0, 500))
  const year = /(?:^|[\s(（[【])((?:19|20)\d{2})(?=$|[\s)）\]】])/.exec(
    text.slice(0, 500)
  )
  const resolution = parseReleaseQuality(text).resolution ?? undefined
  const keyword = intent.query
    .replace(/(?:^|[\s(（[【])(?:19|20)\d{2}(?=$|[\s)）\]】])/g, ' ')
    .replace(/\b(?:2160p|1080p|720p|4k|8k)\b/gi, ' ')
    .replace(/[()（）[\]【】]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return {
    text: text.trim(),
    keyword: keyword || intent.query,
    year: keyword && year ? Number(year[1]) : undefined,
    season: intent.season,
    episode: intent.episode,
    resolution,
  }
}

export function resourceMatch(
  resource: SearchResource,
  query: SearchQuery
): { possible: boolean; score: number } {
  const q = normalize(query.keyword)
  const names = [resource.workTitle, ...(resource.aliases ?? [])].map(normalize)
  let score = names.includes(q)
    ? 100
    : resource.interpreted
      ? 80
      : names.some(name => name.includes(q))
        ? 60
        : 10
  let possible = score === 10
  if (query.year) {
    if (resource.year === query.year) score += 15
    else possible = true
  }
  if (query.season !== undefined || query.episode !== undefined) {
    if (query.episode !== undefined) {
      const hint = episodeHint(resource.title, {
        season: query.season,
        episode: query.episode,
      })
      if (hint === 'exact' || hint === 'covers')
        score += hint === 'exact' ? 20 : 15
      else possible = true
    } else if (seasonOfTitle(resource.title) === query.season) score += 15
    else possible = true
  }
  if (
    query.resolution &&
    parseReleaseQuality(resource.title).resolution !== query.resolution
  )
    possible = true
  if (resource.kind === 'local') score += 5
  return { possible, score }
}

/** 缺少年份或类型时保持独立；已知 ID 冲突与手动拆分的片库条目不合并。 */
export function groupResources(
  resources: SearchResource[],
  query: SearchQuery
): SearchWork[] {
  const unique = new Map<string, SearchResource>()
  for (const resource of resources) {
    const previous = unique.get(resource.key)
    unique.set(
      resource.key,
      previous
        ? {
            ...previous,
            sources: [...new Set([...previous.sources, ...resource.sources])],
          }
        : { ...resource }
    )
  }
  const items = [...unique.values()]
  for (const resource of items) {
    if (resource.type || !resource.year) continue
    const matches = items.filter(
      other =>
        other.type &&
        other.year === resource.year &&
        [other.workTitle, ...(other.aliases ?? [])].some(
          name => normalize(name) === normalize(resource.workTitle)
        )
    )
    const kinds = new Set(matches.map(other => other.type))
    if (kinds.size === 1) resource.type = matches[0].type
  }
  const works: SearchWork[] = []
  for (const resource of items) {
    const match = resourceMatch(resource, query)
    const group = works.find(work => {
      if (
        resource.local?.mergeKey === null ||
        work.resources.some(other => other.local?.mergeKey === null)
      )
        return false
      if (!resource.type || work.type !== resource.type) return false
      if (
        resource.tmdbId &&
        work.resources.some(
          other => other.tmdbId && other.tmdbId !== resource.tmdbId
        )
      )
        return false
      return work.resources.some(other => {
        if (resource.tmdbId && other.tmdbId)
          return resource.tmdbId === other.tmdbId
        const names = [other.workTitle, ...(other.aliases ?? [])].map(normalize)
        return Boolean(
          resource.year &&
          resource.year === other.year &&
          [resource.workTitle, ...(resource.aliases ?? [])].some(name =>
            names.includes(normalize(name))
          )
        )
      })
    })
    if (group) {
      group.resources.push(resource)
      group.possible &&= match.possible
      group.score = Math.max(group.score, match.score)
      group.image ||= resource.image
    } else
      works.push({
        key: resource.key,
        title: resource.workTitle,
        year: resource.year,
        type: resource.type,
        image: resource.image,
        resources: [resource],
        ...match,
      })
  }
  return works.sort(
    (a, b) =>
      Number(a.possible) - Number(b.possible) ||
      b.score - a.score ||
      a.key.localeCompare(b.key)
  )
}

export function searchAliases(
  resources: SearchResource[],
  original: string
): string[] {
  const names = new Map<string, string>()
  for (const resource of resources) {
    if (!resource.tmdbId) continue
    for (const name of [resource.workTitle, ...(resource.aliases ?? [])]) {
      const key = normalize(name)
      if (key && key !== normalize(original)) names.set(key, name)
    }
  }
  return [...names.values()].slice(0, 2)
}

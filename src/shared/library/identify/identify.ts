/**
 * 识别链：把一个解析过的媒体文件对应到元数据源里的条目。
 *
 * 按可信度依次尝试，命中即停：
 *   用户锁定 > NFO 里的 tmdb/imdb/tvdb > 文件名 / 文件夹名里的 ID > 文件哈希 > 标题搜索打分。
 * 前四步是确定性匹配；最后一步按打分阈值给出自动匹配、待确认（前 N 个）或未匹配。
 */
import type { ExternalIds, ParsedMedia } from '../parser'
import type {
  Candidate,
  MediaKind,
  MediaRef,
  MetadataProvider,
} from '../provider'
import {
  DEFAULT_SCORING_OPTIONS,
  type MatchQuery,
  type ScoredCandidate,
  type ScoringOptions,
  decide,
  rankCandidates,
} from '../scoring'
import type { NfoInfo } from './nfo'

/** 按文件哈希查条目的服务（如 OpenSubtitles）；本 PR 只定义接口。返回作品级引用（电影 / 整部剧）。 */
export interface HashLookup {
  lookup(hash: string, size: number): Promise<MediaRef | null>
}

/** 识别一个文件需要的输入。 */
export interface IdentifyInput {
  parsed: ParsedMedia
  /** 用户手动锁定的匹配。 */
  locked?: MediaRef
  /** 电影用同名 / movie.nfo，剧集用 tvshow.nfo；单集 NFO 的 ID 指向单集，不用于识别剧。 */
  nfo?: NfoInfo
  /** OpenSubtitles moviehash 与文件大小。 */
  fileHash?: { hash: string; size: number }
  /** 探测到的电影时长（分钟）。 */
  runtimeMinutes?: number
}

/** 识别依赖。 */
export interface IdentifyDeps {
  provider: MetadataProvider
  hashLookup?: HashLookup
}

/** 确定性匹配的来源。 */
export type IdentifySource = 'lock' | 'nfo' | 'filename-id' | 'hash' | 'search'

/** 识别结果。 */
export type IdentifyResult =
  | {
      status: 'matched'
      source: IdentifySource
      ref: MediaRef
      /** 来自搜索打分时附带分数明细。 */
      scored?: ScoredCandidate
    }
  | { status: 'review'; candidates: ScoredCandidate[] }
  | { status: 'unmatched'; candidates: ScoredCandidate[] }
  | { status: 'skipped'; reason: 'extra' }

/** 剧集单集识别的是整部剧。 */
const kindOf = (parsed: ParsedMedia): MediaKind =>
  parsed.type === 'episode' ? 'tv' : 'movie'

/** 用外部 ID 确定条目：tmdb 直接取详情，imdb / tvdb 反查后按类型过滤。 */
async function resolveIds(
  ids: ExternalIds,
  kind: MediaKind,
  provider: MetadataProvider
): Promise<Candidate | null> {
  if (ids.tmdb) {
    const hit = await provider.details(kind, ids.tmdb)
    if (hit) return hit
  }
  for (const source of ['imdb', 'tvdb'] as const) {
    const id = ids[source]
    if (!id) continue
    const hit = (await provider.find(source, id)).find(c => c.ref.kind === kind)
    if (hit) return hit
  }
  return null
}

/** 解析结果 → 打分查询。 */
function toQuery(
  parsed: Exclude<ParsedMedia, { type: 'extra' }>,
  runtimeMinutes?: number
): MatchQuery {
  const titles = [parsed.title, parsed.altTitle].filter((t): t is string =>
    Boolean(t)
  )
  if (parsed.type === 'movie') {
    return { kind: 'movie', titles, year: parsed.year, runtimeMinutes }
  }
  return {
    kind: 'tv',
    titles,
    year: parsed.year,
    season: parsed.season,
    episodes: parsed.episodes,
    absolute: parsed.absolute,
  }
}

/** 用每个标题搜索并按条目去重；带年份搜不到时去掉年份再搜一次。 */
async function searchAll(
  query: MatchQuery,
  provider: MetadataProvider
): Promise<Candidate[]> {
  const byKey = new Map<string, Candidate>()
  const run = async (year?: number): Promise<void> => {
    for (const title of query.titles) {
      for (const c of await provider.search({
        kind: query.kind,
        title,
        year,
      })) {
        byKey.set(`${c.ref.kind}:${c.ref.id}`, c)
      }
    }
  }
  await run(query.year)
  if (!byKey.size && query.year !== undefined) await run(undefined)
  return [...byKey.values()]
}

/**
 * 识别一个媒体文件。
 *
 * 元数据源的网络错误原样抛出，由调用方（P2 引擎）决定重试或稍后再识别。
 */
export async function identify(
  input: IdentifyInput,
  deps: IdentifyDeps,
  options: ScoringOptions = DEFAULT_SCORING_OPTIONS
): Promise<IdentifyResult> {
  const { parsed } = input
  if (parsed.type === 'extra') return { status: 'skipped', reason: 'extra' }
  const kind = kindOf(parsed)

  if (input.locked) {
    return { status: 'matched', source: 'lock', ref: input.locked }
  }

  const nfoIds =
    input.nfo && input.nfo.kind !== 'episodedetails' ? input.nfo.ids : undefined
  if (nfoIds) {
    const hit = await resolveIds(nfoIds, kind, deps.provider)
    if (hit) return { status: 'matched', source: 'nfo', ref: hit.ref }
  }

  if (parsed.ids) {
    const hit = await resolveIds(parsed.ids, kind, deps.provider)
    if (hit) return { status: 'matched', source: 'filename-id', ref: hit.ref }
  }

  if (input.fileHash && deps.hashLookup) {
    const ref = await deps.hashLookup.lookup(
      input.fileHash.hash,
      input.fileHash.size
    )
    if (ref) return { status: 'matched', source: 'hash', ref }
  }

  const query = toQuery(parsed, input.runtimeMinutes)
  if (!query.titles.length) return { status: 'unmatched', candidates: [] }
  const ranked = rankCandidates(
    query,
    await searchAll(query, deps.provider),
    options
  )
  const decision = decide(ranked, options)
  if (decision.status === 'auto') {
    return {
      status: 'matched',
      source: 'search',
      ref: decision.best.candidate.ref,
      scored: decision.best,
    }
  }
  return decision
}

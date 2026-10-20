/**
 * 识别链：把一个解析过的媒体文件（或一部剧）对应到元数据源里的条目。
 *
 * 按可信度依次尝试，命中即停：
 *   用户锁定 > NFO 里的 tmdb/imdb/tvdb > 文件名 / 文件夹名里的 ID > 文件哈希 > 标题搜索打分。
 * 前四步是确定性匹配；最后一步按打分阈值给出自动匹配、待确认（前 N 个）或未匹配。
 *
 * 两个不同条目都过自动阈值且几乎同分时（没写年份的同名翻拍）判为待确认，不按热度硬选。
 *
 * 搜索打分分三档，够自信就提前停，尽量少发请求：
 *   1. 各标题 + 年份搜索；
 *   2. 不带年份再搜，并把“标题 + 年份”整体当标题搜（修 “Reply 1988 S01E05” 被解析成
 *      片名 Reply、年份 1988 的歧义）；拉丁文标题再用第二语言搜一次，补齐英文译名；
 *   3. 精排：给前几名取详情（全部别名 / 译名、电影时长、剧集各季集数）重新打分，
 *      详情同时是入库元数据的来源，命中缓存后不额外花请求。
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
  compareScored,
  decide,
  normalizeTitle,
  rankCandidates,
} from '../scoring'
import type { NfoInfo } from './nfo'

/** 按文件哈希查条目的服务（如 OpenSubtitles）。返回作品级引用（电影 / 整部剧）。 */
export interface HashLookup {
  lookup(
    hash: string,
    size: number,
    signal?: AbortSignal
  ): Promise<MediaRef | null>
}

/** 剧集的本地集信息（整部剧层面识别时用来校验季 / 集）。 */
export interface LocalEpisodes {
  season?: number
  episodes: number[]
  absolute?: boolean
}

/** 识别一个文件（或一部剧）需要的输入。 */
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
  /** 额外的查询标题（如剧集文件夹名、其他集文件名里的剧名写法）。 */
  extraTitles?: string[]
  /** 剧集：覆盖 parsed 里单集的季 / 集，用整部剧的本地集做校验。 */
  episodes?: LocalEpisodes
}

/** 识别依赖。 */
export interface IdentifyDeps {
  provider: MetadataProvider
  hashLookup?: HashLookup
  /** 第二搜索语言（如 en-US）；缺省不做第二语言搜索。 */
  secondaryLanguage?: string
  signal?: AbortSignal
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

/** 不自信时精排取详情的候选数。 */
export const DETAIL_TOP_N = 3
/** 第一名领先第二名不足这么多时视为不自信，继续往下搜。 */
const CONFIDENT_MARGIN = 0.05

/** 剧集单集识别的是整部剧。 */
const kindOf = (parsed: ParsedMedia): MediaKind =>
  parsed.type === 'episode' ? 'tv' : 'movie'

const keyOf = (c: Candidate): string => `${c.ref.kind}:${c.ref.id}`
const LATIN_RE = /[a-z]/i

/** 用外部 ID 确定条目：tmdb 直接取详情，imdb / tvdb 反查后按类型过滤。 */
async function resolveIds(
  ids: ExternalIds,
  kind: MediaKind,
  deps: IdentifyDeps
): Promise<Candidate | null> {
  const { provider, signal } = deps
  if (ids.tmdb) {
    const hit = await provider.details(kind, ids.tmdb, signal)
    if (hit) return hit
  }
  for (const source of ['imdb', 'tvdb'] as const) {
    const id = ids[source]
    if (!id) continue
    const hit = (await provider.find(source, id, signal)).find(
      c => c.ref.kind === kind
    )
    if (hit) return hit
  }
  return null
}

/** 按归一化结果去重，保留第一次出现的写法。 */
function uniqueTitles(titles: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of titles) {
    const norm = t ? normalizeTitle(t) : ''
    if (!norm || seen.has(norm)) continue
    seen.add(norm)
    out.push(t!)
  }
  return out
}

/** 解析结果 → 打分查询。 */
function toQuery(
  parsed: Exclude<ParsedMedia, { type: 'extra' }>,
  input: IdentifyInput
): MatchQuery {
  const titles = uniqueTitles([
    parsed.title,
    parsed.altTitle,
    ...(input.extraTitles ?? []),
  ])
  if (parsed.type === 'movie') {
    return {
      kind: 'movie',
      titles,
      year: parsed.year,
      runtimeMinutes: input.runtimeMinutes,
    }
  }
  const eps = input.episodes ?? {
    season: parsed.season,
    episodes: parsed.episodes,
    absolute: parsed.absolute,
  }
  return {
    kind: 'tv',
    titles,
    year: parsed.year,
    season: eps.season,
    episodes: eps.episodes,
    absolute: eps.absolute,
  }
}

/** 合并同一条目的两份候选：后到的信息覆盖，标题类字段取并集。 */
function mergeCandidate(a: Candidate, b: Candidate): Candidate {
  const titles = new Set([
    ...(a.alternativeTitles ?? []),
    ...(b.alternativeTitles ?? []),
    // 第二语言搜索结果的主标题当作别名保留
    ...(a.title !== b.title ? [a.title] : []),
  ])
  return {
    ...a,
    ...b,
    alternativeTitles: [...titles],
    translations: [
      ...new Set([...(a.translations ?? []), ...(b.translations ?? [])]),
    ],
  }
}

/**
 * 排序，并考虑“年份其实是片名一部分”：对每个候选，若把年份并进标题后标题相似度更高，
 * 就改用“标题含年份、不比年份”的分数。这样 “Reply 1988”（2015 年首播）不会因年份不符被压低，
 * 而 “Heat 1995” 这类真正带年份的文件仍按年份区分同名片。
 */
function rank(
  query: MatchQuery,
  yearTitle: string | undefined,
  candidates: Candidate[],
  options: ScoringOptions
): ScoredCandidate[] {
  const base = rankCandidates(query, candidates, options)
  if (!yearTitle) return base
  const alt = new Map(
    rankCandidates(
      { ...query, titles: [...query.titles, yearTitle], year: undefined },
      candidates,
      options
    ).map(s => [keyOf(s.candidate), s])
  )
  return base
    .map(s => {
      const other = alt.get(keyOf(s.candidate))!
      return other.breakdown.title > s.breakdown.title + 1e-9 ? other : s
    })
    .sort(compareScored)
}

/** 第一名够自信：过自动阈值且领先第二名足够多。 */
function confident(
  ranked: ScoredCandidate[],
  options: ScoringOptions
): boolean {
  const [best, second] = ranked
  if (!best || best.score < options.autoThreshold) return false
  return !second || best.score - second.score >= CONFIDENT_MARGIN
}

/** 第一、二名都过自动阈值且分差小于 CONFIDENT_MARGIN：无法区分。 */
function ambiguous(
  ranked: ScoredCandidate[],
  options: ScoringOptions
): boolean {
  const [best, second] = ranked
  return (
    !!second &&
    second.score >= options.autoThreshold &&
    best.score - second.score < CONFIDENT_MARGIN
  )
}

/** 分档搜索 + 精排，返回排好序的候选。 */
async function searchAndRank(
  query: MatchQuery,
  deps: IdentifyDeps,
  options: ScoringOptions
): Promise<ScoredCandidate[]> {
  const { provider, signal } = deps
  const pool = new Map<string, Candidate>()
  const add = (list: Candidate[]): void => {
    for (const c of list) {
      const existing = pool.get(keyOf(c))
      pool.set(keyOf(c), existing ? mergeCandidate(existing, c) : c)
    }
  }
  const search = async (
    title: string,
    year?: number,
    language?: string
  ): Promise<void> =>
    add(
      await provider.search({ kind: query.kind, title, year, language }, signal)
    )
  const yearTitle =
    query.year !== undefined ? `${query.titles[0]} ${query.year}` : undefined
  const ranked = (): ScoredCandidate[] =>
    rank(query, yearTitle, [...pool.values()], options)

  // 1) 标题 + 年份
  if (query.year !== undefined) {
    for (const title of query.titles) await search(title, query.year)
  }
  let result = ranked()

  // 2) 不带年份；年份并进标题
  if (!confident(result, options)) {
    for (const title of query.titles) await search(title)
    if (yearTitle) await search(yearTitle)
    result = ranked()
  }
  // 2b) 拉丁文标题用第二语言再搜，补齐英文译名
  if (!confident(result, options) && deps.secondaryLanguage) {
    for (const title of query.titles.filter(t => LATIN_RE.test(t))) {
      await search(title, undefined, deps.secondaryLanguage)
    }
    result = ranked()
  }

  // 3) 精排：取详情重新打分。自信时只取第一名（入库也要用），否则取前几名
  const top = result.slice(0, confident(result, options) ? 1 : DETAIL_TOP_N)
  const details = await Promise.all(
    top.map(s =>
      provider.details(s.candidate.ref.kind, s.candidate.ref.id, signal)
    )
  )
  for (const d of details) if (d) add([d])
  return details.some(Boolean) ? ranked() : result
}

/**
 * 识别一个媒体文件（剧集传整部剧的代表集 + episodes）。
 *
 * 元数据源的网络错误原样抛出，由调用方（引擎任务）决定重试或稍后再识别。
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
    const hit = await resolveIds(nfoIds, kind, deps)
    if (hit) return { status: 'matched', source: 'nfo', ref: hit.ref }
  }

  if (parsed.ids) {
    const hit = await resolveIds(parsed.ids, kind, deps)
    if (hit) return { status: 'matched', source: 'filename-id', ref: hit.ref }
  }

  if (input.fileHash && deps.hashLookup) {
    const ref = await deps.hashLookup.lookup(
      input.fileHash.hash,
      input.fileHash.size,
      deps.signal
    )
    if (ref && ref.kind === kind) {
      return { status: 'matched', source: 'hash', ref }
    }
  }

  const query = toQuery(parsed, input)
  if (!query.titles.length) return { status: 'unmatched', candidates: [] }
  const ranked = await searchAndRank(query, deps, options)
  const decision = decide(ranked, options)
  if (decision.status === 'auto' && ambiguous(ranked, options)) {
    // 两个不同条目都过了自动阈值且几乎同分（如没写年份的同名翻拍）：宁可待确认，不靠热度猜
    return {
      status: 'review',
      candidates: ranked.slice(0, options.reviewLimit),
    }
  }
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

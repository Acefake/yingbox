/**
 * 自然语言搜索的「按片名判断」兜底：本库类型信息不全时类型条件查不出东西，
 * 这时把候选的片名 + 年份交给模型，让它凭自己的知识挑出符合描述的条目，再按 id 查询。
 *
 * - 触发：条件里有类型，且按类型筛选结果为 0，或本分区有类型的条目不到 30%；
 * - 候选：去掉类型 / 地区条件、保留其余条件后的前 300 条（地区同样多来自刮削，一并交给模型判断）；
 * - 生效：只在当前条件的类型与当时一致时替换类型 / 地区条件（删掉类型胶囊就回到普通筛选）。
 *
 * 纯规则 + 一个注入依赖的流程函数，不依赖 Vue / IPC，便于测试；调用在 use-nl-search.ts。
 */
import type {
  LibraryItemSummary,
  LibraryQuery,
  LibraryQueryResult,
} from '../../../../../shared/library/ipc'
import type { AiMessage } from '@/features/ai'

import type { NlFilter } from './nl-filter'

/** 最多交给模型多少条候选。 */
export const TITLE_PICK_LIMIT = 300
/** 本分区有类型的条目低于这个比例时，不信任类型筛选。 */
export const MIN_GENRE_COVERAGE = 0.3

/** 按片名判断的结果：针对哪组类型，挑中了哪些条目。 */
export interface TitlePick {
  genres: string[]
  ids: number[]
}

/** 交给模型的候选（字段名缩写，省 token）。 */
export interface TitleCandidate {
  id: number
  t: string
  o?: string
  y?: number
}

/** 判断要不要兜底用到的计数。 */
export interface GenreStats {
  /** 按类型筛选的结果数 */
  matched: number
  /** 本分区条目数 / 其中有类型的条目数 */
  total: number
  withGenres: number
}

/** 模型输出的 JSON Schema。 */
export const TITLE_PICK_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['ids'],
  properties: { ids: { type: 'array', items: { type: 'integer' } } },
}

/** 结果是否适用于当前条件（类型集合相同）。 */
export function titlePickApplies(
  pick: TitlePick | null | undefined,
  filter: NlFilter
): pick is TitlePick {
  const genres = filter.genres ?? []
  if (!pick || !genres.length || genres.length !== pick.genres.length)
    return false
  const set = new Set(pick.genres)
  return genres.every(g => set.has(g))
}

/** 去掉类型 / 地区后的条件（取候选用）。 */
export function looseFilter(filter: NlFilter): NlFilter {
  const { genres: _genres, countries: _countries, ...rest } = filter
  return rest
}

/** 类型筛选查不出东西，或本分区有类型的条目太少时兜底；分区是空的不兜底。 */
export function needsTitlePick(stats: GenreStats): boolean {
  if (stats.total <= 0) return false
  return (
    stats.matched === 0 || stats.withGenres / stats.total < MIN_GENRE_COVERAGE
  )
}

/** 海报墙条目 → 候选：片名、与片名不同的原名、年份。 */
export function titleCandidates(
  items: readonly LibraryItemSummary[]
): TitleCandidate[] {
  return items.slice(0, TITLE_PICK_LIMIT).map(item => ({
    id: item.id,
    t: item.title,
    ...(item.originalTitle && item.originalTitle !== item.title
      ? { o: item.originalTitle }
      : {}),
    ...(item.year ? { y: item.year } : {}),
  }))
}

/** 发给模型的消息。 */
export function titlePickMessages(
  question: string,
  candidates: readonly TitleCandidate[]
): AiMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你帮用户在自己的片库里按一句描述挑片。片库缺少类型信息，只有片名（t，原名 o）和年份（y）。',
        '凭你对这些影片 / 剧集的了解，判断哪些符合描述（类型、题材、地区、风格等）。',
        '只能从候选里选，拿不准的不要选；一部都不符合就返回空数组。',
        '只输出 JSON：{"ids":[候选id, ...]}',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `描述：${question}\n候选（JSON）：\n${JSON.stringify(candidates)}`,
    },
  ]
}

/** 模型输出 → 条目 id：必须在候选里，去重，保持模型给的顺序。 */
export function sanitizePickedIds(
  raw: unknown,
  candidates: readonly TitleCandidate[]
): number[] {
  const ids = (raw as { ids?: unknown } | null)?.ids
  if (!Array.isArray(ids)) return []
  const known = new Set(candidates.map(c => c.id))
  const out = new Set<number>()
  for (const value of ids) {
    const id = typeof value === 'string' ? Number(value) : value
    if (typeof id === 'number' && known.has(id)) out.add(id)
  }
  return [...out]
}

/** 流程需要的能力：查海报墙、调模型（返回解析后的 JSON）。 */
export interface TitlePickDeps {
  query: (query: LibraryQuery) => Promise<LibraryQueryResult>
  chat: (messages: AiMessage[]) => Promise<unknown>
}

/** 三条查询：按类型筛选的结果、本分区（不带片名搜索）、候选范围。 */
export interface TitlePickQueries {
  strict: LibraryQuery
  section: LibraryQuery
  loose: LibraryQuery
}

/**
 * 需要时按片名判断：先数一下（只取 1 条），够用就返回 null；否则取候选交给模型。
 * 候选为空返回 null。查询 / 模型出错照常抛出，由调用方保留类型筛选。
 */
export async function resolveTitlePick(
  question: string,
  filter: NlFilter,
  queries: TitlePickQueries,
  deps: TitlePickDeps
): Promise<TitlePick | null> {
  const genres = filter.genres ?? []
  if (!genres.length) return null
  const one = { offset: 0, limit: 1 }
  const [matched, total, withGenres] = await Promise.all([
    deps.query({ ...queries.strict, ...one }),
    deps.query({ ...queries.section, ...one }),
    deps.query({ ...queries.section, ...one, hasGenres: true }),
  ])
  const stats = {
    matched: matched.total,
    total: total.total,
    withGenres: withGenres.total,
  }
  if (!needsTitlePick(stats)) return null
  const list = await deps.query({
    ...queries.loose,
    offset: 0,
    limit: TITLE_PICK_LIMIT,
  })
  const candidates = titleCandidates(list.items)
  if (!candidates.length) return null
  const data = await deps.chat(titlePickMessages(question, candidates))
  return { genres: [...genres], ids: sanitizePickedIds(data, candidates) }
}

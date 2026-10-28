/**
 * 演员库的纯规则：名字归一 / 检索文本、条目演员表 → 名字、来源裁剪与聚合顺序、缓存键与时长、
 * 「本次结果 + 库内旧值 + 锁定字段」的合并、查询结论。不碰数据库与网络，单测直接调用。
 *
 * 合并规则：本次查到的值优先，本次没查到的字段保留库里原来的值（不会因为
 * 某个来源这次被拦就把资料清空），锁定字段始终保留库内值与来源；别名取并集。
 */
import type {
  ActorDetail,
  ActorField,
  ActorGender,
  ActorProfileState,
  ActorProfileValues,
  ActorSettings,
  ActorSourceId,
  ItemMetadata,
} from '../../../shared/library/ipc'
import { normalizeTitle } from '../../../shared/library/scoring'
import {
  type ActorLookup,
  type ActorMergeOrder,
  type ActorSource,
  type AggregatedActor,
  sourcesForGender,
} from '../providers/jav/actors'
import { normalizeName, uniqueNames } from '../providers/jav/actors/names'

const DAY = 86_400_000
/** 单个来源结果的缓存时长：查到 7 天，查无此人 1 天；出错不缓存。 */
export const ACTOR_TTL = { found: 7 * DAY, missing: DAY } as const
/** 上次全部来源都失败的演员，隔多久再自动重查。 */
export const ACTOR_RETRY_MS = DAY

/** 库里的一位演员（详情去掉作品数）。 */
export type ActorRecord = Omit<ActorDetail, 'workCount'>

/** 名字身份键：NFKC + 压缩空白 + 小写；同键即同一人。 */
export function actorNameKey(name: string): string {
  return normalizeName(name).toLowerCase()
}

/** 检索文本：名字 + 别名，归一化（繁简、大小写、标点）后去重。 */
export function actorSearchText(name: string, aliases: string[]): string {
  return [
    ...new Set([name, ...aliases].map(normalizeTitle).filter(Boolean)),
  ].join(' ')
}

/** 某来源某名字的缓存键。 */
export const actorCacheKey = (source: ActorSourceId, name: string): string =>
  `actor:${source}:${normalizeName(name)}`

/** 条目元数据里的演员名（番号库的 cast），按演员表顺序、同名去重。 */
export function castNames(meta: ItemMetadata | null): string[] {
  if (!meta || meta.level !== 'title') return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const person of meta.cast) {
    const name = normalizeName(person.name)
    const key = actorNameKey(name)
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/**
 * 按设置挑来源：开启的、按设置顺序，再按性别裁剪。番号站点列出的演员几乎都是女优，
 * 性别未知时按女优查（否则只收女优的 gfriends / minnano 永远用不上）。
 */
export function pickSources(
  all: readonly ActorSource[],
  settings: ActorSettings,
  gender: ActorGender | null
): ActorSource[] {
  const byId = new Map(all.map(s => [s.id, s]))
  const enabled = settings.sources
    .filter(s => s.enabled)
    .map(s => byId.get(s.id))
    .filter((s): s is ActorSource => Boolean(s))
  return sourcesForGender(enabled, gender ?? 'female')
}

/** 聚合顺序：头像来源（只给头像的）在前，资料来源按设置顺序。 */
export function mergeOrder(sources: readonly ActorSource[]): ActorMergeOrder {
  return {
    image: sources.filter(s => s.capability === 'image').map(s => s.id),
    profile: sources.filter(s => s.capability === 'profile').map(s => s.id),
  }
}

/** 一次查询的结论：命中为 found；没命中且有来源出错为 error（下次再查）；否则 missing。 */
export function lookupState(lookup: ActorLookup): ActorProfileState {
  if (lookup.actor) return 'found'
  return lookup.failures.length ? 'error' : 'missing'
}

/** 标量字段（别名、头像之外）。 */
const SCALARS = [
  'gender',
  'birthday',
  'birthplace',
  'height',
  'bust',
  'waist',
  'hip',
  'cup',
  'overview',
] as const satisfies readonly ActorField[]

/** 合并后要写回的资料。 */
export interface MergedProfile {
  values: ActorProfileValues
  tagline: string | null
  ids: Record<string, string>
  urls: ActorRecord['urls']
  fieldSources: ActorRecord['fieldSources']
}

/**
 * 本次结果与库内旧值合并：
 * - 未锁定字段：本次有值取本次（来源记本次的），本次没有保留旧值与旧来源；
 * - 锁定字段：保留旧值与旧来源；
 * - 别名：未锁定时旧别名 ∪ 本次别名（去掉与名字同写法的），锁定时保留旧值；
 * - 头像：未锁定时本次头像在前、旧头像补后（去重），锁定时保留旧值；
 * - id / 资料页：旧值 ∪ 本次（本次覆盖同键）。
 */
export function mergeProfile(
  current: ActorRecord,
  found: AggregatedActor | null
): MergedProfile {
  const locked = new Set(current.lockedFields)
  const values: ActorProfileValues = {
    aliases: current.aliases,
    gender: current.gender,
    birthday: current.birthday,
    birthplace: current.birthplace,
    height: current.height,
    bust: current.bust,
    waist: current.waist,
    hip: current.hip,
    cup: current.cup,
    overview: current.overview,
    images: current.images,
  }
  const fieldSources = { ...current.fieldSources }
  const out: MergedProfile = {
    values,
    tagline: current.tagline,
    ids: { ...current.ids },
    urls: { ...current.urls },
    fieldSources,
  }
  if (!found) return out
  for (const field of SCALARS) {
    const value = found[field]
    const source = found.fieldSources[field]
    if (locked.has(field) || value === undefined || value === '') continue
    ;(values as unknown as Record<string, unknown>)[field] = value
    if (source) fieldSources[field] = source
  }
  if (found.tagline) {
    out.tagline = found.tagline
    if (found.fieldSources.tagline)
      fieldSources.tagline = found.fieldSources.tagline
  }
  if (!locked.has('aliases'))
    values.aliases = uniqueNames(
      [...current.aliases, ...found.aliases],
      current.name
    )
  if (!locked.has('images') && found.images.length) {
    values.images = [...new Set([...found.images, ...current.images])]
    if (found.fieldSources.images)
      fieldSources.images = found.fieldSources.images
  }
  Object.assign(out.ids, found.ids)
  Object.assign(out.urls, found.urls)
  return out
}

/**
 * 手动编辑：values 里的字段写入并把来源记为 user；锁定集合整体替换。
 * 返回新值与来源（调用方写库）。
 */
export function applyEdit(
  current: ActorRecord,
  edit: Partial<ActorProfileValues>
): Pick<MergedProfile, 'values' | 'fieldSources'> {
  const values: ActorProfileValues = {
    aliases: current.aliases,
    gender: current.gender,
    birthday: current.birthday,
    birthplace: current.birthplace,
    height: current.height,
    bust: current.bust,
    waist: current.waist,
    hip: current.hip,
    cup: current.cup,
    overview: current.overview,
    images: current.images,
    ...edit,
  }
  if (edit.aliases) values.aliases = uniqueNames(edit.aliases, current.name)
  const fieldSources = { ...current.fieldSources }
  for (const key of Object.keys(edit) as ActorField[])
    fieldSources[key] = 'user'
  return { values, fieldSources }
}

/**
 * ThePornDB 演员（stash-box GraphQL：theporndb.net/graphql）：需要 API token，没配置就不发请求。
 *
 * searchPerformer 模糊检索后，只接受规范名或别名与查找名相同的条目（不回退首条）；
 * 已删除条目跟随 merged_into_id（最多 4 跳，成环或无目标算查无此人）。
 * 头像按宽×高从大到小；urls 里认得的外站写进 ids；disambiguation 作 tagline。
 * 只查较老 stash-box 也有的字段（measurements 嵌套写法），避免旧版本拒绝查询。
 * 需要上下文提供 postJson（GraphQL 走 POST）。
 * 行为参考 Amane 的 theporndb 演员爬虫，代码独立实现。
 */
import { hasName, normalizeName, positiveInt, uniqueNames } from '../names'
import type {
  ActorContext,
  ActorGender,
  ActorProfile,
  ActorSource,
} from '../types'

export const THEPORNDB_GRAPHQL = 'https://theporndb.net/graphql'

type Obj = Record<string, unknown>

const FIELDS = `id name aliases gender birth_date country height disambiguation
  deleted merged_into_id
  measurements { cup_size band_size waist hip }
  images { url width height }
  urls { url type }`

const SEARCH = `query SearchPerformer($term: String!) { searchPerformer(term: $term) { ${FIELDS} } }`
const FIND = `query FindPerformer($id: ID!) { findPerformer(id: $id) { ${FIELDS} } }`

const MERGE_HOPS = 4
const GENDERS: Record<string, ActorGender> = { FEMALE: 'female', MALE: 'male' }
/** stash-box url.type → ids 键。 */
const URL_TYPES: Record<string, string> = {
  iafd: 'iafd',
  freeones: 'freeones',
  indexxx: 'indexxx',
  twitter: 'twitter',
  instagram: 'instagram',
  imdb: 'imdb',
  wikidata: 'wikidata',
  wikipedia: 'wikipedia',
  fanza: 'fanza',
  manyvids: 'manyvids',
  onlyfans: 'onlyfans',
  homepage: 'homepage',
  'official homepage': 'homepage',
  official: 'homepage',
}

const obj = (value: unknown): Obj | undefined =>
  value && typeof value === 'object' ? (value as Obj) : undefined
const objs = (value: unknown): Obj[] =>
  Array.isArray(value) ? value.map(obj).filter((v): v is Obj => !!v) : []
const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? normalizeName(value) || undefined : undefined

/** 条目的规范名 + 别名。 */
function namesOf(perf: Obj): string[] {
  return [
    text(perf.name),
    ...(Array.isArray(perf.aliases) ? perf.aliases.map(text) : []),
  ].filter((n): n is string => Boolean(n))
}

/** 检索结果里挑名字对得上的条目。 */
export function pickPerformer(results: unknown, name: string): Obj | undefined {
  return objs(results).find(p => hasName(namesOf(p), name))
}

/** 条目 → 演员资料；缺规范名返回 null。 */
export function performerProfile(perf: Obj): ActorProfile | null {
  const name = text(perf.name)
  if (!name) return null
  const id = text(String(perf.id ?? ''))
  const meas = obj(perf.measurements)
  const images = objs(perf.images)
    .map(img => ({
      url: text(img.url),
      area: (positiveInt(img.width) ?? 0) * (positiveInt(img.height) ?? 0),
    }))
    .sort((a, b) => b.area - a.area)
    .map(img => img.url)
  const ids: Record<string, string> = id ? { theporndb: id } : {}
  for (const u of objs(perf.urls)) {
    const url = text(u.url)
    const key = URL_TYPES[(text(u.type) ?? '').toLowerCase()]
    if (url && key && !ids[key] && !url.toLowerCase().includes('theporndb.net'))
      ids[key] = url
  }
  return {
    source: 'theporndb',
    name,
    aliases: uniqueNames(namesOf(perf).slice(1), name),
    gender: GENDERS[String(perf.gender)],
    birthday: text(perf.birth_date),
    birthplace: text(perf.country),
    height: positiveInt(perf.height),
    bust: positiveInt(meas?.band_size),
    waist: positiveInt(meas?.waist),
    hip: positiveInt(meas?.hip),
    cup: text(meas?.cup_size)?.toUpperCase(),
    tagline: text(perf.disambiguation),
    images: [...new Set(images.filter((u): u is string => Boolean(u)))],
    ids,
    url: id ? `https://theporndb.net/performers/${id}` : undefined,
  }
}

export interface ThePornDbOptions {
  /** 每次查询时读取当前 token；没有就跳过。与影片站点共用同一个 token。 */
  token: () => string | undefined
}

export function createThePornDbSource(options: ThePornDbOptions): ActorSource {
  async function gql(
    ctx: ActorContext,
    token: string,
    query: string,
    variables: Obj
  ): Promise<Obj | undefined> {
    const data = await ctx.postJson!(
      THEPORNDB_GRAPHQL,
      { query, variables },
      { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    )
    return obj(obj(data)?.data)
  }

  /** 已删除条目跟随合并目标。 */
  async function resolve(
    ctx: ActorContext,
    token: string,
    hit: Obj
  ): Promise<Obj | undefined> {
    const seen = new Set<string>()
    let current: Obj | undefined = hit
    for (let i = 0; i < MERGE_HOPS && current; i++) {
      const id = String(current.id ?? '')
      if (seen.has(id)) return undefined
      seen.add(id)
      if (current.deleted !== true) return current
      const target = text(String(current.merged_into_id ?? ''))
      if (!target) return undefined
      current = obj(
        (await gql(ctx, token, FIND, { id: target }))?.findPerformer
      )
    }
    return undefined
  }

  return {
    id: 'theporndb',
    label: 'ThePornDB',
    capability: 'profile',
    genders: ['female', 'male'],
    async fetch(name: string, ctx: ActorContext): Promise<ActorProfile | null> {
      const token = options.token()?.trim()
      if (!token || !ctx.postJson || !name.trim()) return null
      const data = await gql(ctx, token, SEARCH, { term: name.trim() })
      const hit = pickPerformer(data?.searchPerformer, name)
      const perf = hit && (await resolve(ctx, token, hit))
      return perf ? performerProfile(perf) : null
    },
  }
}

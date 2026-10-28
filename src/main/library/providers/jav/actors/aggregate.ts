/**
 * 演员资料聚合：标量字段按资料来源优先级「空才填」，别名取并集，头像按头像来源优先拼接。
 */
import { uniqueNames } from './names'
import type { ActorGender, ActorProfile, ActorSourceId } from './types'

/** 先到先得的单值字段。 */
export const ACTOR_SCALAR_FIELDS = [
  'gender',
  'birthday',
  'birthplace',
  'height',
  'bust',
  'waist',
  'hip',
  'cup',
  'overview',
  'tagline',
] as const

export type ActorScalarField = (typeof ACTOR_SCALAR_FIELDS)[number]

/** 聚合后的演员资料。 */
export interface AggregatedActor {
  /** 查询用的名字（调用方传入，作为身份）。 */
  name: string
  /** 各来源的规范名 + 别名并集，不含 name。 */
  aliases: string[]
  gender?: ActorGender
  birthday?: string
  birthplace?: string
  height?: number
  bust?: number
  waist?: number
  hip?: number
  cup?: string
  overview?: string
  tagline?: string
  /** 头像，去重保序；images[0] 即首选头像。 */
  images: string[]
  ids: Record<string, string>
  /** 各来源的资料页。 */
  urls: Partial<Record<ActorSourceId, string>>
  /** 每个字段取自哪个来源（溯源 / 设置页展示用）。 */
  fieldSources: Partial<Record<ActorScalarField | 'images', ActorSourceId>>
}

/** 聚合顺序。 */
export interface ActorMergeOrder {
  /** 资料来源优先级：标量字段、别名、id 按这个顺序取。 */
  profile: readonly ActorSourceId[]
  /** 头像来源优先级：先取这些来源的头像，再接资料来源附带的头像。 */
  image: readonly ActorSourceId[]
}

/**
 * 合并各来源结果。没有任何来源命中返回 null。
 * 不在 order 里的来源结果被忽略（设置里关掉的来源不参与）。
 */
export function mergeActorProfiles(
  name: string,
  profiles: readonly ActorProfile[],
  order: ActorMergeOrder
): AggregatedActor | null {
  const bySource = new Map(profiles.map(p => [p.source, p]))
  const out: AggregatedActor = {
    name,
    aliases: [],
    images: [],
    ids: {},
    urls: {},
    fieldSources: {},
  }
  let hit = false
  const aliases: string[] = []

  for (const source of order.profile) {
    const p = bySource.get(source)
    if (!p) continue
    hit = true
    for (const field of ACTOR_SCALAR_FIELDS) {
      const value = p[field]
      if (out[field] !== undefined || value === undefined || value === '')
        continue
      ;(out as unknown as Record<string, unknown>)[field] = value
      out.fieldSources[field] = source
    }
    aliases.push(p.name, ...p.aliases)
    for (const [k, v] of Object.entries(p.ids)) out.ids[k] ??= v
    if (p.url) out.urls[source] ??= p.url
  }

  const imageOrder = [
    ...order.image,
    ...order.profile.filter(s => !order.image.includes(s)),
  ]
  for (const source of imageOrder) {
    const p = bySource.get(source)
    if (!p) continue
    hit = true
    if (p.url) out.urls[source] ??= p.url
    if (p.images.length && !out.fieldSources.images)
      out.fieldSources.images = source
    out.images.push(...p.images)
  }

  if (!hit) return null
  out.images = [...new Set(out.images)]
  out.aliases = uniqueNames(aliases, name)
  return out
}

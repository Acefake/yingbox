/**
 * 演员资料层入口：内置来源、默认优先级、按性别裁剪来源、并发查询 + 聚合。
 *
 * 不碰数据库也不缓存：调用方（刮削流程）自己决定何时查、结果存哪、要不要缓存。
 */
import {
  type ActorMergeOrder,
  type AggregatedActor,
  mergeActorProfiles,
} from './aggregate'
import { avbaseActors } from './sources/avbase'
import { type GfriendsOptions, createGfriendsSource } from './sources/gfriends'
import { javdbActors } from './sources/javdb'
import { minnano } from './sources/minnano'
import { createThePornDbSource } from './sources/theporndb'
import {
  type WikipediaOptions,
  createWikipediaSource,
} from './sources/wikipedia'
import type {
  ActorContext,
  ActorGender,
  ActorProfile,
  ActorSource,
  ActorSourceId,
} from './types'

export type { AggregatedActor, ActorMergeOrder } from './aggregate'
export type * from './types'

/** 默认资料优先级：身材 / 生日最全的日文库在前，维基补简介，ThePornDB（需 token）兜底。 */
export const DEFAULT_PROFILE_ORDER: readonly ActorSourceId[] = [
  'avbase',
  'minnano',
  'javdb',
  'wikipedia',
  'theporndb',
]

/** 默认头像优先级：gfriends 的头像经过整理（多为高清、统一比例），先用它。 */
export const DEFAULT_IMAGE_ORDER: readonly ActorSourceId[] = ['gfriends']

export interface ActorSourcesOptions {
  gfriends?: GfriendsOptions
  wikipedia?: WikipediaOptions
  /** ThePornDB token（与影片站点共用）；不给则该来源始终跳过。 */
  theporndbToken?: () => string | undefined
}

/** 创建全部内置来源。gfriends 自带索引缓存，应用内只建一次并复用返回值。 */
export function createActorSources(
  options: ActorSourcesOptions = {}
): ActorSource[] {
  return [
    createGfriendsSource(options.gfriends),
    avbaseActors,
    minnano,
    javdbActors,
    createWikipediaSource(options.wikipedia),
    createThePornDbSource({
      token: options.theporndbToken ?? (() => undefined),
    }),
  ]
}

/**
 * 按性别留下收录该性别的来源。性别未知时只留男女都收的来源，
 * 免得拿男优名字去只收女优的站白查（还可能撞上同名女优）。
 */
export function sourcesForGender(
  sources: readonly ActorSource[],
  gender: ActorGender | undefined
): ActorSource[] {
  return sources.filter(s =>
    gender ? s.genders.includes(gender) : s.genders.length > 1
  )
}

/** 一次演员查询的结果。 */
export interface ActorLookup {
  /** 聚合结果；没有任何来源命中为 null。 */
  actor: AggregatedActor | null
  /** 各来源原始结果（命中的）。 */
  profiles: ActorProfile[]
  /** 出错（被拦 / 网络失败）的来源及原因；调用方据此决定是否缓存「查无此人」。 */
  failures: Array<{ source: ActorSourceId; error: unknown }>
}

export interface LookupActorOptions {
  /** 参与查询的来源（已按设置开关过滤）。 */
  sources: readonly ActorSource[]
  ctx: ActorContext
  order?: ActorMergeOrder
}

/**
 * 按名字并发查所有来源并聚合。单个来源出错不影响其它来源；
 * 中断（signal）时直接抛出。
 */
export async function lookupActor(
  name: string,
  options: LookupActorOptions
): Promise<ActorLookup> {
  const { sources, ctx } = options
  const order = options.order ?? {
    profile: DEFAULT_PROFILE_ORDER,
    image: DEFAULT_IMAGE_ORDER,
  }
  const failures: ActorLookup['failures'] = []
  const settled = await Promise.all(
    sources.map(async source => {
      try {
        return await source.fetch(name, ctx)
      } catch (error) {
        if (ctx.signal?.aborted) throw error
        failures.push({ source: source.id, error })
        return null
      }
    })
  )
  const profiles = settled.filter((p): p is ActorProfile => Boolean(p))
  return {
    actor: mergeActorProfiles(name, profiles, order),
    profiles,
    failures,
  }
}

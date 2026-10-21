/**
 * 演员资料层的类型：按演员名查头像、别名、生日、身材、简介等，与影片站点（JavSite）分开。
 *
 * 影片站点只顺带给「名字 + 头像」（JavActor）；这一层面向「一个人」，
 * 字段对齐 Amane 演员资料模型实际用到的部分，聚合规则见 aggregate.ts。
 */
import type { SiteContext } from '../types'

/** 内置的演员资料来源。 */
export type ActorSourceId =
  | 'gfriends'
  | 'minnano'
  | 'wikipedia'
  | 'javdb'
  | 'avbase'
  | 'theporndb'

export type ActorGender = 'female' | 'male'

/** 一个来源查到的演员资料。字段都可缺省，聚合时按来源优先级逐字段取第一个非空值。 */
export interface ActorProfile {
  source: ActorSourceId
  /** 来源上的规范名（NFKC 归一）。 */
  name: string
  /** 别名、旧名、读音（かな / 罗马字），不含 name 本身，去重保序。 */
  aliases: string[]
  gender?: ActorGender
  /** YYYY-MM-DD。 */
  birthday?: string
  /** 出身地，原文。 */
  birthplace?: string
  /** 身高（cm）。 */
  height?: number
  /** 胸围 / 腰围 / 臀围（cm）。 */
  bust?: number
  waist?: number
  hip?: number
  /** 罩杯，大写字母。 */
  cup?: string
  /** 简介（纯文本，段落间空一行）。 */
  overview?: string
  /** 一句话身份描述（如维基数据的描述）。 */
  tagline?: string
  /** 头像，绝对 URL，好的在前。 */
  images: string[]
  /** 各站 id：自身 id 以及来源顺带给出的外站 id（wikidata / imdb / twitter …）。 */
  ids: Record<string, string>
  /** 来源上的资料页地址。 */
  url?: string
}

/**
 * 来源取数据用的上下文：在影片站点的 SiteContext（GET 取文本，404 为 null，被拦 / 网络失败抛错）
 * 之上，可选提供 POST JSON。只有 GraphQL 来源（theporndb）需要，没提供时这类来源直接返回 null。
 */
export interface ActorContext extends SiteContext {
  postJson?(
    url: string,
    body: unknown,
    headers?: Record<string, string>
  ): Promise<unknown>
}

/** 来源能提供什么：image = 只有头像（gfriends），profile = 资料（可能附带头像）。 */
export type ActorCapability = 'image' | 'profile'

/** 一个演员资料来源。 */
export interface ActorSource {
  readonly id: ActorSourceId
  /** 设置页显示名。 */
  readonly label: string
  readonly capability: ActorCapability
  /** 收录哪些性别的演员；按性别裁剪来源见 sourcesForGender。 */
  readonly genders: readonly ActorGender[]
  /**
   * 按演员名查。查无此人返回 null；被拦截 / 网络失败抛错（不得当作 null，
   * 否则调用方会把「没查到」缓存下来）。
   */
  fetch(name: string, ctx: ActorContext): Promise<ActorProfile | null>
}

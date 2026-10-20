/**
 * 入库用的完整元数据形状（与具体元数据源无关）。识别只需要 Candidate，详情页 / NFO 需要这些。
 *
 * 图片字段都是元数据源内的相对路径（TMDB 的 file_path），拼 URL 由各 provider 负责。
 */
import type { ExternalIds } from '../parser'
import type { MediaRef } from './types'

/** 图片用途。 */
export type ImageRole = 'poster' | 'backdrop' | 'logo' | 'still'

/** 一张候选图片。 */
export interface ImageCandidate {
  role: ImageRole
  /** 元数据源内路径，如 TMDB 的 "/abc.jpg"。 */
  path: string
  /** 图片文字语言（ISO 639-1）；无文字为 null。 */
  language: string | null
  width: number
  height: number
  voteAverage: number
  voteCount: number
}

/** 演职员。 */
export interface PersonCredit {
  id: string
  name: string
  originalName?: string
  /** 演员饰演的角色。 */
  character?: string
  /** 职务：Director / Screenplay / Writer / Creator…… */
  job?: string
  profilePath?: string
  /** 演员表顺序。 */
  order?: number
}

/** 剧集的一季（概要，来自剧集详情）。 */
export interface SeasonSummary {
  season: number
  name: string
  episodeCount: number
  airDate?: string
  posterPath?: string
}

/** 剧集分组（TMDB episode_groups），绝对集数映射用。 */
export interface EpisodeGroupSummary {
  id: string
  /** TMDB 分组类型：1 首播 2 绝对 3 DVD 4 数字 5 故事线 6 制作 7 电视。 */
  type: number
  name: string
  episodeCount: number
}

/** 电影 / 剧集的元数据。 */
export interface MediaMetadata {
  ref: MediaRef
  /** 首选语言标题（按 zh-CN → zh-TW → en 回退，最后用原名）。 */
  title: string
  originalTitle?: string
  originalLanguage?: string
  year?: number
  /** 上映 / 首播日期 YYYY-MM-DD。 */
  releaseDate?: string
  overview?: string
  /** overview 实际使用的语言（如 zh-CN / zh-TW / en-US）。 */
  overviewLanguage?: string
  tagline?: string
  genres: string[]
  /** 评分 0–10。 */
  rating?: number
  voteCount?: number
  runtimeMinutes?: number
  /** 制片国家（ISO 3166-1）。 */
  countries: string[]
  companies: string[]
  /** 分级（优先中国大陆，其次美国）。 */
  certification?: string
  /** 前 15 位演员。 */
  cast: PersonCredit[]
  /** 导演、编剧（剧集还有主创）。 */
  crew: PersonCredit[]
  /** 已按“语言偏好 → 评分 → 票数”排好序。 */
  images: ImageCandidate[]
  externalIds: ExternalIds
  /** 电影所属系列（合集），NFO 的 <set>。 */
  collection?: { id: string; name: string }
  /** 剧集状态（Returning Series / Ended / Canceled……）。 */
  status?: string
  seasons?: SeasonSummary[]
  episodeGroups?: EpisodeGroupSummary[]
}

/** 一集的元数据。 */
export interface EpisodeMetadata {
  season: number
  episode: number
  title: string
  overview?: string
  airDate?: string
  runtimeMinutes?: number
  rating?: number
  stillPath?: string
}

/** 一季的元数据（含每集）。 */
export interface SeasonMetadata {
  season: number
  name: string
  overview?: string
  airDate?: string
  posterPath?: string
  episodes: EpisodeMetadata[]
}

/** 剧集内的一集位置。 */
export interface EpisodePosition {
  season: number
  episode: number
}

/**
 * 识别与元数据：条目上存的完整元数据形状、识别请求、刷新元数据请求（从 contract.ts 拆出，经它再导出）。
 */
import type {
  EpisodeMetadata,
  MediaMetadata,
  SeasonMetadata,
} from '../provider'

/**
 * 条目上存的完整元数据：电影 / 剧集是 MediaMetadata，季是 SeasonMetadata（不含 episodes），
 * 集是 EpisodeMetadata。绝对集数的集额外带 mapped（映射到的 季 / 集）。
 * 没刮削上的电影 / 剧集可能带 local：只有本地 NFO / 豆瓣补来的制片国家（供地区筛选），不算匹配。
 */
export type ItemMetadata =
  | ({ level: 'title' } & MediaMetadata)
  | ({ level: 'season' } & Omit<SeasonMetadata, 'episodes'>)
  | ({ level: 'episode' } & EpisodeMetadata & { mapped?: boolean })
  | LocalItemMetadata

/** 本地补全的元数据：制片国家（ISO 3166-1）与来源。 */
export interface LocalItemMetadata {
  level: 'local'
  countries: string[]
  source: 'nfo' | 'douban'
}

/** 识别请求：给 itemIds 只识别这些条目；只给 libraryId 识别该库里需要识别的条目。 */
export interface IdentifyRequest {
  libraryId?: number
  itemIds?: number[]
  /** 为 true 时已自动匹配 / 待确认的也重新识别（锁定的永远不动）。 */
  force?: boolean
  /**
   * 为 true 时只对其中待确认 / 未匹配的条目做 AI 识别（大模型推断片名后经 TMDB 验证），
   * 不受设置「AI 识别兜底」开关影响；没有配置 AI 时报错。
   */
  ai?: boolean
}

/** 刷新元数据：重新拉取已匹配条目（含锁定）的元数据与图片，不改匹配。 */
export interface RefreshMetadataRequest {
  libraryId?: number
  itemIds?: number[]
}

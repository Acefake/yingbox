import type { Movie } from '@tdanks2000/tmdb-wrapper'
import type { BackendMeta } from '@/api/backend'

/**
 * 扩展的电影数据接口，包含刮削过程中附加的额外字段
 * 避免到处使用 `as any` 强制扩展 Movie 类型
 */
export interface ScrapedMovie extends Movie {
  genres?: Array<{ id: number; name: string }>
  runtime?: number
  cast?: CastMember[]
  directors?: DirectorMember[]
  production_countries?: Array<{ iso_3166_1: string; name: string }>
  production_companies?: Array<{ id: number; name: string }>
  /** JavBus 元数据，仅 JavBus provider 时存在 */
  _javbus?: BackendMeta
}

export interface CastMember {
  id: number
  name: string
  character?: string
  profile_path?: string
  tmdbid?: number
  order?: number
}

export interface DirectorMember {
  id: number
  name: string
  profile_path?: string
  tmdbid?: number
}

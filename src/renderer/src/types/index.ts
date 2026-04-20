/**
 * 处理后的项目接口
 */
export interface ProcessedItem {
  /** 项目名称 */
  name: string
  /** 项目路径 */
  path: string
  /** 项目类型 */
  type: 'folder' | 'video'
  /** 项目大小（字节） */
  size?: number
  /** 子文件数量 */
  fileCount?: number
  /** 子文件列表 */
  files?: FileItem[]
  /** 是否已有 NFO 文件 */
  hasNfo?: boolean
  /** 是否已有海报文件 */
  hasPoster?: boolean
  /** 是否已有背景图文件 */
  hasFanart?: boolean
  /** 电视剧季信息（仅电视剧） */
  seasonNumber?: number
  /** 电视剧集信息（仅电视剧） */
  episodeNumber?: number
  /** 是否为季文件夹 */
  isSeasonFolder?: boolean
  /** 子项目列表（用于电视剧的季和集） */
  children?: ProcessedItem[]
}

/**
 * 文件项接口
 */
export interface FileItem {
  /** 文件名 */
  name: string
  /** 完整路径 */
  path: string
  /** 文件大小（字节） */
  size: number
  /** 是否为目录 */
  isDirectory: boolean
  /** 是否为文件 */
  isFile: boolean
}

/**
 * 电影信息接口
 */
export interface MovieInfoType {
  title?: string
  originaltitle?: string
  year?: string
  plot?: string
  genre?: string[]
  director?: string
  actor?: string[]
  rating?: string
  runtime?: string
  country?: string
  studio?: string
  premiered?: string
}

/**
 * 集信息接口
 */
export interface EpisodeInfo {
  /** 集数 */
  episode_number: number
  /** 集标题 */
  name?: string
  /** 剧情简介 */
  overview?: string
  /** 首播日期 */
  air_date?: string
  /** 评分 */
  vote_average?: number
  /** 海报路径 */
  still_path?: string
}

/**
 * 季信息接口
 */
export interface SeasonInfo {
  /** 季数 */
  season_number: number
  /** 季名称 */
  name?: string
  /** 集数 */
  episode_count?: number
  /** 首播日期 */
  air_date?: string
  /** 剧情简介 */
  overview?: string
  /** 海报路径 */
  poster_path?: string
  /** 集列表 */
  episodes?: EpisodeInfo[]
}

/**
 * 电视剧信息接口
 */
export interface TVShowInfoType {
  /** 标题 */
  title?: string
  /** 原标题 */
  originaltitle?: string
  /** 年份 */
  year?: string
  /** 剧情简介 */
  plot?: string
  /** 类型 */
  genre?: string[]
  /** 导演 */
  director?: string
  /** 演员 */
  actor?: string[]
  /** 评分 */
  rating?: string
  /** 首播日期 */
  premiered?: string
  /** 状态 */
  status?: string
  /** 网络 */
  network?: string
  /** 季列表 */
  seasons?: SeasonInfo[]
  /** 总季数 */
  number_of_seasons?: number
  /** 总集数 */
  number_of_episodes?: number
}

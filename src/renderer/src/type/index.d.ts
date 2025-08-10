interface FileItem {
  name: string
  path: string
  size: number
  isDirectory: boolean
  isFile: boolean
}

interface ProcessedItem {
  name: string
  path: string
  type: 'folder' | 'video'
  size?: number
  fileCount?: number
  files?: FileItem[]
}

interface Props {
  item: ProcessedItem
  index: number
  selectedIndex: number
  menuBackgroundColor: string
  isMultiSelectMode?: boolean
  isSelected?: boolean
}

/**
 * 季信息接口
 */
interface Season {
  number: number
  title?: string
  episodeCount?: number
  year?: string
  plot?: string
}

/**
 * 电视剧信息接口
 */
interface TVInfoType {
  title: string
  year?: string
  plot?: string
  genre?: string[]
  director?: string
  actors?: string[]
  rating?: string
  runtime?: string
  country?: string
  studio?: string
  premiered?: string
  seasons?: Season[]
}

/**
 * 电视剧搜索结果接口
 */
interface TVShow {
  id: number
  name: string
  first_air_date?: string
  overview?: string
  poster_path?: string
  backdrop_path?: string
  vote_average?: number
  vote_count?: number
  popularity?: number
  original_language?: string
  genre_ids?: number[]
}

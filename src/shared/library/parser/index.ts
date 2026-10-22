/**
 * 统一文件名解析器：电影 / 剧集 / 附加内容，含中英双标题、动画绝对集数和文件夹回退。
 */
export { ownerFolderDepth, parseMediaPath } from './parse-path'
export type {
  ExternalIds,
  ParsedEpisode,
  ParsedExtra,
  ParsedMedia,
  ParsedMediaType,
  ParsedMovie,
} from './types'

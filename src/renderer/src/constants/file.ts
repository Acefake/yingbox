/**
 * 文件相关常量
 */

// 隐藏文件前缀
export const HIDDEN_FILE_PREFIXES = ['.', '__'] as const

// TMDB 图片基础 URL
export const TMDB_IMAGE_BASE_URL = 'https://images.tmdb.org/t/p/original'

// 缓存键名
export const CACHE_KEYS = {
  FILE_DATA: 'folderContent_fileData',
  CURRENT_PATH: 'folderContent_currentPath',
} as const

/**
 * 判断是否为隐藏文件
 */
export const isHiddenFile = (fileName: string): boolean => {
  return HIDDEN_FILE_PREFIXES.some(prefix => fileName.startsWith(prefix))
}

/**
 * 清理电影名称（移除非法字符）
 */
export const cleanMovieName = (name: string): string => {
  return name
    .replace(/[<>:"/\\|?*]/g, '') // 移除 Windows 不允许的字符
    .replace(/\s+/g, ' ') // 合并多个空格
    .trim()
}

/**
 * 获取文件扩展名
 */
export const getFileExtension = (fileName: string): string => {
  const lastDot = fileName.lastIndexOf('.')
  return lastDot >= 0 ? fileName.substring(lastDot).toLowerCase() : ''
}

/**
 * 获取不带扩展名的文件名
 */
export const getFileBaseName = (fileName: string): string => {
  const lastDot = fileName.lastIndexOf('.')
  return lastDot >= 0 ? fileName.substring(0, lastDot) : fileName
}

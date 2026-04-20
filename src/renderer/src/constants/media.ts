/**
 * 媒体文件相关常量
 */

// 视频文件扩展名
export const VIDEO_EXTENSIONS = [
  '.mp4',
  '.avi',
  '.mkv',
  '.mov',
  '.wmv',
  '.flv',
  '.webm',
  '.m4v',
] as const

// 图片文件扩展名
export const IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
] as const

// NFO 文件扩展名
export const NFO_EXTENSION = '.nfo'

// 海报文件命名模式
export const POSTER_PATTERNS = [
  'poster.jpg',
  'folder.jpg',
  'movie.jpg',
  'cover.jpg',
  '-poster.jpg',
  '-folder.jpg',
  '-movie.jpg',
] as const

// 背景图/艺术图命名模式
export const FANART_PATTERNS = [
  'fanart.jpg',
  'backdrop.jpg',
  '-fanart.jpg',
  '-backdrop.jpg',
] as const

/**
 * 判断是否为视频文件
 */
export const isVideoFile = (fileName: string): boolean => {
  return VIDEO_EXTENSIONS.some(ext => fileName.toLowerCase().endsWith(ext))
}

/**
 * 判断是否为图片文件
 */
export const isImageFile = (fileName: string): boolean => {
  return IMAGE_EXTENSIONS.some(ext => fileName.toLowerCase().endsWith(ext))
}

/**
 * 判断是否为 NFO 文件
 */
export const isNfoFile = (fileName: string): boolean => {
  return fileName.toLowerCase().endsWith(NFO_EXTENSION)
}

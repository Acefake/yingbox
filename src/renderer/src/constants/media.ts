/**
 * 媒体文件相关常量
 */

// 图片文件扩展名
const IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
] as const

// 图片扩展名 Set（O(1) 查找）
export const IMAGE_EXTENSIONS_SET = new Set<string>(IMAGE_EXTENSIONS)

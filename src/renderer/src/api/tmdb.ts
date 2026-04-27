import { TMDB } from '@tdanks2000/tmdb-wrapper'
import { getTmdbAccessToken } from '@/stores/scrape-provider-store'

/**
 * 获取 TMDB 实例（每次调用都使用最新 token，支持用户在设置中修改）
 */
export const getTmdb = (): InstanceType<typeof TMDB> => {
  return new TMDB(getTmdbAccessToken())
}

// 向后兼容：保留 tmdb 导出，使用默认 token 初始化
// 注意：调用方建议改用 getTmdb() 以支持动态 token
const tmdb = new TMDB(getTmdbAccessToken())

// 动态获取图片基础URL（每次调用时从 localStorage 读取最新设置）
export const getImageBaseUrl = (
  type?: 'poster' | 'backdrop' | 'actor'
): string => {
  const key = type ? `imageDownloadSize_${type}` : 'imageDownloadSize'
  const size =
    (typeof window !== 'undefined' && localStorage.getItem(key)) || 'original'
  return `https://images.tmdb.org/t/p/${size}`
}

// 向后兼容的静态常量（指向 original，仅用于展示类场景）
const TMDB_IMG_URL = 'https://images.tmdb.org/t/p/original'

export { TMDB_IMG_URL, tmdb }

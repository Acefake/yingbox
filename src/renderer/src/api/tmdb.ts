import { TMDB } from '@tdanks2000/tmdb-wrapper'
import { getTmdbAccessToken } from '@/stores/scrape-provider-store'

/** 缺少 Token 时的统一报错：引导用户去设置页填写，而非吞掉 401 */
export const missingTmdbTokenError = (): Error =>
  new Error('未配置 TMDB Access Token，请在设置中填写（TMDB API 设置页获取）')

/**
 * 获取 TMDB 实例（每次调用都使用最新 token，支持用户在设置中修改）。
 * 未配置时直接抛错，避免发出无意义的 401 请求。
 */
export const getTmdb = (): InstanceType<typeof TMDB> => {
  const token = getTmdbAccessToken()
  if (!token) throw missingTmdbTokenError()
  return new TMDB(token)
}

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

/**
 * 向后兼容的懒加载单例：首次访问属性时才用当前 token 构造。
 * 新代码请直接用 getTmdb()。
 */
export const tmdb: InstanceType<typeof TMDB> = new Proxy({} as InstanceType<typeof TMDB>, {
  get(_target, prop, receiver): unknown {
    return Reflect.get(getTmdb(), prop, receiver)
  },
})

export { TMDB_IMG_URL }

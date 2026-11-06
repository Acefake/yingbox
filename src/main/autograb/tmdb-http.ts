/** 带令牌脱敏、网络优化和体积限制的 TMDB 请求。 */
import type { NetworkPreferences } from '../../shared/network/preferences'
import { fetchHttp, readLimited } from '../http-client'
import type { TmdbGet } from './movies/tmdb'

const TMDB_API = 'https://api.themoviedb.org/3'

/**
 * GET TMDB v3：v4 读访问令牌（eyJ 开头）走 Bearer，v3 API Key 放 api_key；错误信息里的令牌打码。
 */
export const createTmdbGet =
  (tmdbToken: () => string, network: () => NetworkPreferences): TmdbGet =>
  async (path, query) => {
    const token = tmdbToken()
    if (!token) return null
    const bearer = token.startsWith('eyJ')
    const params = new URLSearchParams(query)
    if (!bearer) params.set('api_key', token)
    try {
      const response = await fetchHttp(
        `${TMDB_API}${path}?${params}`,
        { headers: bearer ? { Authorization: `Bearer ${token}` } : {} },
        15_000,
        network()
      )
      return JSON.parse(
        (await readLimited(response, 2 * 1024 * 1024)).toString('utf8')
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(message.split(token).join('***'))
    }
  }

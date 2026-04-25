/**
 * MetaTube API 客户端
 * 需要用户自行部署 metatube-server: https://github.com/metatube-community/metatube-sdk-go
 *
 * API 端点：
 *   搜索: GET {serverUrl}/v1/movies/search?q={keyword}&fallback=true
 *   详情: GET {serverUrl}/v1/movies/{provider}/{id}
 * 鉴权: Authorization: Bearer {token}（token 为空时不传）
 */

import axios from 'axios'
import { getMetatubeConfig } from '@/stores/scrape-provider-store'

const axiosFetch = async (url: string, headers?: Record<string, string>): Promise<unknown> => {
  const res = await axios.get(url, { headers, timeout: 15000 })
  return res.data
}

export interface MetatubeMovieResult {
  id: string
  title: string
  number: string
  cover_url: string
  thumb_url: string
  release_date: string
  runtime: number
  score: number
  provider: string
}

export interface MetatubeMovieDetail extends MetatubeMovieResult {
  summary: string
  director: string
  series: string
  studio: string
  labels: string[]
  genres: string[]
  actors: MetatubeActor[]
  preview_images: string[]
}

export interface MetatubeActor {
  id: string
  name: string
  thumb_url: string
  provider: string
}

interface MetatubeResponse<T> {
  data: T
}

const buildHeaders = (token: string): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

/**
 * 通过主进程代理加载图片，绕过防盗链（如 javbus、dmm 等）
 * 返回 base64 data URL，失败时返回原始 URL
 */
export const proxyImageUrl = async (url: string): Promise<string> => {
  if (!url) return url
  try {
    const res = await window.api.http.fetchImage(url)
    return res.success && res.data ? res.data : url
  } catch {
    return url
  }
}

/**
 * 搜索电影
 */
export const searchMetatubeMovie = async (
  keyword: string
): Promise<MetatubeMovieResult[]> => {
  const { serverUrl, token } = getMetatubeConfig()
  if (!serverUrl) throw new Error('MetaTube 服务器地址未配置')

  const url = `${serverUrl}/v1/movies/search?q=${encodeURIComponent(keyword)}&fallback=true`
  const json = await axiosFetch(url, buildHeaders(token)) as MetatubeResponse<MetatubeMovieResult[]>
  console.log('[MetaTube] 搜索原始响应:', JSON.stringify(json, null, 2))
  return json.data || []
}

/**
 * 获取电影详情
 */
export const getMetatubeMovieDetail = async (
  provider: string,
  id: string
): Promise<MetatubeMovieDetail | null> => {
  const { serverUrl, token } = getMetatubeConfig()
  if (!serverUrl) throw new Error('MetaTube 服务器地址未配置')

  const url = `${serverUrl}/v1/movies/${encodeURIComponent(provider)}/${encodeURIComponent(id)}`
  const json = await axiosFetch(url, buildHeaders(token)) as MetatubeResponse<MetatubeMovieDetail>
  return json.data || null
}

/**
 * 测试服务器连通性
 * @param serverUrl 服务器地址（不传则从 store 读取）
 * @param token Bearer Token（不传则从 store 读取）
 */
export const testMetatubeConnection = async (serverUrl?: string, token?: string): Promise<boolean> => {
  const config = getMetatubeConfig()
  const url = (serverUrl ?? config.serverUrl).replace(/\/$/, '')
  const tok = token ?? config.token
  if (!url) return false
  console.log('[MetaTube] 测试连接:', url)
  try {
    await axiosFetch(`${url}/v1/movies/search?q=test&fallback=true`, buildHeaders(tok))
    return true
  } catch (e) {
    console.warn('[MetaTube] 连接失败:', e)
    return false
  }
}

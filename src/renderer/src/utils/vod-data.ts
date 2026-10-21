/**
 * CMS / 插件返回的原始影片数据：形状与收窄。在线和 AV 两个 feature 都读这类数据，
 * 所以放在共享层（只依赖 utils/json，没有副作用，纯规则测试可以直接引入）。
 */
import { type JsonRecord, asArray, asRecord, asText } from './json'

/** 插件条目、剧集附带的参数：只原样回传给插件，前端只读其中的 url / name */
export type PluginExt = Record<string, unknown>

/**
 * CMS / 插件返回的原始影片条目（外部数据）：只声明会读的字段，且都可能缺失；
 * 其余字段原样保留（插件会在 getTracks 时用到）。
 */
export interface RawVod {
  vod_id?: string | number
  vod_name?: string
  vod_pic?: string
  vod_remarks?: string
  vod_year?: string
  vod_desc?: string
  vod_content?: string
  vod_play_url?: string
  vod_play_from?: string
  vod_duration?: string
  type_id?: string | number
  type_name?: string
  vod_hits_week?: string | number
  vod_score?: string | number
  vod_time?: string
  vod_time_add?: string
  ext?: PluginExt
  [key: string]: unknown
}

/** CatSpider 插件同时存在对象返回和 JSON 字符串返回两种实现（最多解两层字符串）。 */
export const normalizeVodPayload = (payload: unknown): JsonRecord | null => {
  let value: unknown = payload
  for (let i = 0; i < 2 && typeof value === 'string'; i++) {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  return asRecord(value) ?? null
}

/** 取出 payload.list 或 payload.data.list；都没有时返回空数组。 */
export const getVodList = (payload: unknown): unknown[] => {
  const data = normalizeVodPayload(payload)
  if (!data) return []
  const nested = normalizeVodPayload(data.data)
  return Array.isArray(data.list) ? data.list : asArray(nested?.list)
}

/** 外部条目当 RawVod 读：不是对象时当空对象（字段都按缺失处理） */
export const asRawVod = (value: unknown): RawVod =>
  (asRecord(value) ?? {}) as RawVod

/** 插件分类配置里的一个分类：名称与原样回传的参数 */
export interface PluginTab {
  name: string
  ext: PluginExt
}

/** 插件 getConfig 返回里的分类：config.tabs、data.config.tabs 或顶层 tabs 都可能 */
export const pluginTabs = (data: unknown): PluginTab[] => {
  const payload = asRecord(data)
  const config =
    asRecord(payload?.config) ||
    asRecord(asRecord(payload?.data)?.config) ||
    payload
  return asArray(config?.tabs).map(item => {
    const tab = asRecord(item) ?? {}
    return { name: asText(tab.name), ext: asRecord(tab.ext) ?? {} }
  })
}

/** 插件 getPlayinfo 返回里的第一个播放地址。 */
export const firstPlayUrl = (data: unknown): string => {
  const payload = asRecord(data)
  const urls = asArray(payload?.urls || asRecord(payload?.data)?.urls)
  return asText(urls[0])
}

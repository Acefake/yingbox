import { type Ref, ref } from 'vue'
import { onlineApi } from '../api/online'
import type { VodRequest } from '../../../../../shared/contract/online'
import { type PluginHealth, scopeOfAction } from '../utils/plugin-health'
import { markPluginOk, markPluginUnavailable } from './plugin-health'

interface VODParseRequest {
  siteName: string
  videoID?: string
  episode?: string
}

interface VODSearchRequest {
  siteName: string
  keyword: string
  ext?: string
  page?: number
}

interface VODCardsRequest {
  siteName: string
  url?: string
  ext?: string
  page?: number
}

interface VODTrackRequest {
  siteName: string
  url: string
  ext?: string
  [key: string]: unknown
}

interface VODPlayRequest {
  siteName: string
  url: string
  ext?: string
  [key: string]: unknown
}

interface VODParseResponse {
  success: boolean
  error?: string
  url?: string
  site?: string
  videoID?: string
  /** 插件原样返回的数据（对象或 JSON 字符串），用 utils/vod-payload 解析 */
  data?: unknown
  /** 引擎回报的熔断：该源暂不可用（被拦截 / 连不上 / 插件下载失败） */
  unavailable?: PluginHealth
}

/** 按引擎回报更新源的可用性：有熔断记为不可用，正常返回则清掉同类别的旧记录。 */
function trackHealth(body: VodRequest, result: VODParseResponse): void {
  if (result.unavailable)
    markPluginUnavailable(body.siteName, result.unavailable)
  else if (result.success)
    markPluginOk(body.siteName, scopeOfAction(body.action))
}

// 插件解析（含 Cloudflare 挑战时走浏览器代抓）可能超过 10s，前端超时需留出余量。
const REQUEST_TIMEOUT_MS = 45000

/** CatSpider 插件调用（各动作都返回插件原样数据） */
export interface UseVODParserReturn {
  loading: Ref<boolean>
  error: Ref<string | null>
  getConfig: (siteName: string) => Promise<VODParseResponse>
  parseVOD: (req: VODParseRequest) => Promise<VODParseResponse>
  search: (
    req: VODSearchRequest,
    signal?: AbortSignal
  ) => Promise<VODParseResponse>
  getCards: (req: VODCardsRequest) => Promise<VODParseResponse>
  getTracks: (req: VODTrackRequest) => Promise<VODParseResponse>
  getPlayinfo: (req: VODPlayRequest) => Promise<VODParseResponse>
}

export function useVODParser(): UseVODParserReturn {
  const loading = ref(false)
  const error = ref<string | null>(null)

  let activeRequests = 0
  const _call = async (
    body: VodRequest,
    signal?: AbortSignal
  ): Promise<VODParseResponse> => {
    activeRequests++
    loading.value = true
    error.value = null
    let timeoutId = 0
    try {
      if (signal?.aborted) throw new Error('已取消')
      // IPC 调用无法中途撤回：超时或取消时直接放弃结果，引擎侧自有网络超时兜底
      const result = await Promise.race([
        onlineApi().vod(body),
        new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(
            () => reject(new Error('请求超时')),
            REQUEST_TIMEOUT_MS
          )
          signal?.addEventListener('abort', () => reject(new Error('已取消')), {
            once: true,
          })
        }),
      ])
      const response = result as VODParseResponse
      trackHealth(body, response)
      return response
    } catch (e) {
      const err = e as Error
      error.value = err.message
      return { success: false, error: err.message }
    } finally {
      window.clearTimeout(timeoutId)
      loading.value = --activeRequests > 0
    }
  }

  const getConfig = async (siteName: string): Promise<VODParseResponse> =>
    _call({ action: 'getConfig', siteName })

  const parseVOD = async (req: VODParseRequest): Promise<VODParseResponse> =>
    _call({ action: 'parse', ...req })

  const search = async (
    req: VODSearchRequest,
    signal?: AbortSignal
  ): Promise<VODParseResponse> => _call({ action: 'search', ...req }, signal)

  const getCards = async (req: VODCardsRequest): Promise<VODParseResponse> =>
    _call({ action: 'getCards', ...req })

  const getTracks = async (req: VODTrackRequest): Promise<VODParseResponse> =>
    _call({ action: 'getTracks', ...req })

  const getPlayinfo = async (req: VODPlayRequest): Promise<VODParseResponse> =>
    _call({ action: 'getPlayinfo', ...req })

  return {
    loading,
    error,
    getConfig,
    parseVOD,
    search,
    getCards,
    getTracks,
    getPlayinfo,
  }
}

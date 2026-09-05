import { ref } from 'vue'
import { getBase } from '@/api/backend'

export interface VODParseRequest {
  siteName: string
  videoID?: string
  episode?: string
}

export interface VODSearchRequest {
  siteName: string
  keyword: string
  ext?: string
  page?: number
}

export interface VODCardsRequest {
  siteName: string
  url?: string
  ext?: string
  page?: number
}

export interface VODTrackRequest {
  siteName: string
  url: string
  ext?: string
  [key: string]: any
}

export interface VODPlayRequest {
  siteName: string
  url: string
  ext?: string
  [key: string]: any
}

export interface VODParseResponse {
  success: boolean
  error?: string
  url?: string
  site?: string
  videoID?: string
  data?: any
}

const REQUEST_TIMEOUT_MS = 12000

export function useVODParser() {
  const loading = ref(false)
  const error = ref<string | null>(null)

  let activeRequests = 0
  const _call = async (body: object, signal?: AbortSignal): Promise<VODParseResponse> => {
    activeRequests++
    loading.value = true
    error.value = null
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(`${getBase()}/api/vod/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const result = await response.json()
      if (!result || typeof result.success !== 'boolean') throw new Error('后端返回格式错误')
      return result as VODParseResponse
    } catch (e) {
      const err = e as Error
      error.value = err.message
      return { success: false, error: err.message }
    } finally {
      window.clearTimeout(timeoutId)
      signal?.removeEventListener('abort', abort)
      loading.value = --activeRequests > 0
    }
  }

  const getConfig = async (siteName: string): Promise<VODParseResponse> =>
    _call({ action: 'getConfig', siteName })

  const parseVOD = async (req: VODParseRequest): Promise<VODParseResponse> =>
    _call({ action: 'parse', ...req })

  const search = async (req: VODSearchRequest, signal?: AbortSignal): Promise<VODParseResponse> =>
    _call({ action: 'search', ...req }, signal)

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

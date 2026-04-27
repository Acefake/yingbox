import { ref } from 'vue'

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

const backendUrl = 'http://localhost:31471'

export function useVODParser() {
  const loading = ref(false)
  const error = ref<string | null>(null)

  const _call = async (body: object): Promise<VODParseResponse> => {
    loading.value = true
    error.value = null
    try {
      const response = await fetch(`${backendUrl}/api/vod/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await response.json()
      return result as VODParseResponse
    } catch (e) {
      const err = e as Error
      error.value = err.message
      return { success: false, error: err.message }
    } finally {
      loading.value = false
    }
  }

  const getConfig = async (siteName: string): Promise<VODParseResponse> =>
    _call({ action: 'getConfig', siteName })

  const parseVOD = async (req: VODParseRequest): Promise<VODParseResponse> =>
    _call({ action: 'parse', ...req })

  const search = async (req: VODSearchRequest): Promise<VODParseResponse> =>
    _call({ action: 'search', ...req })

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

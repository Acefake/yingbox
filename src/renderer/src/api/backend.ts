import {
  getGoBackendApiKey,
  getGoBackendUrl,
} from '@/stores/scrape-provider-store'

const DEFAULT_BASE = 'http://localhost:31471'

/** Web/PWA 模式(无 Electron 桥):走 vite 同源代理,手机零配置。 */
const isWeb = typeof window !== 'undefined' && !window.api?.file

/** 后端访问密钥查询串（图片等无法附带请求头的场景使用） */
const keyQuery = (): string => {
  const key = getGoBackendApiKey()
  return key ? `key=${encodeURIComponent(key)}` : ''
}

/** 需鉴权的后端请求头（供其它模块复用） */
export const getBackendAuthHeaders = (): Record<string, string> => {
  const key = getGoBackendApiKey()
  return key ? { Authorization: `Bearer ${key}` } : {}
}

export const getBase = (): string => {
  try {
    const configured = getGoBackendUrl()
    if (isWeb && (!configured || configured === DEFAULT_BASE)) {
      return `${window.location.origin}/backend-api`
    }
    return (configured || DEFAULT_BASE).replace(/\/+$/, '')
  } catch {
    return DEFAULT_BASE
  }
}

export interface BackendVideoItem {
  id: string
  title: string
  poster: string
}

export interface BackendVideoDetail {
  id: string
  title: string
  releaseDate: string
  fanarts: string[]
  videoFile?: string
}

async function get<T>(
  path: string,
  extraHeaders?: Record<string, string>
): Promise<T> {
  const res = await fetch(`${getBase()}${path}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...getBackendAuthHeaders(),
      ...extraHeaders,
    },
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  if (data && data.error) {
    if (data.log) console.error(`[backend${path}] log:\n`, data.log)
    throw new Error(String(data.error))
  }
  return data as T
}

export const backend = {
  /** 视频列表（Go 缓存，按修改时间倒序） */
  listVideos(): Promise<BackendVideoItem[]> {
    return get<BackendVideoItem[]>('/api/videos')
  },

  /** 视频详情（title / releaseDate / fanarts / videoFile） */
  videoDetail(id: string): Promise<BackendVideoDetail> {
    return get<BackendVideoDetail>(`/api/videos/${encodeURIComponent(id)}`)
  },

  /** 图片 URL（本地文件通过 Go 代理访问） */
  fileUrl(path: string): string {
    const q = keyQuery()
    return `${getBase()}${path}${q ? (path.includes('?') ? '&' : '?') + q : ''}`
  },

  /** 远端图片代理（绕过防盗链，如演员头像） */
  proxyUrl(url: string): string {
    const q = keyQuery()
    return `${getBase()}/proxy?url=${encodeURIComponent(url)}${q ? `&${q}` : ''}`
  },

  /** 测试 Go 后端连通性 */
  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${getBase()}/api/videos`, {
        method: 'GET',
        headers: getBackendAuthHeaders(),
        signal: AbortSignal.timeout(5000),
      })
      return res.ok
    } catch {
      return false
    }
  },
}

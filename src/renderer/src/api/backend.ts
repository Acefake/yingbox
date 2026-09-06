import { getGoBackendUrl } from '@/stores/scrape-provider-store'

const DEFAULT_BASE = 'http://localhost:31471'

export const getBase = (): string => {
  try {
    return (getGoBackendUrl() || DEFAULT_BASE).replace(/\/+$/, '')
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

export interface BackendMeta {
  avid: string
  title: string
  cover: string
  release_date: string
  duration: string
  description: string
  keywords: string[]
  actress: Record<string, string>
  fanarts: string[]
  magnets: { magnet: string; name: string; size: string; date: string }[]
  error?: string
}

async function get<T>(
  path: string,
  extraHeaders?: Record<string, string>
): Promise<T> {
  const res = await fetch(`${getBase()}${path}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    signal: AbortSignal.timeout(path.startsWith('/api/scrape/') ? 300000 : 60000),
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

  /** 从 JavBus 抓取元数据（Go 调 Python fetch_meta.py，只返回 JSON，不写磁盘） */
  fetchMeta(avid: string): Promise<BackendMeta> {
    return get<BackendMeta>(`/api/meta/${encodeURIComponent(avid)}`)
  },

  /** 完整刮削：下载封面/fanart/演员图 + 生成 NFO（Go 调 Python scrape.py，写磁盘） */
  scrape(avid: string): Promise<BackendMeta> {
    return get<BackendMeta>(`/api/scrape/${encodeURIComponent(avid)}`)
  },

  /** 图片 URL（本地文件通过 Go 代理访问） */
  fileUrl(path: string): string {
    return `${getBase()}${path}`
  },

  /** 远端图片代理（绕过防盗链，如演员头像） */
  proxyUrl(url: string): string {
    return `${getBase()}/proxy?url=${encodeURIComponent(url)}`
  },

  /** 测试 Go 后端连通性 */
  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${getBase()}/api/videos`, { method: 'GET', signal: AbortSignal.timeout(5000) })
      return res.ok
    } catch {
      return false
    }
  },
}

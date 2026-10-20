export interface Page<T> {
  items: T[]
  total: number
}
export interface AmaneFilm {
  id: number
  number: string
  title: string | null
  actors: string[]
  tags: string[]
  studio: string | null
  release: string | null
  runtime: number | null
  plot: string | null
  poster_url: string | null
  thumb_url: string | null
  poster_urls: string[]
  thumb_urls: string[]
  score: number | null
  file_count: number
  publisher?: string | null
  directors?: string[]
  series?: string | null
  source_urls?: Record<string, unknown>
  extrafanart?: string[]
  extrafanart_urls?: Record<string, string[]>
  locked_fields?: string[]
}
export interface AmaneFile {
  id: number
  path: string
  number: string | null
  status: string
  library_id: number
  metadata_id: number | null
}
export interface AmaneUserTag {
  id: number
  name: string
}
export interface AmaneDetail {
  metadata: AmaneFilm
  files: AmaneFile[]
  actor_ids: Record<string, number>
  tag_ids: Record<string, number>
  actor_genders?: Record<string, string>
  user_tags?: AmaneUserTag[]
}
export interface AmaneActor {
  id: number
  name: string
  count: number
  image_urls: string[]
  overview?: string | null
}
export interface AmaneLibrary {
  id: number
  name: string
  path: string
  automation: 'none' | 'watch' | 'scrape'
  auto_organize: boolean
}
export interface AmaneTask {
  id: number
  type: string
  title: string | null
  status: string
  error: string | null
  child_count: number
  child_status: Record<string, number>
  created_at: string
  payload?: unknown
  result?: unknown
}

/** Web/PWA 手机访问:无 Electron 桥时直连 vite 同源代理。token 从分享 URL 参数注入。 */
const AMANE_TOKEN_KEY = 'yingbox-amane-token'

export const setAmanePhoneToken = (token: string): void => {
  if (token) localStorage.setItem(AMANE_TOKEN_KEY, token)
}

const isWeb = typeof window !== 'undefined' && !window.api?.amane

const amaneBase = (): string =>
  isWeb ? `${window.location.origin}/amane-api` : ''

const amaneHeaders = (): Record<string, string> => {
  if (!isWeb) return {}
  const token = localStorage.getItem(AMANE_TOKEN_KEY) || ''
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function amaneRequest<T>(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body?: unknown
): Promise<T> {
  if (window.api?.amane) {
    return window.api.amane.request({ path: `/api${path}`, method, body }) as Promise<T>
  }
  return fetch(`${amaneBase()}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...amaneHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    // 首次 Bearer 认证成功后服务端下发 amane_token cookie,子资源图片仅靠 cookie 自动放行
    credentials: 'same-origin',
    signal: AbortSignal.timeout(30000),
  }).then(async res => {
    if (res.status === 401) throw new Error('Amane 未授权：请在手机浏览器打开桌面客户端生成的「手机接入链接」，或清除本站数据后重新绑定')
    if (!res.ok) {
      const data = await res.json().catch(() => null) as { detail?: unknown } | null
      throw new Error(typeof data?.detail === 'string' ? data.detail : `HTTP ${res.status}`)
    }
    if (/^\/agent\/sessions\/\d+\/agui$/.test(path)) { await res.body?.cancel(); return { accepted: true } as T }
    if (res.status === 204) return null as T
    return (await res.json()) as T
  })
}

export function amaneImage(source?: string | null): string {
  if (!source) return ''
  const path = /^https?:\/\//i.test(source)
    ? `/api/resources/proxy?url=${encodeURIComponent(source)}`
    : source
  if (!path.startsWith('/api/resources/')) return ''
  if (window.api?.amane)
    return `amane://image/?path=${encodeURIComponent(path)}`
  return `${amaneBase()}${path}`
}

export const taskNames: Record<string, string> = {
  refresh: '扫描',
  scrape: '刮削',
  actor_scrape: '演员资料',
  organize: '整理',
  rescrape: '重新刮削',
  cleanup: '清理',
  upscale: '图片增强',
}
export const statusNames: Record<string, string> = {
  queued: '等待中',
  running: '处理中',
  done: '已完成',
  failed: '失败',
  pending: '待刮削',
  scraped: '已刮削',
}

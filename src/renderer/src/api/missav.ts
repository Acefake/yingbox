import { backend, getBackendAuthHeaders, getBase } from './backend'

export interface MissavStream {
  url: string
  title: string
  input: string
  poster?: string
}

export interface MissavCatalogItem {
  code: string
  title: string
  poster: string
  duration: string
}

export async function resolveMissav(
  input: string,
  signal?: AbortSignal
): Promise<MissavStream> {
  const response = await fetch(`${getBase()}/api/missav/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getBackendAuthHeaders() },
    body: JSON.stringify({ input }),
    signal: signal || AbortSignal.timeout(85000),
  })
  if (response.status === 404)
    throw new Error('当前 Go 后端尚未支持 MissAV 在线播放，请更新并重启后端')
  if (!response.ok)
    throw new Error(`MissAV 解析请求失败（HTTP ${response.status}）`)
  const result = await response.json()
  if (!result.success) throw new Error(result.error || 'MissAV 解析失败')
  if (
    typeof result.url !== 'string' ||
    !result.url.startsWith('/api/missav/stream/')
  ) {
    throw new Error('后端未返回有效的播放地址')
  }
  return {
    url: backend.fileUrl(result.url),
    title: result.title || 'MissAV',
    input,
  }
}

export async function listMissav(
  category: string,
  page: number,
  sort: string,
  signal?: AbortSignal
): Promise<{ pageCount: number; items: MissavCatalogItem[] }> {
  const params = new URLSearchParams({
    category,
    page: String(page),
    sort,
  })
  const response = await fetch(`${getBase()}/api/missav/list?${params}`, {
    headers: getBackendAuthHeaders(),
    signal: signal || AbortSignal.timeout(85000),
  })
  if (response.status === 404)
    throw new Error('当前 Go 后端尚未支持 MissAV 列表，请更新并重启后端')
  if (!response.ok)
    throw new Error(`MissAV 列表请求失败（HTTP ${response.status}）`)
  const result = await response.json()
  if (!result.success) throw new Error(result.error || 'MissAV 列表加载失败')
  return {
    pageCount: Number(result.pageCount) || page,
    items: Array.isArray(result.items) ? result.items : [],
  }
}

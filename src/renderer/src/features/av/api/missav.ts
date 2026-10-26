/**
 * MissAV：目录与播放地址经引擎获取（桌面端 window.api.av，网页端片库服务上的引擎）；
 * 封面与视频流桌面端渲染层直连、防盗链 Referer 由主进程注入，网页端视频流经服务的播放代理。
 */
import {
  type AvCategory,
  type AvSort,
  av,
} from '../../../../../shared/contract/av'
import { webEngineApi } from '@/services/library-server/engine'

/** 一条可播放的 MissAV 流。 */
export interface MissavStream {
  url: string
  title: string
  input: string
  poster?: string
}

/** 目录条目。 */
export interface MissavCatalogItem {
  code: string
  title: string
  poster: string
  duration: string
}

function avApi(): Window['api']['av'] {
  const api =
    typeof window === 'undefined'
      ? undefined
      : window.api
        ? window.api.av
        : (webEngineApi(av) ?? undefined)
  if (!api) throw new Error('MissAV 不可用')
  return api
}

/** 番号对应的封面地址。 */
export function missavCover(code: string): string {
  return `https://fourhoi.com/${code.toLowerCase()}/cover-t.jpg`
}

/** 番号或链接 → 播放地址。 */
export async function resolveMissav(input: string): Promise<MissavStream> {
  const stream = await avApi().resolve(input)
  return { url: stream.url, title: stream.title || 'MissAV', input }
}

/** 拉一页目录。 */
export async function listMissav(
  category: string,
  page: number,
  sort: string
): Promise<{ pageCount: number; items: MissavCatalogItem[] }> {
  const result = await avApi().list(
    category as AvCategory,
    page,
    sort as AvSort
  )
  return { pageCount: result.pageCount || page, items: result.items }
}

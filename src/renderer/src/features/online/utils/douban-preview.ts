/**
 * 豆瓣卡的悬停预览来源：条目地址 movie.douban.com/subject/<id>/ → 引擎取预告片 mp4
 * （online.doubanTrailer，内存 + 落盘缓存、熔断，见 engine/online/douban-trailer.ts）。
 * 没有预告时返回 null，卡片保持静态封面。
 */
import type { PreviewSource } from '@/components/ui/hover-preview'

import { onlineApi } from '../api/online'

/** 豆瓣条目类型 */
export type DoubanKind = 'movie' | 'tv'

/** 取预告的函数（测试替换） */
export type FetchTrailer = (
  subjectId: string,
  kind: DoubanKind
) => Promise<string | null>

const SUBJECT_RE =
  /^https?:\/\/(?:movie|m)\.douban\.com\/(?:movie\/)?subject\/(\d+)\/?/

/** 条目地址里的数字 ID；不是豆瓣条目地址返回 null */
export function doubanSubjectId(url: string): string | null {
  return SUBJECT_RE.exec(url)?.[1] ?? null
}

const defaultFetch: FetchTrailer = (id, kind) =>
  onlineApi().doubanTrailer(id, kind)

/** 一张豆瓣卡的预览来源；地址不是豆瓣条目时返回 null（不预览） */
export function doubanPreviewSource(
  item: { url: string; kind?: DoubanKind },
  fetchTrailer: FetchTrailer = defaultFetch
): PreviewSource | null {
  const id = doubanSubjectId(item.url)
  if (!id) return null
  const kind = item.kind ?? 'movie'
  return {
    key: `douban:${id}`,
    async resolve() {
      const url = await fetchTrailer(id, kind)
      return url ? { kind: 'video', url } : null
    },
  }
}

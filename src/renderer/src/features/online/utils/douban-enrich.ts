/** 渲染层的豆瓣卡补全：共享规则（shared/douban/item.ts）接上引擎的豆瓣详情与 TMDB。 */
import {
  type DoubanItem,
  enrichDoubanItems as enrich,
} from '../../../../../shared/douban/item'
import { doubanMetadata, tmdb } from '../api/online'

/** 前五项补豆瓣详情，再用 TMDB 补海报；直接改传入的条目。 */
export const enrichDoubanItems = (
  items: DoubanItem[],
  kind: 'movie' | 'tv'
): Promise<void> =>
  enrich(items, kind, { metadata: doubanMetadata, search: tmdb })

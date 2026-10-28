/**
 * 豆瓣卡片 → 在线详情条目（详情页按片名搜源）。首页 Hero、豆瓣海报区、想看登记共用一份。
 */
import type { DoubanItem, OnlineDetailItem } from '../types'

/** 打开详情要的条目；返回可 JSON 序列化的新对象（也原样存进想看清单） */
export function doubanDetail(item: DoubanItem): OnlineDetailItem {
  return JSON.parse(
    JSON.stringify({
      _source: 'douban',
      vod_name: item.title,
      vod_pic: item.cover || item.coverSrc,
      type_name: item.type,
      vod_year: item.year,
      overview: item.overview,
      searchTitle: item.searchTitle,
      doubanUrl: item.url,
      doubanKind: item.kind,
      doubanRating: item.rate,
      backdrop: item.backdrop,
    })
  ) as OnlineDetailItem
}

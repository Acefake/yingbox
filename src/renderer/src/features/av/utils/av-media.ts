/**
 * AV 页面共用的纯函数：封面地址解析和相对时间格式化。
 * 抽出来是为了让 Index 和各个子视图（收藏、历史）用同一套规则。
 */
import { missavCover } from '../api/missav'

/** MissAV 原站封面（fourhoi.com）：防盗链 Referer 由主进程注入，直接加载。 */
const FOURHOI_COVER =
  /^https:\/\/fourhoi\.com\/([a-z0-9]+(?:-[a-z0-9]+)*)\/cover-t\.jpg(?:[?#].*)?$/i

/** 返回条目可直接用于 <img> 的封面地址；MissAV 条目统一用 fourhoi 原图地址。 */
export const coverSrc = (item: any): string => {
  const code = String(item?._missavInput || '')
    .trim()
    .toLowerCase()
  if (code) return missavCover(code)
  const match = String(item?.vod_pic || '').match(FOURHOI_COVER)
  if (match) return missavCover(match[1])
  return item?.vod_pic || ''
}

/** 把时间戳格式化成「刚刚 / N 分钟前 / N 小时前 / 月/日」。 */
export const formatTime = (ts: number): string => {
  const diff = (Date.now() - ts) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

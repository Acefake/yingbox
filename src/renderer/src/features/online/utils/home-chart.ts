/**
 * 首页榜单行的纯规则：优先豆瓣「一周口碑电影榜」，取不到（失败、为空）时退回热门电影的前 10 部。
 * 标题跟着来源走，不把热门列表叫成口碑榜。
 */
import type { DoubanSubject } from '../../../../../shared/douban/query'

/** 榜单行最多几部 */
export const CHART_SIZE = 10

/** 榜单行要显示的内容 */
export interface HomeChart {
  /** weekly：一周口碑榜；hot：退回的热门电影 */
  source: 'weekly' | 'hot'
  title: string
  /** 按名次排好，最多 CHART_SIZE 部 */
  items: DoubanSubject[]
}

/** 同一条目只留第一次出现的那个（按条目地址） */
function uniqueTop(items: readonly DoubanSubject[]): DoubanSubject[] {
  const seen = new Set<string>()
  return items
    .filter(item => item.url && !seen.has(item.url) && seen.add(item.url))
    .slice(0, CHART_SIZE)
}

/**
 * 选榜单：口碑榜有条目就用它，否则用热门列表；两边都没有时为 null（整行隐藏）。
 * @param weekly 口碑榜结果；请求失败时传 null
 * @param hot 热门电影第一页；没取或失败时传 null
 */
export function pickChart(
  weekly: readonly DoubanSubject[] | null,
  hot: readonly DoubanSubject[] | null
): HomeChart | null {
  const top = uniqueTop(weekly ?? [])
  if (top.length)
    return { source: 'weekly', title: '豆瓣本周口碑榜', items: top }
  const fallback = uniqueTop(hot ?? [])
  if (fallback.length)
    return { source: 'hot', title: '豆瓣热门 Top 10', items: fallback }
  return null
}

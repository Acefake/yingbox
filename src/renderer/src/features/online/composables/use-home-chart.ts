/**
 * 首页榜单行的数据：先取豆瓣一周口碑电影榜，失败或为空时取热门电影第一页的前 10 部（规则见 utils/home-chart.ts），
 * 再用 TMDB 补海报（没有令牌时用豆瓣封面）。结果放在模块级单例里，回到首页不重取；引擎那边另有 10 分钟页缓存。
 */
import { type Ref, ref } from 'vue'

import { defaultDoubanQuery } from '../../../../../shared/douban/query'
import { doubanBrowse, doubanChart, onlineAvailable } from '../api/online'
import type { DoubanItem } from '../types'
import { enrichDoubanItems } from '../utils/douban-enrich'
import { pickChart } from '../utils/home-chart'
import { doubanItemOf } from './use-douban-feed'

/** 榜单行状态 */
export interface HomeChartState {
  /** 行标题（跟来源走：口碑榜 / 热门 Top 10） */
  title: Ref<string>
  /** 按名次；还没取到或两路都没有时为空（整行隐藏） */
  items: Ref<DoubanItem[]>
  /** 首次进入首页时调用；取过就不再取 */
  start(): void
}

const title = ref('')
const items = ref<DoubanItem[]>([])
let started = false

async function load(): Promise<void> {
  const weekly = await doubanChart().catch(() => null)
  const hot = weekly?.length
    ? null
    : await doubanBrowse(defaultDoubanQuery('movie'), 0)
        .then(page => page.items)
        .catch(() => null)
  const chart = pickChart(weekly, hot)
  if (!chart) {
    // 两路都失败：下次进首页再试
    started = false
    return
  }
  title.value = chart.title
  items.value = chart.items.map(doubanItemOf)
  // 补全改的是响应式数组里的元素
  void enrichDoubanItems(items.value, 'movie')
}

/** 全窗口共用的榜单状态 */
export function useHomeChart(): HomeChartState {
  return {
    title,
    items,
    start() {
      if (started || !onlineAvailable()) return
      started = true
      void load()
    },
  }
}

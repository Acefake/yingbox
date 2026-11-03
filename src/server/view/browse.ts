/**
 * view.browse：浏览页的一页（ADR-0030）。取数与补全和首页货架相同，
 * 规则同桌面浏览页（features/online/composables/use-douban-feed.ts）：空页最多连取 3 页。
 */
import {
  type BrowseTarget,
  baseQuery,
  browseTitle,
} from '../../shared/douban/browse'
import type { ViewBrowsePage } from '../../shared/view/browse'
import { type HomeDeps, cardsOf } from './home'

/** 一次最多因空页连取几页 */
const MAX_EMPTY_PAGES = 3

export async function browsePage(
  target: BrowseTarget,
  start: number,
  deps: HomeDeps
): Promise<ViewBrowsePage> {
  const query = baseQuery(target)
  const title = browseTitle(target)
  let next: number | null = start
  for (let tries = 0; tries < MAX_EMPTY_PAGES && next !== null; tries++) {
    const page = await deps.browse(query, next)
    next = page.next
    if (page.items.length)
      return { title, items: await cardsOf(page.items, query.kind, deps), next }
  }
  return { title, items: [], next }
}

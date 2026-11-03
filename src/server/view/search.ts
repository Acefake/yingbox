/**
 * view.search：按关键词在 CMS 与插件站点里搜，只取列表（不取线路），片名相同的合成一张卡。
 * 站点请求与桌面搜索页相同（CMS 的 wd=、插件的 search），整体最多等 SEARCH_DEADLINE_MS，
 * 到点后还没回的站点不再等；某个站点失败只是少了它。
 */
import { mapWithConcurrency } from '../../shared/concurrency'
import { isThumbSource } from '../../shared/media-url'
import { isAdultCatSpiderSite } from '../../shared/online/site-selection'
import { normalizeTitle, sourceKey } from '../../shared/online/sources'
import type { CmsItem } from '../../shared/online/types'
import { getVodList } from '../../shared/online/vod-data'
import {
  toCatSpiderSearchItems,
  toCmsSearchItems,
} from '../../shared/online/vod-payload'
import type { ViewSearchCard } from '../../shared/view/search'
import { thumbPath } from './home'
import { type SourceDeps, cmsList } from './sources'

/** 整个搜索最多等多久（毫秒） */
export const SEARCH_DEADLINE_MS = 12_000
/** 第一条结果出现后再等多久（毫秒），让同时在路上的站点也能带上 */
const SETTLE_MS = 4_000
const CMS_CONCURRENCY = 6
const PLUGIN_CONCURRENCY = 4
/** 最多给几张卡 */
const MAX_CARDS = 60

interface Group {
  item: CmsItem
  sites: Set<string>
}

/** 站点搜到的条目 → 卡：归一化片名相同的合并，取第一条的名字与第一张可用的海报；站点多的排前 */
export function cardsOf(
  items: readonly CmsItem[],
  keyword: string
): ViewSearchCard[] {
  const target = normalizeTitle(keyword)
  const groups = new Map<string, Group>()
  for (const item of items) {
    const key = normalizeTitle(item.vod_name)
    if (!key || !key.includes(target)) continue
    const group = groups.get(key)
    if (!group) {
      groups.set(key, { item, sites: new Set([sourceKey(item)]) })
      continue
    }
    group.sites.add(sourceKey(item))
    // 第一条缺的字段用后面的补上
    group.item = {
      ...group.item,
      vod_pic: group.item.vod_pic || item.vod_pic,
      vod_year: group.item.vod_year || item.vod_year,
      type_name: group.item.type_name || item.type_name,
    }
  }
  return [...groups.entries()]
    .sort(
      ([ka, a], [kb, b]) =>
        Number(kb === target) - Number(ka === target) ||
        b.sites.size - a.sites.size
    )
    .slice(0, MAX_CARDS)
    .map(([, { item, sites }]) => ({
      title: item.vod_name,
      year: item.vod_year || '',
      tag: item.type_name || item.vod_remarks || '',
      poster:
        item.vod_pic && isThumbSource(item.vod_pic)
          ? thumbPath(item.vod_pic, 480)
          : '',
      siteCount: sites.size,
    }))
}

/** 搜索：并发查全部站点，到点（或全部回来）后整理成卡 */
export async function searchCards(
  keyword: string,
  deps: SourceDeps
): Promise<ViewSearchCard[]> {
  const text = keyword.trim()
  if (!normalizeTitle(text)) return []
  const found: CmsItem[] = []
  let open = true
  const cms = mapWithConcurrency(deps.cmsSites(), CMS_CONCURRENCY, site =>
    open
      ? cmsList(deps, site.api, { wd: text })
          .then(list => void found.push(...toCmsSearchItems(list, site)))
          .catch(() => undefined)
      : Promise.resolve()
  )
  const plugins = deps
    .pluginSites()
    .catch(() => [])
    .then(sites =>
      mapWithConcurrency(
        sites.filter(site => !isAdultCatSpiderSite(site)),
        PLUGIN_CONCURRENCY,
        site =>
          !open
            ? Promise.resolve()
            : deps
                .vod({ action: 'search', siteName: site.name, keyword: text })
                .then(r => {
                  if (r.success && r.data)
                    found.push(
                      ...toCatSpiderSearchItems(getVodList(r.data), site)
                    )
                })
                .catch(() => undefined)
      )
    )
  // 全部回来、到总时限、或第一条结果出现后再等 SETTLE_MS（慢站点常拖满时限）就收尾
  let timer: ReturnType<typeof setInterval> | undefined
  const deadline = new Promise<void>(resolve => {
    const startedAt = Date.now()
    let firstAt = 0
    timer = setInterval(() => {
      const now = Date.now()
      if (!firstAt && found.length) firstAt = now
      if (
        now - startedAt >= SEARCH_DEADLINE_MS ||
        (firstAt && now - firstAt >= SETTLE_MS)
      )
        resolve()
    }, 250)
    timer.unref?.()
  })
  await Promise.race([Promise.all([cms, plugins]), deadline])
  clearInterval(timer)
  open = false
  return cardsOf(found, text)
}

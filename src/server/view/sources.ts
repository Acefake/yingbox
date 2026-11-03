/**
 * 选源（ADR-0030）：按片名在 CMS 与插件站点里搜，片名匹配的条目再取线路。
 * 步骤与桌面详情页（features/online/composables/use-detail-sources.ts、use-online-search.ts）相同，
 * 解析与匹配规则共用 src/shared/online；结果陆续交给 onGroups，客户端轮询会话拿到增量。
 */
import { mapWithConcurrency } from '../../shared/concurrency'
import type {
  GetJsonResponse,
  VodRequest,
  VodResponse,
} from '../../shared/contract/online'
import { asArray, asRecord } from '../../shared/json'
import { isAdultCatSpiderSite } from '../../shared/online/site-selection'
import {
  groupBySite,
  normalizeTitle,
  sourceKey,
  splitBySourceType,
  titleMatches,
} from '../../shared/online/sources'
import type {
  ApiSite,
  CatSpiderSite,
  CmsItem,
  EpisodeGroup,
} from '../../shared/online/types'
import { getVodList } from '../../shared/online/vod-data'
import {
  cmsDetailSources,
  parseCatSpiderGroups,
  parseCmsGroups,
  toCatSpiderSearchItems,
  toCmsSearchItems,
} from '../../shared/online/vod-payload'
import type { ViewSourceSite } from '../../shared/view/detail'

/** 选源要用的站点与 I/O（服务端接引擎的 online 域） */
export interface SourceDeps {
  /** 启用的 CMS 站点 */
  cmsSites: () => ApiSite[]
  /** 插件站点清单（online.sites） */
  pluginSites: () => Promise<CatSpiderSite[]>
  getJson: (url: string, timeoutMs: number) => Promise<GetJsonResponse>
  vod: (request: VodRequest) => Promise<VodResponse>
}

/** 与桌面相同的并发与超时 */
const CMS_CONCURRENCY = 6
const PLUGIN_CONCURRENCY = 4
const CMS_TIMEOUT_MS = 10_000

/** 苹果 CMS 列表接口（ac=videolist）的 list；响应不对抛错。外部数据只认有片名和 id 的条目 */
async function cmsList(
  deps: SourceDeps,
  api: string,
  params: Record<string, string>
): Promise<CmsItem[]> {
  const url = new URL(api)
  url.searchParams.set('ac', 'videolist')
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value)
  const r = await deps.getJson(String(url), CMS_TIMEOUT_MS)
  if (!r.success) throw new Error(r.error)
  const list = asRecord(r.data)?.list
  if (!Array.isArray(list)) throw new Error('接口响应缺少列表')
  return asArray(list).filter(
    (item): item is CmsItem =>
      !!asRecord(item) &&
      typeof (item as CmsItem).vod_name === 'string' &&
      ['string', 'number'].includes(typeof (item as CmsItem).vod_id)
  )
}

/** 一个条目的线路：插件走 getTracks，CMS 并发查各来源的详情接口；有直链的线路排前 */
async function fetchLines(
  item: CmsItem,
  deps: SourceDeps
): Promise<EpisodeGroup[]> {
  if (item._source === 'catspider' && item._siteName) {
    const ext = item._ext || {}
    const r = await deps.vod({
      action: 'getTracks',
      siteName: item._siteName,
      url:
        typeof ext.url === 'string' && ext.url ? ext.url : String(item.vod_id),
      ...ext,
      id: ext.id ?? item.vod_id,
    })
    return r.success && r.data
      ? parseCatSpiderGroups(getVodList(r.data), item._siteName)
      : []
  }
  const groups = await Promise.all(
    cmsDetailSources(item).map(src =>
      cmsList(deps, src.api_url, { ids: String(src.vod_id) })
        .then(list => parseCmsGroups(list[0], src.source_name))
        .catch(() => [])
    )
  )
  return groups
    .flat()
    .sort((a, b) => (b.hasDirect ? 1 : 0) - (a.hasDirect ? 1 : 0))
}

/**
 * 按片名找线路：每个站点（sourceKey）只取第一条片名匹配的条目，取到的线路交给 onGroups。
 * 某个站点失败只是少了它，整体不抛错；active() 变成 false 后剩下的站点不再请求。
 */
export async function searchSources(
  title: string,
  deps: SourceDeps,
  onGroups: (groups: EpisodeGroup[]) => void,
  active: () => boolean = () => true
): Promise<void> {
  const target = normalizeTitle(title)
  if (!target) return
  const seen = new Set<string>()
  const pending: Promise<void>[] = []
  const take = (items: CmsItem[]): void => {
    if (!active()) return
    for (const item of items) {
      if (!titleMatches(normalizeTitle(item.vod_name), target)) continue
      const key = sourceKey(item)
      if (seen.has(key)) continue
      seen.add(key)
      pending.push(
        fetchLines(item, deps)
          .then(groups => {
            const usable = groups.filter(group => group.episodes?.length)
            if (usable.length) onGroups(usable)
          })
          .catch(() => undefined)
      )
    }
  }

  const cms = mapWithConcurrency(deps.cmsSites(), CMS_CONCURRENCY, site =>
    active()
      ? cmsList(deps, site.api, { wd: title })
          .then(list => take(toCmsSearchItems(list, site)))
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
          !active()
            ? Promise.resolve()
            : deps
                .vod({ action: 'search', siteName: site.name, keyword: title })
                .then(r => {
                  if (r.success && r.data)
                    take(toCatSpiderSearchItems(getVodList(r.data), site))
                })
                .catch(() => undefined)
      )
    )
  await Promise.all([cms, plugins])
  // 搜索结束后取线路的请求可能还在路上
  await Promise.all(pending)
}

/** 线路 → 视图里的站点列表：插件源在前，同类按找到的先后 */
export function sourceSites(groups: EpisodeGroup[]): ViewSourceSite[] {
  const { catspider, cms } = splitBySourceType(groups)
  const sites = (
    list: EpisodeGroup[],
    kind: ViewSourceSite['kind']
  ): ViewSourceSite[] =>
    groupBySite(list).map(site => ({
      siteName: site.siteName,
      kind,
      lines: site.lines.map(line => ({
        label: line.label,
        episodes: line.episodes.map(ep => ({
          name: ep.name,
          url: ep.url,
          siteName: kind === 'catspider' ? (line._siteName ?? null) : null,
          ext: ep.ext ? JSON.stringify(ep.ext) : null,
        })),
      })),
    }))
  return [...sites(catspider, 'catspider'), ...sites(cms, 'cms')]
}

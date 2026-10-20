/**
 * 站点启用列表的纯规则：CatSpider 首次加载 / 后端清单变化时如何调整选择，
 * 以及旧版内置 CMS 地址的迁移。
 */
import type { CatSpiderSite } from '../types'

/** 成人插件源（归属 AV 页；普通模式下不发请求）。 */
export const ADULT_CATSPIDER_APIS = new Set([
  'csp_avtoday',
  'csp_jable',
  'csp_hanime',
  'csp_madou',
  'csp_hkdoll',
])

export const isAdultCatSpiderSite = (site: CatSpiderSite): boolean =>
  ADULT_CATSPIDER_APIS.has(site.api)

/**
 * 拿到后端完整插件清单后的新启用列表。
 * - 从未保存过选择，或仍是旧版 fallback 的默认选择：启用全部非成人源；
 * - 否则只清理已从清单移除的 api，保留用户自己的选择；
 * - 成人插件源只在第一次（未播种）时补进去，之后用户关掉不再强开。
 */
export const planCatSpiderSelection = (input: {
  sites: CatSpiderSite[]
  stored: string[]
  hasStored: boolean
  fallbackApis: string[]
  adultSeeded: boolean
}): string[] => {
  const { sites, stored, hasStored, fallbackApis, adultSeeded } = input
  const isLegacyFallback =
    stored.length === fallbackApis.length &&
    fallbackApis.every(api => stored.includes(api))
  const next =
    !hasStored || isLegacyFallback
      ? sites.filter(site => !isAdultCatSpiderSite(site)).map(site => site.api)
      : stored.filter(api => sites.some(site => site.api === api))
  if (!adultSeeded) {
    for (const site of sites) {
      if (isAdultCatSpiderSite(site) && !next.includes(site.api))
        next.push(site.api)
    }
  }
  return next
}

/** 旧版内置源改为资源站标准名称/地址后，迁移用户之前保存的启用状态。 */
export const CMS_API_MIGRATIONS: Record<string, string> = {
  'https://hhzyapi.com/api.php/provide/vod':
    'https://haohuazy.com/api.php/provide/vod/',
  'https://www.hongniuzy2.com/api.php/provide/vod':
    'http://hongniuzy2.com/api.php/provide/vod/',
  'https://www.huyaapi.com/api.php/provide/vod':
    'https://huyazy.net/api.php/provide/vod/',
  'https://api.guangsuapi.com/api.php/provide/vod':
    'https://api.guangsuapi.com/api.php/provide/vod/',
  'https://api.wujinzy.com/api.php/provide/vod':
    'https://api.wujinapi.me/api.php/provide/vod/',
}

/** 把已保存的 CMS 启用列表迁移到新地址并去重（保持原顺序）。 */
export const migrateCmsApis = (apis: string[]): string[] =>
  Array.from(new Set(apis.map(api => CMS_API_MIGRATIONS[api] || api)))

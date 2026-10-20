/**
 * CMS 站点：内置清单（cms-sites.json）、自定义站点与启用列表（模块级单例，持久化到 localStorage）。
 */
import { useStorage } from '@vueuse/core'
import cmsSitesRaw from '../../../../../../cms-sites.json'
import type { ApiSite } from '../types'
import { migrateCmsApis } from '../utils/site-selection'

/** 内置 CMS 站点。 */
export const DEFAULT_SITES: ApiSite[] = (cmsSitesRaw as { sites: ApiSite[] })
  .sites

// 已启用站点的 api 字符串数组
const selectedApis = useStorage<string[]>(
  'online_selected_sites',
  DEFAULT_SITES.map(s => s.api)
)
selectedApis.value = migrateCmsApis(selectedApis.value)

/** 自定义站点列表。 */
export const customSites = useStorage<ApiSite[]>('online_custom_sites', [])

/** 启用列表的 Set 视图，供模板 .has() 判断。 */
export const selectedSites = {
  has: (api: string) => selectedApis.value.includes(api),
  add: (api: string) => {
    if (!selectedApis.value.includes(api)) selectedApis.value.push(api)
  },
  delete: (api: string) => {
    selectedApis.value = selectedApis.value.filter(a => a !== api)
  },
}

/** 启用 / 停用一个 CMS 站点。 */
export const toggleSite = (api: string): void => {
  if (selectedSites.has(api)) selectedSites.delete(api)
  else selectedSites.add(api)
}

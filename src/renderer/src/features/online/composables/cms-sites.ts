/**
 * CMS 站点：随包订阅快照（cms-snapshot.json）、自定义站点与启用列表（模块级单例，持久化到 localStorage）。
 */
import { useStorage } from '@vueuse/core'
import cmsSnapshot from '../../../../../shared/online/cms-snapshot.json'
import type { ApiSite } from '../types'
import { LEGACY_BUILTIN_CMS_APIS } from '../../../../../shared/online/legacy-cms'
import { planBuiltinMigration } from '../utils/builtin-migration'
import { migrateCmsApis } from '../../../../../shared/online/site-selection'

/** 随包订阅快照：订阅拉取前 / 离线时的 CMS 站点。 */
export const DEFAULT_SITES: ApiSite[] = (cmsSnapshot as { sites: ApiSite[] })
  .sites

// 已启用站点的 api 字符串数组
const selectedApis = useStorage<string[]>(
  'online_selected_sites',
  DEFAULT_SITES.map(s => s.api)
)
selectedApis.value = migrateCmsApis(selectedApis.value)

/** 自定义站点列表。 */
export const customSites = useStorage<ApiSite[]>('online_custom_sites', [])

/**
 * 一次性迁移（ADR-0047）：写死的内置站不在快照 / 自定义里的，从启用列表清掉；
 * 快照里的新站默认启用，旧内置站保留用户原来的开关。
 */
const migrated = useStorage('online_builtin_migrated', false)
if (!migrated.value) {
  selectedApis.value = planBuiltinMigration({
    selected: selectedApis.value,
    legacy: LEGACY_BUILTIN_CMS_APIS,
    subscribed: useStorage<ApiSite[]>('online_subscribed_sites', []).value,
    defaults: DEFAULT_SITES,
    custom: customSites.value,
  })
  useStorage('online_subscription_url', '').value = null
  migrated.value = true
}

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

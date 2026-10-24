/**
 * 在线 feature 的公共出口：CMS / CatSpider 搜索、播放地址解析、数据源检测与设置分区。
 */
import type { SettingsSection } from '@/features/settings'

export { getJson } from './api/online'
export { useVODParser } from './composables/use-vod-parser'
export {
  type CatSpiderSite,
  loadCatSpiderSites,
  useOnlineSearch,
} from './composables/use-online-search'
export { refreshSources } from './composables/use-source-refresh'
export { resolvePlaySource } from './utils/play-source'
export { requestOnlineDetail } from './utils/detail-request'
export type { Episode } from './types'

/** 「数据源」设置分区（CMS / CatSpider / AV 源管理），由应用入口登记 */
export const sourcesSettingsSection: SettingsSection = {
  id: 'sources',
  title: '数据源',
  icon: 'database',
  keywords: 'cms av 在线源 插件 站点',
  load: () => import('./components/SourceManagerPanel.vue'),
  fill: true,
  props: { embedded: true, visible: true },
  order: 50,
}

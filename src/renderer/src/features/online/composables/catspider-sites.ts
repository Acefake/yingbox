/**
 * CatSpider 插件站点清单与启用列表（模块级单例，持久化到 localStorage）。
 * 清单由后台引擎提供；拿不到时退回内置的几个精选源。
 */
import { ref } from 'vue'
import { useStorage } from '@vueuse/core'
import { onlineApi } from '../api/online'
import type { CatSpiderSite } from '../types'
import {
  isAdultCatSpiderSite,
  planCatSpiderSelection,
} from '../utils/site-selection'

// 后端不可用时仍可使用的精选源；完整列表由后端内嵌的 vod.json 提供。
const FALLBACK_CATSPIDER_SITES: CatSpiderSite[] = [
  {
    name: '茶杯狐',
    type: 3,
    api: 'csp_cupfox',
    ext: 'https://ghp.xptvhelper.link/https://raw.githubusercontent.com/Yswag/xptv-extensions/refs/heads/main/js/cupfox.js',
  },
  {
    name: '荐片',
    type: 3,
    api: 'csp_jianpian',
    ext: 'https://ghp.xptvhelper.link/https://raw.githubusercontent.com/Yswag/xptv-extensions/refs/heads/main/js/jianpian.js',
  },
  {
    name: 'NO視頻',
    type: 3,
    api: 'csp_novipnoad',
    ext: 'https://ghp.xptvhelper.link/https://raw.githubusercontent.com/Yswag/xptv-extensions/refs/heads/main/js/novipnoad.js',
  },
]

const CATSPIDER_SELECTION_KEY = 'online_selected_catspider'
const AV_PLUGIN_SEED_KEY = 'av_plugin_sources_seeded'

/** 当前可用的插件站点清单。 */
export const CATSPIDER_SITES = ref<CatSpiderSite[]>([
  ...FALLBACK_CATSPIDER_SITES,
])
/** 已启用的插件站点 api。 */
export const selectedCatSpider = useStorage<string[]>(
  CATSPIDER_SELECTION_KEY,
  FALLBACK_CATSPIDER_SITES.map(s => s.api)
)
let catSpiderLoadPromise: Promise<void> | null = null

/** 从后端读取完整 VOD 配置；只接入当前解析器支持的 CatSpider 类型。失败后允许下次重试。 */
export const loadCatSpiderSites = (): Promise<void> => {
  if (catSpiderLoadPromise) return catSpiderLoadPromise

  catSpiderLoadPromise = Promise.resolve()
    .then(() => onlineApi().sites())
    .then(sites => {
      if (!sites.length) return
      CATSPIDER_SITES.value = sites
      // 首次加载启用全部非成人源，确保搜索和详情页不会只落到 fallback 的少数站点。
      // 成人源仍由 adultMode 控制，不会在普通模式下发起请求。
      selectedCatSpider.value = planCatSpiderSelection({
        sites,
        stored: selectedCatSpider.value,
        hasStored: localStorage.getItem(CATSPIDER_SELECTION_KEY) !== null,
        fallbackApis: FALLBACK_CATSPIDER_SITES.map(site => site.api),
        adultSeeded: localStorage.getItem(AV_PLUGIN_SEED_KEY) === '1',
      })
      if (localStorage.getItem(AV_PLUGIN_SEED_KEY) !== '1')
        localStorage.setItem(AV_PLUGIN_SEED_KEY, '1')
    })
    .catch(() => {
      catSpiderLoadPromise = null
      // 后端恢复后允许重试配置加载。
    })

  return catSpiderLoadPromise
}

/** 启用 / 停用一个插件站点。 */
export const toggleCatSpider = (api: string): void => {
  const idx = selectedCatSpider.value.indexOf(api)
  if (idx >= 0) selectedCatSpider.value.splice(idx, 1)
  else selectedCatSpider.value.push(api)
}

export { isAdultCatSpiderSite }

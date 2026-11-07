import { useStorage } from '@vueuse/core'
import { type ComputedRef, computed } from 'vue'

import cmsSnapshot from '../../../../../shared/online/cms-snapshot.json'
import {
  cmsApiKey,
  isOrdinaryCmsSource,
} from '../../../../../shared/online/ordinary-cms'

export interface AvSite {
  name: string
  api: string
}

const AV_SOURCES: AvSite[] = [
  { name: '森林资源', api: 'https://slapibf.com/api.php/provide/vod/' },
  { name: '探探资源', api: 'https://apittzy.com/api.php/provide/vod/' },
  { name: '奥斯卡资源', api: 'https://aosikazy.com/api.php/provide/vod/' },
  { name: '老鸭资源', api: 'https://api.apilyzy.com/api.php/provide/vod/' },
  { name: '皇冠', api: 'https://hghhh.com/api.php/provide/vod/' },
  { name: '91麻豆', api: 'https://91md.me/api.php/provide/vod/' },
  { name: '易看资源', api: 'https://api.yikanapi.com/api.php/provide/vod/' },
  { name: '番号资源', api: 'http://fhapi9.com/api.php/provide/vod/' },
  { name: '鲨鱼资源', api: 'https://shayuapi.com/api.php/provide/vod/' },
  { name: 'KK写真', api: 'https://kkzy.me/api.php/provide/vod/' },
  { name: 'AIvin', api: 'http://lbapiby.com/api.php/provide/vod/at/json' },
  { name: '好色资源', api: 'https://haosezyw.com/api.php/provide/vod/' },
  { name: '最色资源', api: 'https://zszyw.top/api.php/provide/vod/' },
  { name: '色色虎资源', api: 'https://apisesehuzy.com/api.php/provide/vod/' },
  { name: '黄瓜资源', api: 'https://www.zy018.com/api.php/provide/vod/' },
  { name: '玉兔资源', api: 'https://apiyutu.com/api.php/provide/vod/' },
  { name: '麻豆视频', api: 'http://www.madouse.la/api.php/provide/vod/' },
  { name: '辣椒资源', api: 'https://apilj.com/api.php/provide/vod/' },
  { name: '甜蜜资源', api: 'https://timizy10.cc/api.php/provide/vod/' },
  { name: '奶香香', api: 'https://Naixxzy.com/api.php/provide/vod/' },
  { name: '精品资源', api: 'https://www.jingpinx.com/api.php/provide/vod/' },
  { name: '草榴资源', api: 'https://www.caoliuzyw.com/api.php/prodao/vod/' },
  { name: '老色逼资源', api: 'https://apilsbzy1.com/api.php/provide/vod/' },
]

const remoteAvSources = useStorage<AvSite[]>('av_remote_sources', [])

/** 随包普通影视源快照：误入 AV 远程列表的同名 / 同 API 源要从 AV 清掉。 */
const ORDINARY_CMS = (cmsSnapshot as { sites: AvSite[] }).sites
const ordinaryRemote = remoteAvSources.value.filter(source =>
  isOrdinaryCmsSource(source, ORDINARY_CMS)
)
const ordinaryRemoteApis = new Set(
  ordinaryRemote.map(source => cmsApiKey(source.api))
)
if (ordinaryRemote.length) {
  remoteAvSources.value = remoteAvSources.value.filter(
    source => !ordinaryRemoteApis.has(cmsApiKey(source.api))
  )
}

// 持久化启用的站点列表（默认全部启用）
const enabledApiList = useStorage<string[]>(
  'av_enabled_sites',
  AV_SOURCES.map(s => s.api)
)
if (ordinaryRemoteApis.size) {
  enabledApiList.value = enabledApiList.value.filter(
    api => !ordinaryRemoteApis.has(cmsApiKey(api))
  )
}

/** 已启用的 AV 源（按 api 地址），像 Set 一样增删查 */
export interface EnabledApis {
  has: (api: string) => boolean
  add: (api: string) => void
  delete: (api: string) => void
}

/** AV CMS 源清单与启用状态 */
export interface UseAvSourcesReturn {
  enabledApis: EnabledApis
  getActiveSources: () => AvSite[]
  activeSources: ComputedRef<AvSite[]>
  allSources: ComputedRef<AvSite[]>
  addSources: (sources: AvSite[]) => number
}

export function useAvSources(): UseAvSourcesReturn {
  const enabledApis: EnabledApis = {
    has: (api: string) => enabledApiList.value.includes(api),
    add: (api: string) => {
      if (!enabledApiList.value.includes(api)) enabledApiList.value.push(api)
    },
    delete: (api: string) => {
      enabledApiList.value = enabledApiList.value.filter(a => a !== api)
    },
  }

  // 响应式的启用站点列表
  const activeSources = computed(() =>
    [...AV_SOURCES, ...remoteAvSources.value].filter(s =>
      enabledApiList.value.includes(s.api)
    )
  )

  const allSources = computed(() => [...AV_SOURCES, ...remoteAvSources.value])
  const addSources = (sources: AvSite[]): number => {
    const known = new Set(allSources.value.map(source => cmsApiKey(source.api)))
    const additions = sources.filter(
      source =>
        source.api &&
        !known.has(cmsApiKey(source.api)) &&
        !isOrdinaryCmsSource(source, ORDINARY_CMS)
    )
    if (additions.length) {
      remoteAvSources.value = [...remoteAvSources.value, ...additions]
      additions.forEach(source => enabledApiList.value.push(source.api))
    }
    return additions.length
  }

  // 获取当前启用的站点（非响应式快照，兼容旧调用）
  const getActiveSources = (): AvSite[] => activeSources.value

  return {
    enabledApis,
    getActiveSources,
    activeSources,
    allSources,
    addSources,
  }
}

import { ref } from 'vue'
import { useStorage } from '@vueuse/core'
import axios from 'axios'
import cmsSitesRaw from '../../../../../../cms-sites.json'

export interface CmsSource {
  source_name: string
  api_url: string
  vod_id: number
}

export interface CmsItem {
  vod_id: number
  vod_name: string
  type_name: string
  vod_year: string
  vod_remarks: string
  vod_pic: string
  vod_play_url?: string
  vod_play_from?: string
  source_name?: string
  api_url?: string
  sources?: CmsSource[]
}

export interface EpisodeGroup {
  label: string
  episodes: { name: string; url: string }[]
  hasDirect: boolean
}

export interface ApiSite {
  name: string
  api: string
}

export const DEFAULT_SITES: ApiSite[] = (cmsSitesRaw as { sites: ApiSite[] }).sites

// ── 模块级单例：useStorage 自动持久化到 localStorage ──────────
// selectedApis: 已启用站点的 api 字符串数组
const selectedApis = useStorage<string[]>(
  'online_selected_sites',
  DEFAULT_SITES.map(s => s.api),
)
// customSites: 自定义站点列表
const customSites = useStorage<ApiSite[]>('online_custom_sites', [])

// selectedSites: Set 视图，供模板 .has() 判断；通过下方函数修改
const selectedSites = {
  has: (api: string) => selectedApis.value.includes(api),
  add: (api: string) => {
    if (!selectedApis.value.includes(api)) selectedApis.value.push(api)
  },
  delete: (api: string) => {
    selectedApis.value = selectedApis.value.filter(a => a !== api)
  },
}

export function useOnlineSearch() {
  const keyword = ref('')
  const results = ref<CmsItem[]>([])
  const loading = ref(false)
  const error = ref('')

  const activeSites = (): ApiSite[] => {
    const all = [...DEFAULT_SITES, ...customSites.value]
    return all.filter(s => selectedSites.has(s.api))
  }

  const search = async (kw?: string): Promise<void> => {
    const q = (kw ?? keyword.value).trim()
    if (!q) return
    keyword.value = q
    loading.value = true
    error.value = ''
    results.value = []

    const sites = activeSites()
    if (!sites.length) {
      error.value = '请至少选择一个数据源'
      loading.value = false
      return
    }

    const tasks = sites.map(async (site) => {
      try {
        const url = `${site.api}?ac=videolist&wd=${encodeURIComponent(q)}`
        const data = await axios.get(url, { timeout: 10000 }).then(r => r.data)
        if (!data?.list) return []
        return (data.list as CmsItem[]).map(item => ({
          ...item,
          source_name: site.name,
          api_url: site.api,
        }))
      } catch {
        return []
      }
    })

    const allResults = (await Promise.all(tasks)).flat()

    // 按 vod_name 去重合并，保留所有源
    const nameMap = new Map<string, CmsItem>()
    for (const item of allResults) {
      const key = item.vod_name.trim()
      if (!nameMap.has(key)) {
        nameMap.set(key, {
          ...item,
          sources: [{ source_name: item.source_name!, api_url: item.api_url!, vod_id: item.vod_id }],
        })
      } else {
        nameMap.get(key)!.sources!.push({ source_name: item.source_name!, api_url: item.api_url!, vod_id: item.vod_id })
      }
    }
    results.value = Array.from(nameMap.values())
    loading.value = false
  }

  const parseGroups = (detail: CmsItem, siteName: string): EpisodeGroup[] => {
    if (!detail?.vod_play_url) return []
    const fromNames = (detail.vod_play_from || '').split('$$$')
    const playSources = detail.vod_play_url.split('$$$')

    return playSources.map((source, i) => {
      const episodeList = source.split('#').filter(Boolean)
      const episodes = episodeList.map((ep, j) => {
        const parts = ep.split('$')
        const url = parts.length > 1 ? parts[1] : ''
        const name = parts[0] || `第${j + 1}集`
        return { name, url }
      }).filter(e => e.url.startsWith('http://') || e.url.startsWith('https://'))

      const fromLabel = fromNames[i]?.trim()
      const label = playSources.length > 1
        ? `${siteName}-${fromLabel || i + 1}`
        : siteName
      const hasDirect = episodes.some(e => e.url.includes('.m3u8') || e.url.includes('.mp4'))
      return { label, episodes, hasDirect }
    }).filter(g => g.episodes.length && g.hasDirect)
  }

  const fetchDetail = async (item: CmsItem): Promise<EpisodeGroup[]> => {
    const sources = item.sources?.length
      ? item.sources
      : item.api_url ? [{ source_name: item.source_name || '未知', api_url: item.api_url, vod_id: item.vod_id }] : []
    if (!sources.length) return []

    const tasks = sources.map(async (src) => {
      try {
        const url = `${src.api_url}?ac=videolist&ids=${src.vod_id}`
        const data = await axios.get(url, { timeout: 10000 }).then(r => r.data)
        return parseGroups(data?.list?.[0], src.source_name)
      } catch {
        return []
      }
    })

    const allGroups = (await Promise.all(tasks)).flat()
    allGroups.sort((a, b) => (b.hasDirect ? 1 : 0) - (a.hasDirect ? 1 : 0))
    return allGroups
  }

  return {
    keyword,
    results,
    loading,
    error,
    selectedSites,
    customSites,
    DEFAULT_SITES,
    search,
    fetchDetail,
  }
}

import { ref } from 'vue'
import { useStorage } from '@vueuse/core'
import axios from 'axios'
import cmsSitesRaw from '../../../../../../cms-sites.json'
import { useVODParser } from '@/composables/use-vod-parser'

export interface CmsSource {
  source_name: string
  api_url: string
  vod_id: number | string
}

export interface CmsItem {
  vod_id: number | string
  vod_name: string
  type_name: string
  vod_year: string
  vod_remarks: string
  vod_pic: string
  vod_play_url?: string
  vod_play_from?: string
  vod_content?: string
  source_name?: string
  api_url?: string
  sources?: CmsSource[]
  _source?: 'cms' | 'catspider'
  _siteName?: string
  _ext?: Record<string, any>
}

export interface EpisodeGroup {
  label: string
  episodes: { name: string; url: string; ext?: Record<string, any> }[]
  hasDirect: boolean
  _source?: 'cms' | 'catspider'
  _siteName?: string
}

export interface ApiSite {
  name: string
  api: string
}

export interface CatSpiderSite {
  name: string
  type: number
  api: string
  ext: string
}

export const DEFAULT_SITES: ApiSite[] = (cmsSitesRaw as { sites: ApiSite[] })
  .sites

// ── CatSpider sites from vod.json ──────────────────────────
const CATSPIDER_SITES: CatSpiderSite[] = [
  { name: '茶杯狐', type: 3, api: 'csp_cupfox', ext: 'https://ghp.xptvhelper.link/https://raw.githubusercontent.com/Yswag/xptv-extensions/refs/heads/main/js/cupfox.js' },
]

const selectedCatSpider = useStorage<string[]>('online_selected_catspider', CATSPIDER_SITES.map(s => s.api))

// ── 模块级单例：useStorage 自动持久化到 localStorage ──────────
// selectedApis: 已启用站点的 api 字符串数组
const selectedApis = useStorage<string[]>(
  'online_selected_sites',
  DEFAULT_SITES.map(s => s.api)
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
  const { search: vodSearch, getTracks, getPlayinfo } = useVODParser()

  const activeSites = (): ApiSite[] => {
    const all = [...DEFAULT_SITES, ...customSites.value]
    return all.filter(s => selectedSites.has(s.api))
  }

  const activeCatSpiderSites = (): CatSpiderSite[] => {
    return CATSPIDER_SITES.filter(s => selectedCatSpider.value.includes(s.api))
  }

  const search = async (kw?: string): Promise<void> => {
    const q = (kw ?? keyword.value).trim()
    if (!q) return
    keyword.value = q
    loading.value = true
    error.value = ''
    results.value = []

    // ── CMS sites search ──────────────────────────────
    const cmsSites = activeSites()
    const cmsTasks = cmsSites.map(async site => {
      try {
        const url = `${site.api}?ac=videolist&wd=${encodeURIComponent(q)}`
        const data = await axios.get(url, { timeout: 10000 }).then(r => r.data)
        if (!data?.list) return []
        return (data.list as CmsItem[]).map(item => ({
          ...item,
          source_name: site.name,
          api_url: site.api,
          _source: 'cms' as const,
        }))
      } catch {
        return []
      }
    })

    // ── CatSpider sites search ────────────────────────
    const csSites = activeCatSpiderSites()
    const csTasks = csSites.map(async site => {
      try {
        const r = await vodSearch({ siteName: site.name, keyword: q })
        if (!r.success || !r.data) return []
        const list = r.data.list || r.data.data?.list || []
        return (list as any[]).map(item => ({
          vod_id: item.vod_id || item.ext?.url || '',
          vod_name: item.vod_name || '',
          type_name: item.type_name || '',
          vod_year: item.vod_year || '',
          vod_remarks: item.vod_remarks || '',
          vod_pic: item.vod_pic || '',
          vod_content: item.vod_desc || item.vod_content || '',
          source_name: site.name,
          api_url: site.api,
          _source: 'catspider' as const,
          _siteName: site.name,
          _ext: item.ext || {},
        }))
      } catch {
        return []
      }
    })

    const [cmsResults, csResults] = await Promise.all([
      Promise.all(cmsTasks),
      Promise.all(csTasks),
    ])
    const allResults = [...cmsResults.flat(), ...csResults.flat()]

    // 直接返回所有结果，不去重合并
    results.value = allResults
    loading.value = false
  }

  const parseGroups = (detail: CmsItem, siteName: string): EpisodeGroup[] => {
    if (!detail?.vod_play_url) return []
    const fromNames = (detail.vod_play_from || '').split('$$$')
    const playSources = detail.vod_play_url.split('$$$')

    return playSources
      .map((source, i) => {
        const episodeList = source.split('#').filter(Boolean)
        const episodes = episodeList
          .map((ep, j) => {
            const parts = ep.split('$')
            const url = parts.length > 1 ? parts[1] : ''
            const name = parts[0] || `第${j + 1}集`
            return { name, url }
          })
          .filter(
            e => e.url.startsWith('http://') || e.url.startsWith('https://')
          )

        const fromLabel = fromNames[i]?.trim()
        const label =
          playSources.length > 1
            ? `${siteName}-${fromLabel || i + 1}`
            : siteName
        const hasDirect = episodes.some(
          e => e.url.includes('.m3u8') || e.url.includes('.mp4')
        )
        return { label, episodes, hasDirect, _source: 'cms' as const, _siteName: siteName }
      })
      .filter(g => g.episodes.length && g.hasDirect)
  }

  const fetchDetail = async (item: CmsItem): Promise<EpisodeGroup[]> => {
    // ── CatSpider items: use getTracks ──────────────────
    if (item._source === 'catspider' && item._siteName) {
      try {
        const ext = item._ext || {}
        const url = ext.url || String(item.vod_id)
        const r = await getTracks({ siteName: item._siteName, url, ...ext })
        if (!r.success || !r.data) return []
        const list = r.data.list || r.data.data?.list || []
        return (list as any[]).map((group: any) => ({
          label: group.name || group.title || item._siteName!,
          episodes: (group.tracks || group.list || []).map((ep: any) => ({
            name: ep.name || ep.title || '',
            url: ep.url || '',
            ext: ep.ext || {},
          })),
          hasDirect: true,
          _source: 'catspider' as const,
          _siteName: item._siteName,
        }))
      } catch {
        return []
      }
    }

    // ── CMS items: use detail API ──────────────────────
    const sources = item.sources?.length
      ? item.sources
      : item.api_url
        ? [
            {
              source_name: item.source_name || '未知',
              api_url: item.api_url,
              vod_id: item.vod_id,
            },
          ]
        : []
    if (!sources.length) return []

    const tasks = sources.map(async src => {
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

  /** Resolve a CatSpider episode URL to a playable m3u8/mp4 */
  const resolvePlayUrl = async (siteName: string, ext: Record<string, any>): Promise<string> => {
    try {
      const r = await getPlayinfo({ siteName, url: ext.url || '', ...ext })
      if (!r.success || !r.data) return ''
      const urls = r.data.urls || r.data.data?.urls || []
      return urls[0] || ''
    } catch {
      return ''
    }
  }

  return {
    keyword,
    results,
    loading,
    error,
    selectedSites,
    customSites,
    DEFAULT_SITES,
    CATSPIDER_SITES,
    selectedCatSpider,
    search,
    fetchDetail,
    resolvePlayUrl,
  }
}

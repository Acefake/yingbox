import { ref, getCurrentScope, onScopeDispose } from 'vue'
import { getBase } from '@/api/backend'
import { useStorage } from '@vueuse/core'
import axios from 'axios'
import cmsSitesRaw from '../../../../../../cms-sites.json'
import { useVODParser } from '@/composables/use-vod-parser'

const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> => {
  const output = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      output[index] = await mapper(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return output
}

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

// 后端不可用时仍可使用的精选源；完整列表由后端内嵌的 vod.json 提供。
const FALLBACK_CATSPIDER_SITES: CatSpiderSite[] = [
  { name: '茶杯狐', type: 3, api: 'csp_cupfox', ext: 'https://ghp.xptvhelper.link/https://raw.githubusercontent.com/Yswag/xptv-extensions/refs/heads/main/js/cupfox.js' },
  { name: '荐片', type: 3, api: 'csp_jianpian', ext: 'https://ghp.xptvhelper.link/https://raw.githubusercontent.com/Yswag/xptv-extensions/refs/heads/main/js/jianpian.js' },
  { name: 'NO視頻', type: 3, api: 'csp_novipnoad', ext: 'https://ghp.xptvhelper.link/https://raw.githubusercontent.com/Yswag/xptv-extensions/refs/heads/main/js/novipnoad.js' },
]

const CATSPIDER_SELECTION_KEY = 'online_selected_catspider'
export const CATSPIDER_SITES = ref<CatSpiderSite[]>([...FALLBACK_CATSPIDER_SITES])
const selectedCatSpider = useStorage<string[]>(
  CATSPIDER_SELECTION_KEY,
  FALLBACK_CATSPIDER_SITES.map(s => s.api)
)
const ADULT_CATSPIDER_APIS = new Set(['csp_avtoday', 'csp_jable', 'csp_hanime', 'csp_madou', 'csp_hkdoll'])
let catSpiderLoadPromise: Promise<void> | null = null

const isAdultCatSpiderSite = (site: CatSpiderSite): boolean =>
  ADULT_CATSPIDER_APIS.has(site.api)

/** 从后端读取完整 VOD 配置；只接入当前解析器支持的 CatSpider 类型。 */
export const loadCatSpiderSites = (): Promise<void> => {
  if (catSpiderLoadPromise) return catSpiderLoadPromise

  catSpiderLoadPromise = axios.get(`${getBase()}/api/vod/sites`, { timeout: 10000 })
    .then(response => {
      const sites = response.data?.config?.sites
      if (!Array.isArray(sites)) return
      const supportedSites = sites.filter((site: unknown): site is CatSpiderSite => {
        const candidate = site as Partial<CatSpiderSite>
        return candidate.type === 3 && typeof candidate.name === 'string' &&
          typeof candidate.api === 'string' && typeof candidate.ext === 'string'
      })
      if (!supportedSites.length) return

      CATSPIDER_SITES.value = supportedSites
      // 首次加载启用全部非成人源，确保搜索和详情页不会只落到 fallback 的少数站点。
      // 成人源仍由 adultMode 控制，不会在普通模式下发起请求。
      const configuredApis = supportedSites
        .filter(site => !isAdultCatSpiderSite(site))
        .map(site => site.api)
      const storedSelection = selectedCatSpider.value
      const isLegacyFallback = storedSelection.length === FALLBACK_CATSPIDER_SITES.length &&
        FALLBACK_CATSPIDER_SITES.every(site => storedSelection.includes(site.api))
      if (localStorage.getItem(CATSPIDER_SELECTION_KEY) === null || isLegacyFallback) {
        selectedCatSpider.value = configuredApis
      } else {
        // 清理已从后端配置移除的旧 api，同时保留用户新增的有效选择。
        selectedCatSpider.value = storedSelection.filter(api => supportedSites.some(site => site.api === api))
      }
    })
    .catch(() => {
      catSpiderLoadPromise = null
      // 后端恢复后允许重试配置加载。
    })

  return catSpiderLoadPromise
}

/** CatSpider 插件同时存在对象返回和 JSON 字符串返回两种实现。 */
const normalizeVodPayload = (payload: unknown): any => {
  let value: any = payload
  for (let i = 0; i < 2 && typeof value === 'string'; i++) {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  return value && typeof value === 'object' ? value : null
}

const getVodList = (payload: unknown): any[] => {
  const data = normalizeVodPayload(payload)
  if (!data) return []
  const nested = normalizeVodPayload(data.data)
  return Array.isArray(data.list) ? data.list : Array.isArray(nested?.list) ? nested.list : []
}

// ── 模块级单例：useStorage 自动持久化到 localStorage ──────────
// selectedApis: 已启用站点的 api 字符串数组
const selectedApis = useStorage<string[]>(
  'online_selected_sites',
  DEFAULT_SITES.map(s => s.api)
)
// 旧版内置源改为资源站标准名称/地址后，迁移用户之前保存的启用状态。
const CMS_API_MIGRATIONS: Record<string, string> = {
  'https://hhzyapi.com/api.php/provide/vod': 'https://haohuazy.com/api.php/provide/vod/',
  'https://www.hongniuzy2.com/api.php/provide/vod': 'http://hongniuzy2.com/api.php/provide/vod/',
  'https://www.huyaapi.com/api.php/provide/vod': 'https://huyazy.net/api.php/provide/vod/',
  'https://api.guangsuapi.com/api.php/provide/vod': 'https://api.guangsuapi.com/api.php/provide/vod/',
  'https://api.wujinzy.com/api.php/provide/vod': 'https://api.wujinapi.me/api.php/provide/vod/',
}
selectedApis.value = Array.from(new Set(selectedApis.value.map(api => CMS_API_MIGRATIONS[api] || api)))
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
  let generation = 0
  let searchController: AbortController | null = null
  if (getCurrentScope()) onScopeDispose(() => { generation++; searchController?.abort() })

  const activeSites = (): ApiSite[] => {
    const all = [...DEFAULT_SITES, ...customSites.value]
    return all.filter(s => selectedSites.has(s.api))
  }

  const activeCatSpiderSites = (): CatSpiderSite[] => {
    const adultMode = localStorage.getItem('adultMode') === '1'
    return CATSPIDER_SITES.value.filter(site =>
      selectedCatSpider.value.includes(site.api) &&
      (adultMode || !isAdultCatSpiderSite(site))
    )
  }

  const search = async (
    kw?: string,
    options: { allVod?: boolean; onItems?: (items: CmsItem[]) => void } = {},
  ): Promise<void> => {
    const q = (kw ?? keyword.value).trim()
    if (!q) return
    const requestId = ++generation
    searchController?.abort()
    const controller = new AbortController()
    searchController = controller
    const current = () => requestId === generation && !controller.signal.aborted
    keyword.value = q
    loading.value = true
    error.value = ''
    results.value = []
    const publish = (items: CmsItem[]) => {
      if (!current() || !items.length) return
      results.value = [...results.value, ...items]
      options.onItems?.(items)
    }

    // 搜索页可能是应用启动后的第一个入口，必须先加载完整 VOD 配置，
    // 否则只会使用 3 个 fallback 源，表现为“详情只有荐片”。
    try {
    await loadCatSpiderSites()
    if (!current()) return

    // ── CMS sites search ──────────────────────────────
    const cmsSites = activeSites()
    const cmsTasks = mapWithConcurrency(cmsSites, 6, async site => {
      if (!current()) return []
      try {
        const url = new URL(site.api)
        url.searchParams.set('ac', 'videolist')
        url.searchParams.set('wd', q)
        const data = await axios.get(String(url), { timeout: 10000, signal: controller.signal }).then(r => r.data)
        if (!Array.isArray(data?.list)) return []
        const items = (data.list as CmsItem[]).map(item => ({
          ...item,
          source_name: site.name,
          api_url: site.api,
          _source: 'cms' as const,
        }))
        publish(items)
        return items
      } catch {
        return []
      }
    })

    // ── CatSpider sites search ────────────────────────
    // 详情页需要跨源聚合，即使用户在搜索页只勾选了少数源，也要尝试全部非成人 VOD 源。
    const csSites = options.allVod
      ? CATSPIDER_SITES.value.filter(site => !isAdultCatSpiderSite(site))
      : activeCatSpiderSites()
    const csTasks = mapWithConcurrency(csSites, 4, async site => {
      if (!current()) return []
      try {
        const r = await vodSearch({ siteName: site.name, keyword: q }, controller.signal)
        if (!r.success || !r.data) return []
        const list = getVodList(r.data)
        const items = (list as any[]).map(item => ({
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
        publish(items)
        return items
      } catch {
        return []
      }
    })

    const [cmsResults, csResults] = await Promise.all([cmsTasks, csTasks])
    const allResults = [...cmsResults.flat(), ...csResults.flat()]

    // 直接返回所有结果，不去重合并
    if (current()) results.value = allResults
    } catch (cause) {
      if (current()) error.value = cause instanceof Error ? cause.message : '搜索失败'
    } finally {
      if (requestId === generation) loading.value = false
    }
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
        // 很多站点返回的是无扩展名的播放接口或带签名参数的地址，
        // 不能只靠 .m3u8/.mp4 后缀判断是否可播放。
        const hasDirect = episodes.some(e => /^https?:\/\//i.test(e.url))
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
        const r = await getTracks({ siteName: item._siteName, url, ...ext, id: ext.id ?? item.vod_id })
        if (!r.success || !r.data) return []
        const list = getVodList(r.data)
        const groups: EpisodeGroup[] = []
        for (const group of list as any[]) {
          // Case A: group has tracks[] (茶杯狐 etc.)
          if (Array.isArray(group.tracks) && group.tracks.length) {
            groups.push({
              label: group.name || group.title || item._siteName!,
              episodes: group.tracks.map((ep: any) => {
                const ext = ep.ext || {}
                const url = ep.url || ext.url || ''
                return {
                  name: ep.name || ep.title || '',
                  url,
                  // 保留插件需要的 id、referer 等字段，同时确保直链可回退播放。
                  ext: { ...ext, url: ext.url || url },
                }
              }),
              hasDirect: true,
              _source: 'catspider' as const,
              _siteName: item._siteName,
            })
          // Case B: group itself has vod_play_url (荐片 Apple CMS format)
          } else if (group.vod_play_url) {
            const fromNames = (group.vod_play_from || '').split('$$$')
            const playSources = (group.vod_play_url as string).split('$$$')
            playSources.forEach((src, i) => {
              const episodes = src.split('#').filter(Boolean).map((ep, j) => {
                const parts = ep.split('$')
                const epUrl = parts.length > 1 ? parts[1] : ''
                return { name: parts[0] || `第${j + 1}集`, url: epUrl, ext: {} }
              }).filter(e => e.url.startsWith('http'))
              if (!episodes.length) return
              const fromLabel = fromNames[i]?.trim()
              const label = playSources.length > 1
                ? `${item._siteName}-${fromLabel || i + 1}`
                : (fromLabel || item._siteName!)
              groups.push({
                label,
                episodes,
                hasDirect: true,
                _source: 'catspider' as const,
                _siteName: item._siteName,
              })
            })
          // Case C: group has list[] of episodes
          } else if (Array.isArray(group.list) && group.list.length) {
            groups.push({
              label: group.name || group.title || item._siteName!,
              episodes: group.list.map((ep: any) => ({
                name: ep.name || ep.title || '',
                url: ep.url || '',
                ext: ep.ext || {},
              })),
              hasDirect: true,
              _source: 'catspider' as const,
              _siteName: item._siteName,
            })
          }
        }
        return groups
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

  /** Resolve a CatSpider episode URL to a playable m3u8/mp4
   *  将完整的 ext 传给后端，让插件自行提取所需参数（url/vid/pkey/ref 等）
   */
  const resolvePlayUrl = async (siteName: string, ext: Record<string, any>): Promise<string> => {
    try {
      const r = await getPlayinfo({
        siteName,
        url: ext.url || '',
        ...ext,
      })
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
    loadCatSpiderSites,
    isAdultCatSpiderSite,
    activeCatSpiderSites,
    search,
    fetchDetail,
    resolvePlayUrl,
  }
}

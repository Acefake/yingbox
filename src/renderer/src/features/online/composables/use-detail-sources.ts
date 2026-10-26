/**
 * 在线详情页的播放源：打开详情时命中的来源与按片名的全源搜索同时开始，
 * 每个站点只取最匹配的一条去查线路，任一来源返回即展示。
 * 选择分三层：来源类型（插件 / CMS）→ 站点 → 线路。
 * 自动选源：站点出现即测速（useSourceProbe），列表按速度排序；没手动选过时默认排第一（最快）的源，
 * 用户手动选过的源对该片优先（持久化在 online_source_picks）。站点按名字记选中，排序变化不跳。
 */
import { type ComputedRef, type Ref, computed, ref } from 'vue'
import { readStoredArray, saveStoredArray } from '@/utils/storage'
import type { CmsItem, Episode, EpisodeGroup } from '../types'
import {
  type SourceProbe,
  findPick,
  isSourcePick,
  mergePick,
  rankSites,
} from '../utils/auto-source'
import {
  type SiteGroup,
  type SourceType,
  groupBySite,
  normalizeTitle,
  preferredSourceType,
  sourceKey,
  sourceTypeOptions,
  splitBySourceType,
  titleMatches,
} from '../utils/detail-sources'
import { useOnlineSearch } from './use-online-search'
import { useSourceProbe } from './use-source-probe'

const PICKS_KEY = 'online_source_picks'

/** 详情页播放源：三层选择（来源类型 → 站点 → 线路）的状态与操作 */
export interface UseDetailSourcesReturn {
  searching: Ref<boolean>
  episodeGroups: Ref<EpisodeGroup[]>
  currentSourceType: Ref<SourceType>
  typeOptions: ComputedRef<{ value: SourceType; label: string }[]>
  siteGroups: ComputedRef<SiteGroup[]>
  activeSite: ComputedRef<number>
  activeLine: Ref<number>
  currentLine: ComputedRef<EpisodeGroup | undefined>
  currentEpisodes: ComputedRef<Episode[]>
  currentSiteName: ComputedRef<string>
  /** 站点名 → 测速状态 */
  probes: Ref<Record<string, SourceProbe>>
  probing: ComputedRef<boolean>
  load: (directItem: CmsItem | null, searchTitle: string) => Promise<void>
  switchSourceType: (type: SourceType) => void
  switchSite: (index: number) => void
  switchLine: (index: number) => void
  /** 全部源重新测速 */
  reprobe: () => void
}

export function useDetailSources(): UseDetailSourcesReturn {
  const { fetchDetail, keyword, search } = useOnlineSearch()
  const searching = ref(false)
  const episodeGroups = ref<EpisodeGroup[]>([])
  const currentSourceType = ref<SourceType>('cms')
  const activeGroup = ref(0)
  /** 选中的站点名；空串 = 没选，跟随排第一（最快）的源 */
  const activeSiteName = ref('')
  const activeLine = ref(0)
  /** 当前影片（归一化片名）与它手动选过的源 */
  let film = ''
  let pickedSite = ''
  let loadGeneration = 0
  const probe = useSourceProbe()

  const split = computed(() => splitBySourceType(episodeGroups.value))
  const typeOptions = computed(() =>
    sourceTypeOptions(split.value.catspider.length, split.value.cms.length)
  )
  const siteGroups = computed(() =>
    rankSites(
      groupBySite(split.value[currentSourceType.value]),
      probe.probes.value
    )
  )
  const activeSite = computed(() =>
    Math.max(
      0,
      siteGroups.value.findIndex(sg => sg.siteName === activeSiteName.value)
    )
  )
  const currentLine = computed(() => {
    const lines = siteGroups.value[activeSite.value]?.lines || []
    return lines[activeLine.value] || lines[0]
  })
  const currentEpisodes = computed(() => currentLine.value?.episodes || [])
  /** 插件线路解析播放地址时需要的站点名（CMS 为空）。 */
  const currentSiteName = computed(() =>
    currentSourceType.value === 'catspider'
      ? currentLine.value?._siteName ||
        split.value.catspider[activeGroup.value]?._siteName ||
        ''
      : ''
  )

  /** 按片名加载播放源；directItem 是打开详情时命中的那条（可为空）。 */
  const load = async (
    directItem: CmsItem | null,
    searchTitle: string
  ): Promise<void> => {
    // 换条目时上一部的线路请求可能还在路上：只认最后一次 load，旧结果不混进新条目的线路
    const mine = ++loadGeneration
    const stale = (): boolean => mine !== loadGeneration
    searching.value = true
    episodeGroups.value = []
    activeGroup.value = 0
    probe.reset()
    film = normalizeTitle(searchTitle)
    pickedSite = findPick(readStoredArray(PICKS_KEY, isSourcePick), film)
    activeSiteName.value = pickedSite
    activeLine.value = 0
    try {
      const targetTitle = normalizeTitle(searchTitle)
      const seen = new Set<string>()
      const pending = new Set<Promise<void>>()
      const appendDetail = (candidate: CmsItem): void => {
        const key = sourceKey(candidate)
        if (seen.has(key)) return
        seen.add(key)
        const task = fetchDetail(candidate)
          .then(groups => {
            if (stale()) return
            const available = groups.filter(group => group.episodes?.length)
            if (!available.length) return
            const hadGroups = episodeGroups.value.length > 0
            episodeGroups.value = [...episodeGroups.value, ...available]
            probe.probeSites(groupBySite(available))
            if (!hadGroups)
              currentSourceType.value = preferredSourceType(available)
          })
          .catch(() => undefined)
        pending.add(task)
        void task.finally(() => pending.delete(task))
      }

      if (directItem) appendDetail(directItem)
      keyword.value = searchTitle
      // 详情页只查询用户已启用的插件源，避免强制遍历整份插件清单导致长时间转圈。
      await search(searchTitle, {
        allVod: false,
        onItems: items => {
          if (stale()) return
          for (const result of items) {
            const title = normalizeTitle(result.vod_name)
            if (titleMatches(title, targetTitle)) appendDetail(result)
          }
        },
      })
      // 搜索结束后仍可能有详情请求在路上，等待它们完成以准确结束加载状态。
      await Promise.all([...pending])
      if (!stale())
        currentSourceType.value = preferredSourceType(episodeGroups.value)
    } catch {
      /* silent */
    } finally {
      if (!stale()) searching.value = false
    }
  }

  const switchSourceType = (type: SourceType): void => {
    currentSourceType.value = type
    activeGroup.value = 0
    activeSiteName.value = pickedSite
    activeLine.value = 0
  }
  /** 手动选源：记住选中的站点名，并作为该片的优先源持久化 */
  const switchSite = (index: number): void => {
    const name = siteGroups.value[index]?.siteName || ''
    activeSiteName.value = name
    activeLine.value = 0
    activeGroup.value = 0
    if (!film || !name) return
    pickedSite = name
    saveStoredArray(
      PICKS_KEY,
      mergePick(readStoredArray(PICKS_KEY, isSourcePick), {
        film,
        site: name,
        at: Date.now(),
      })
    )
  }
  /** 选线路时把站点也固定下来，测速排序变化不会换到别的站点 */
  const switchLine = (index: number): void => {
    activeSiteName.value = siteGroups.value[activeSite.value]?.siteName || ''
    activeLine.value = index
  }
  const reprobe = (): void => {
    probe.probeSites(groupBySite(episodeGroups.value), true)
  }

  return {
    searching,
    episodeGroups,
    currentSourceType,
    typeOptions,
    siteGroups,
    activeSite,
    activeLine,
    currentLine,
    currentEpisodes,
    currentSiteName,
    probes: probe.probes,
    probing: probe.probing,
    load,
    switchSourceType,
    switchSite,
    switchLine,
    reprobe,
  }
}

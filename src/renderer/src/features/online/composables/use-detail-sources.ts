/**
 * 在线详情页的播放源：打开详情时命中的来源与按片名的全源搜索同时开始，
 * 每个站点只取最匹配的一条去查线路，任一来源返回即展示。
 * 选择分三层：来源类型（插件 / CMS）→ 站点 → 线路。
 */
import { computed, ref } from 'vue'
import type { CmsItem, EpisodeGroup } from '../types'
import {
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

export function useDetailSources() {
  const { fetchDetail, keyword, search } = useOnlineSearch()
  const searching = ref(false)
  const episodeGroups = ref<EpisodeGroup[]>([])
  const currentSourceType = ref<SourceType>('cms')
  const activeGroup = ref(0)
  const activeSite = ref(0)
  const activeLine = ref(0)

  const split = computed(() => splitBySourceType(episodeGroups.value))
  const typeOptions = computed(() =>
    sourceTypeOptions(split.value.catspider.length, split.value.cms.length)
  )
  const siteGroups = computed(() =>
    groupBySite(split.value[currentSourceType.value])
  )
  const currentLine = computed(
    () => siteGroups.value[activeSite.value]?.lines[activeLine.value]
  )
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
    searching.value = true
    episodeGroups.value = []
    activeGroup.value = 0
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
            const available = groups.filter(group => group.episodes?.length)
            if (!available.length) return
            const hadGroups = episodeGroups.value.length > 0
            episodeGroups.value = [...episodeGroups.value, ...available]
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
          for (const result of items) {
            const title = normalizeTitle(result.vod_name)
            if (titleMatches(title, targetTitle)) appendDetail(result)
          }
        },
      })
      // 搜索结束后仍可能有详情请求在路上，等待它们完成以准确结束加载状态。
      await Promise.all([...pending])
      currentSourceType.value = preferredSourceType(episodeGroups.value)
    } catch {
      /* silent */
    } finally {
      searching.value = false
      activeSite.value = 0
      activeLine.value = 0
    }
  }

  const switchSourceType = (type: SourceType): void => {
    currentSourceType.value = type
    activeGroup.value = 0
    activeSite.value = 0
    activeLine.value = 0
  }
  const switchSite = (index: number): void => {
    activeSite.value = index
    activeLine.value = 0
    activeGroup.value = 0
  }
  const switchLine = (index: number): void => {
    activeLine.value = index
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
    load,
    switchSourceType,
    switchSite,
    switchLine,
  }
}

import { toast } from '@/components/ui'
import { getSetting } from '@/features/settings'
import { computed, reactive, ref } from 'vue'
import { getJson } from '../api/online'
import { useAvSources } from '@/features/av'
import {
  DEFAULT_SITES,
  loadCatSpiderSites,
  useOnlineSearch,
} from './use-online-search'

import type { SiteStatus } from '../utils/source-rules'
export type { SiteStatus }

const { selectedSites, customSites } = useOnlineSearch()
const { allSources: avSources, addSources: addAvSources } = useAvSources()

// ── 检测状态（模块级单例，数据源面板与启动刷新共用）──────────
export const statusMap = reactive<Record<string, SiteStatus>>({})
export const checkingSet = reactive<Set<string>>(new Set())
export const avStatusMap = reactive<Record<string, SiteStatus>>({})
export const avCheckingSet = reactive<Set<string>>(new Set())
export const syncingAv = ref(false)
export const checkingAll = ref(false)
export const checkedCount = ref(0)

export const statusOf = (api: string): SiteStatus => statusMap[api] ?? 'unknown'
export const avStatusOf = (api: string): SiteStatus =>
  avStatusMap[api] ?? 'unknown'

export const onlineApis = computed(() => [
  ...DEFAULT_SITES.map(site => site.api),
  ...customSites.value.map(site => site.api),
])

export const checkOnlineSite = async (api: string): Promise<void> => {
  if (checkingSet.has(api)) return
  checkingSet.add(api)
  statusMap[api] = 'checking'
  try {
    const data = await getJson<{ list?: unknown }>(
      `${api}?ac=videolist&wd=test`,
      { timeoutMs: 8000 }
    )
    statusMap[api] = data?.list !== undefined ? 'ok' : 'fail'
  } catch {
    statusMap[api] = 'fail'
  } finally {
    checkingSet.delete(api)
  }
}

export const checkAvSite = async (api: string): Promise<void> => {
  if (avCheckingSet.has(api)) return
  avCheckingSet.add(api)
  avStatusMap[api] = 'checking'
  try {
    const data = await getJson<{ list?: unknown }>(`${api}?ac=detail`, {
      timeoutMs: 8000,
    })
    avStatusMap[api] = data?.list !== undefined ? 'ok' : 'fail'
  } catch {
    avStatusMap[api] = 'fail'
  } finally {
    avCheckingSet.delete(api)
  }
}

/**
 * 检测全部源，只写状态。AV 源仅在成人模式下参与。
 *
 * 探测结果不代表用户意愿：连不上可能只是对方临时挂了、被墙，或者本机网络受限。
 * 早先这里会按结果 add/delete 用户的启用集合，于是每次启动都会静默改写用户手选的数据源，
 * 连得上的被强行开启、连不上的被删除——用户看到的就是“设置又自己变回去了”。
 * 启用与否归用户（数据源面板），这里只负责把状态显示出来。
 */
export const checkAll = async (): Promise<void> => {
  if (checkingAll.value) return
  checkingAll.value = true
  checkedCount.value = 0
  try {
    const onlineTasks = onlineApis.value.map(api =>
      checkOnlineSite(api).then(() => {
        checkedCount.value++
      })
    )
    const includesAv = getSetting('app.adultMode')
    const avTasks = includesAv
      ? avSources.value.map(site =>
          checkAvSite(site.api).then(() => {
            checkedCount.value++
          })
        )
      : []
    await Promise.all([...onlineTasks, ...avTasks])
  } finally {
    checkingAll.value = false
  }
}

const ORDINARY_CMS_NAMES =
  /^(?:无尽|豪华|红牛|极速|虎牙|速播|樱花|光速)资源站?$/

/** 拉取远程清单并合并新源；远程清单混合普通 CMS 与 AV 源，按名称分流。 */
export const syncAvSources = async (showMessage = true): Promise<void> => {
  syncingAv.value = true
  try {
    const response = await getJson<{ data?: unknown }>(
      'https://mylazily.github.io/ziyuanzhan/data/online.json',
      { timeoutMs: 15000 }
    )
    const entries = Array.isArray(response?.data) ? response.data : []
    const sources = entries
      .map((entry: any) => {
        const name = String(entry.name || entry.title || '在线资源站').trim()
        const api = String(entry.api || entry.url || entry.link || '').trim()
        return { name, api }
      })
      .filter(
        (source: { name: string; api: string }) =>
          /^https?:\/\//i.test(source.api) &&
          /(?:api\.php\/provide\/vod|api\/json\.php)/i.test(source.api)
      )
    // 远程清单混合了普通 CMS 与 AV 源；先按站点名称分流，避免普通源落入 AV 标签。
    const ordinaryCmsSources = sources.filter(source =>
      ORDINARY_CMS_NAMES.test(source.name)
    )
    const avOnlySources = sources.filter(
      source => !ORDINARY_CMS_NAMES.test(source.name)
    )
    const knownCmsApis = new Set(DEFAULT_SITES.map(site => site.api))
    let addedCms = 0
    for (const source of ordinaryCmsSources) {
      if (
        knownCmsApis.has(source.api) ||
        customSites.value.some(site => site.api === source.api)
      )
        continue
      customSites.value = [...customSites.value, source]
      selectedSites.add(source.api)
      addedCms++
    }
    const added = addAvSources(avOnlySources)
    const sourceApis = new Set(avOnlySources.map(source => source.api))
    const movedOnlineSources = customSites.value.filter(source =>
      sourceApis.has(source.api)
    )
    movedOnlineSources.forEach(source => selectedSites.delete(source.api))
    if (movedOnlineSources.length) {
      customSites.value = customSites.value.filter(
        source => !sourceApis.has(source.api)
      )
    }
    if (showMessage)
      toast.success(
        added + addedCms
          ? `已同步 ${added + addedCms} 个新数据源`
          : '没有发现新的兼容数据源'
      )
  } catch (error) {
    if (showMessage)
      toast.error(error instanceof Error ? error.message : '在线数据源同步失败')
  } finally {
    syncingAv.value = false
  }
}

let refreshing: Promise<void> | null = null

/**
 * 同步远程清单、加载插件源并检测全部源（含自动启用/停用）。
 * 影盒每次启动与数据源面板打开时调用；进行中重复调用会复用同一次刷新。
 */
export const refreshSources = (): Promise<void> => {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        await Promise.all([loadCatSpiderSites(), syncAvSources(false)])
        await checkAll()
      } catch {
        // 刷新失败不影响其余功能，下次触发时重试。
      } finally {
        refreshing = null
      }
    })()
  }
  return refreshing
}

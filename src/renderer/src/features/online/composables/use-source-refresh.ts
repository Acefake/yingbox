import { toast } from '@/components/ui'
import { getSetting } from '@/features/settings'
import { computed, reactive, ref, watch } from 'vue'
import { asRecord, asText } from '@/utils/json'
import { mapWithConcurrency } from '@/utils/concurrency'
import { useStorage } from '@vueuse/core'
import { cmsHealth } from './cms-health'
import { CMS_HEALTH_TTL } from '../utils/cms-health'
import { OnlineTransportError } from '../api/errors'
import { checkStartupPlugin } from './startup-plugin-check'
import {
  CATSPIDER_SITES,
  isAdultCatSpiderSite,
  selectedCatSpider,
} from './catspider-sites'
import { getJson, withQuery } from '../api/online'
import { useAvSources } from '@/features/av'
import {
  DEFAULT_SITES,
  loadCatSpiderSites,
  useOnlineSearch,
} from './use-online-search'
import {
  subscribedSites,
  subscriptionSyncedAt,
  syncSubscription,
} from './cms-subscription'

import type { SiteStatus } from '../utils/source-rules'
export type { SiteStatus }

const { selectedSites, customSites } = useOnlineSearch()
const {
  allSources: avSources,
  enabledApis: avEnabledApis,
  addSources: addAvSources,
} = useAvSources()
const avSyncedAt = useStorage('online_av_sources_at', 0)
let avSyncGeneration = 0
let sourceGeneration = 0
let monitoringReady: boolean | undefined
let checkRun: {
  generation: number
  force: boolean
  autoSelect: boolean
  promise: Promise<void>
} | null = null
const backgroundCurrent = (generation: number): boolean =>
  generation === sourceGeneration && monitoringReady !== false

// ── 检测状态（模块级单例，数据源面板与启动刷新共用）──────────
export const checkingSet = reactive<Set<string>>(new Set())
export const avCheckingSet = reactive<Set<string>>(new Set())
export const syncingAv = ref(false)
export const checkingAll = ref(false)
export const checkedCount = ref(0)
/** 本轮实际安排的探测数量，启动轮次包含所有可见数据源。 */
export const checkingTotal = ref(0)

export const statusOf = (api: string): SiteStatus =>
  checkingSet.has(api) ? 'checking' : cmsHealth.status(api)
/** 已记录的接口能力、失败原因和冷却时间。 */
export const cmsNoteOf = (api: string): string => cmsHealth.note(api)
export const avStatusOf = (api: string): SiteStatus =>
  avCheckingSet.has(api) ? 'checking' : cmsHealth.status(api)

export const onlineApis = computed(() => [
  ...DEFAULT_SITES.map(site => site.api),
  ...subscribedSites.value.map(site => site.api),
  ...customSites.value.map(site => site.api),
])

/** 手动检测绕过缓存并解除冷却；后台检测仅处理到期记录，不改变启用开关。 */
export const checkOnlineSite = async (
  api: string,
  force = true,
  isCurrent: () => boolean = () => true
): Promise<boolean | undefined> => {
  if (!isCurrent()) return
  if (checkingSet.has(api)) return
  if (!force && !cmsHealth.due(api)) return
  if (force) cmsHealth.remove(api)
  const health = cmsHealth.begin(api, 'browse')
  checkingSet.add(api)
  try {
    const data = await getJson<{ list?: unknown }>(
      withQuery(api, { ac: 'videolist', pg: 1 }),
      { timeoutMs: 8000 }
    )
    if (!isCurrent()) return
    if (!Array.isArray(data?.list)) throw new Error('接口响应缺少列表')
    health.success()
    return true
  } catch (error) {
    if (isCurrent()) {
      health.failure(error)
      if (!(error instanceof OnlineTransportError)) return false
    }
  } finally {
    checkingSet.delete(api)
  }
  return undefined
}

export const checkAvSite = async (
  api: string,
  force = true,
  isCurrent: () => boolean = () => true
): Promise<boolean | undefined> => {
  if (!isCurrent()) return
  if (avCheckingSet.has(api)) return
  if (!force && !cmsHealth.due(api)) return
  if (force) cmsHealth.remove(api)
  const health = cmsHealth.begin(api, 'browse')
  avCheckingSet.add(api)
  try {
    const data = await getJson<{ list?: unknown }>(
      withQuery(api, { ac: 'detail' }),
      {
        timeoutMs: 8000,
      }
    )
    if (!isCurrent()) return
    if (!Array.isArray(data?.list)) throw new Error('接口响应缺少列表')
    health.success()
    return true
  } catch (error) {
    if (isCurrent()) {
      health.failure(error)
      if (!(error instanceof OnlineTransportError)) return false
    }
  } finally {
    avCheckingSet.delete(api)
  }
  return undefined
}

/**
 * 手动检测全部源；force=false 时只检测已启用且过期的缓存。
 * autoSelect 用于启动轮次：绕过缓存、检测关闭源，并按结果同步开关。AV 仅在成人模式下参与。
 */
export const checkAll = (force = true, autoSelect = false): Promise<void> => {
  const generation = sourceGeneration
  const isCurrent = (): boolean =>
    generation === sourceGeneration && (force || monitoringReady !== false)
  if (!isCurrent()) return Promise.resolve()
  if (checkRun) {
    if (
      checkRun.generation === generation &&
      (checkRun.force || !force) &&
      (checkRun.autoSelect || !autoSelect)
    )
      return checkRun.promise
    return checkRun.promise.then(() =>
      isCurrent() ? checkAll(force, autoSelect) : undefined
    )
  }
  const run = { generation, force, autoSelect, promise: Promise.resolve() }
  checkingAll.value = true
  checkedCount.value = 0
  run.promise = Promise.resolve().then(async () => {
    try {
      if (!isCurrent()) return
      cmsHealth.tick()
      const includesAv = getSetting('app.adultMode')
      const tasks = [
        ...[...new Set(onlineApis.value)]
          .filter(
            api => force || (selectedSites.has(api) && cmsHealth.due(api))
          )
          .map(api => async () => {
            const current = (): boolean =>
              isCurrent() && onlineApis.value.includes(api)
            const result = await checkOnlineSite(api, force, current)
            if (autoSelect && current() && result !== undefined) {
              if (result) selectedSites.add(api)
              else selectedSites.delete(api)
            }
          }),
        ...(includesAv
          ? avSources.value
              .filter(
                site =>
                  force ||
                  (avEnabledApis.has(site.api) && cmsHealth.due(site.api))
              )
              .map(site => async () => {
                const current = (): boolean =>
                  isCurrent() &&
                  getSetting('app.adultMode') &&
                  avSources.value.some(value => value.api === site.api)
                const result = await checkAvSite(site.api, force, current)
                if (autoSelect && current() && result !== undefined) {
                  if (result) avEnabledApis.add(site.api)
                  else avEnabledApis.delete(site.api)
                }
              })
          : []),
        ...(autoSelect
          ? CATSPIDER_SITES.value
              .filter(site => includesAv || !isAdultCatSpiderSite(site))
              .map(site => async () => {
                const current = (): boolean =>
                  isCurrent() &&
                  (!isAdultCatSpiderSite(site) ||
                    getSetting('app.adultMode')) &&
                  CATSPIDER_SITES.value.some(
                    value => value.api === site.api && value.ext === site.ext
                  )
                const result = await checkStartupPlugin(site, current)
                if (!current() || result === undefined) return
                const selected = selectedCatSpider.value.filter(
                  api => api !== site.api
                )
                selectedCatSpider.value = result
                  ? [...selected, site.api]
                  : selected
              })
          : []),
      ]
      checkingTotal.value = tasks.length
      await mapWithConcurrency(tasks, 6, async check => {
        if (!isCurrent()) return
        await check()
        if (isCurrent()) checkedCount.value++
      })
    } finally {
      checkingAll.value = false
      if (checkRun === run) checkRun = null
    }
  })
  checkRun = run
  return run.promise
}

const ORDINARY_CMS_NAMES =
  /^(?:无尽|豪华|红牛|极速|虎牙|速播|樱花|光速)资源站?$/

/** 拉取远程清单并合并新源；远程清单混合普通 CMS 与 AV 源，按名称分流。 */
export const syncAvSources = async (
  showMessage = true,
  isCurrent: () => boolean = () => true
): Promise<void> => {
  if (!isCurrent()) return
  const generation = ++avSyncGeneration
  const current = (): boolean => generation === avSyncGeneration && isCurrent()
  syncingAv.value = true
  try {
    const response = await getJson<{ data?: unknown }>(
      'https://mylazily.github.io/ziyuanzhan/data/online.json',
      { timeoutMs: 15000 }
    )
    if (!current()) return
    const entries = Array.isArray(response?.data) ? response.data : []
    const sources = entries
      .map(item => {
        const entry = asRecord(item) ?? {}
        const name = (
          asText(entry.name) ||
          asText(entry.title) ||
          '在线资源站'
        ).trim()
        const api = (
          asText(entry.api) ||
          asText(entry.url) ||
          asText(entry.link)
        ).trim()
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
    const knownCmsApis = new Set([
      ...DEFAULT_SITES.map(site => site.api),
      ...subscribedSites.value.map(site => site.api),
    ])
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
    if (sources.length) avSyncedAt.value = Date.now()
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
    if (showMessage && current())
      toast.success(
        added + addedCms
          ? `已同步 ${added + addedCms} 个新数据源`
          : '没有发现新的兼容数据源'
      )
  } catch (error) {
    if (showMessage && current())
      toast.error(error instanceof Error ? error.message : '在线数据源同步失败')
  } finally {
    if (generation === avSyncGeneration) syncingAv.value = false
  }
}

let refreshing: {
  generation: number
  startup: boolean
  promise: Promise<void>
} | null = null

/**
 * 后台同步过期清单；启动轮次检测全部源并自动选择，面板刷新复用健康缓存。
 * 影盒每次启动与数据源面板打开时调用；进行中重复调用会复用同一次刷新。
 */
export const refreshSources = (startup = false): Promise<void> => {
  const generation = sourceGeneration
  if (!backgroundCurrent(generation)) return Promise.resolve()
  if (refreshing?.generation === generation) {
    if (!startup || refreshing.startup) return refreshing.promise
    return refreshing.promise.then(() =>
      backgroundCurrent(generation) ? refreshSources(true) : undefined
    )
  }
  const run = { generation, startup, promise: Promise.resolve() }
  run.promise = Promise.resolve().then(async () => {
    try {
      if (!backgroundCurrent(generation)) return
      await Promise.allSettled([
        loadCatSpiderSites(),
        Date.now() - avSyncedAt.value >= CMS_HEALTH_TTL
          ? syncAvSources(false, () => backgroundCurrent(generation))
          : Promise.resolve(),
        !subscribedSites.value.length ||
        Date.now() - subscriptionSyncedAt.value >= CMS_HEALTH_TTL
          ? syncSubscription(() => backgroundCurrent(generation)).catch(() => 0)
          : Promise.resolve(),
      ])
      if (backgroundCurrent(generation)) await checkAll(startup, startup)
    } catch {
      // 刷新失败不影响其余功能，下次触发时重试。
    } finally {
      if (refreshing === run) refreshing = null
    }
  })
  refreshing = run
  return run.promise
}

/** 应用壳拥有的后台监视器；断线或销毁后取消待发队列，隐藏窗口不发起新探测。 */
export function startSourceMonitoring(
  available: () => boolean = () => true
): () => void {
  const stopAvailability = watch(
    available,
    ready => {
      sourceGeneration++
      monitoringReady = ready
      cmsHealth.invalidateRequests()
      if (ready) void refreshSources(true)
    },
    { immediate: true, flush: 'sync' }
  )
  const timer = setInterval(() => {
    cmsHealth.tick()
    if (available() && (typeof document === 'undefined' || !document.hidden))
      void checkAll(false)
  }, 60_000)
  return () => {
    stopAvailability()
    clearInterval(timer)
    sourceGeneration++
    monitoringReady = undefined
    cmsHealth.invalidateRequests()
  }
}

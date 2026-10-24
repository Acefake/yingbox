/**
 * 数据源面板工具栏用的全局统计与批量操作：全部源数量、失效源数量、
 * 一键更新（同步清单与订阅 + 解除插件熔断 + 全部检测）、停用全部失效源。AV 源只在成人模式下计入。
 */
import { type ComputedRef, computed } from 'vue'
import { confirmDialog, toast } from '@/components/ui'
import { useAvSources } from '@/features/av'
import { useSetting } from '@/features/settings'
import { countFailed } from '../utils/source-rules'
import { syncSubscription, syncingSubscription } from './cms-subscription'
import { retryAllPlugins } from './plugin-health'
import { useOnlineSearch } from './use-online-search'
import {
  avStatusMap,
  checkAll,
  checkingAll,
  onlineApis,
  statusMap,
  syncAvSources,
  syncingAv,
} from './use-source-refresh'

/** 工具栏需要的统计与操作。 */
export interface SourceTotals {
  totalSources: ComputedRef<number>
  totalFail: ComputedRef<number>
  updatingSources: ComputedRef<boolean>
  updateSources: () => Promise<void>
  disableAllFailed: () => void
}

export function useSourceTotals(): SourceTotals {
  const adultMode = useSetting('app.adultMode')
  const { selectedSites } = useOnlineSearch()
  const { enabledApis: avEnabledApis, allSources: avSources } = useAvSources()

  const totalSources = computed(
    () =>
      onlineApis.value.length + (adultMode.value ? avSources.value.length : 0)
  )
  const totalFail = computed(
    () =>
      countFailed(onlineApis.value, statusMap) +
      (adultMode.value
        ? countFailed(
            avSources.value.map(s => s.api),
            avStatusMap
          )
        : 0)
  )

  /**
   * 一键更新：同步源清单与订阅，再检测全部源；内置 CMS 源按检测结果自动启停。
   * 订阅失败只提示，沿用上次缓存的订阅源。
   */
  const updatingSources = computed(
    () => syncingAv.value || syncingSubscription.value || checkingAll.value
  )
  const updateSources = async (): Promise<void> => {
    if (updatingSources.value) return
    await Promise.all([
      syncAvSources(true),
      syncSubscription().catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : '订阅同步失败')
      }),
    ])
    await retryAllPlugins().catch(() => {})
    await checkAll()
  }

  const disableAllFailed = (): void => {
    void confirmDialog({
      title: `禁用 ${totalFail.value} 个失效数据源？`,
      content: '只会停用这些数据源，不会删除自定义配置。',
      okText: '禁用',
      onOk: () => {
        for (const a of onlineApis.value) {
          if (statusMap[a] === 'fail') selectedSites.delete(a)
        }
        for (const s of avSources.value) {
          if (avStatusMap[s.api] === 'fail') avEnabledApis.delete(s.api)
        }
      },
    })
  }

  return {
    totalSources,
    totalFail,
    updatingSources,
    updateSources,
    disableAllFailed,
  }
}

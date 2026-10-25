/**
 * 追更面板的数据与操作：总览来自共享副本（autograb-store.ts，挂载期间订阅主进程推送）；
 * 操作失败用提示条报人话，成功后等 changed 刷新。
 */
import { type Ref, type ShallowRef, onBeforeUnmount, onMounted } from 'vue'

import { toast } from '@/components/ui/toast'
import type {
  AutograbOverview,
  AutograbResult,
  AutograbSeriesPatch,
} from '../../../../shared/contract/autograb'
import type { AutograbPrefs } from '../../../../shared/contract/autograb-prefs'

import { autograbApi } from './api'
import { autograbStore } from './autograb-store'

/** 追更面板状态与操作 */
export interface AutograbPanelState {
  overview: ShallowRef<AutograbOverview | null>
  error: Ref<string | null>
  reload(): Promise<void>
  setEnabled(enabled: boolean): Promise<void>
  setSeries(seriesId: number, patch: AutograbSeriesPatch): Promise<boolean>
  setPrefs(prefs: AutograbPrefs): Promise<void>
  grab(key: string, index: number): Promise<boolean>
  revert(key: string): Promise<boolean>
  skip(key: string): Promise<void>
  retry(key: string): Promise<void>
  runNow(): Promise<void>
  resume(): Promise<void>
}

/** 追更面板状态与操作 */
export function useAutograb(): AutograbPanelState {
  const { overview, error, reload, reloadSoon } = autograbStore
  let release: (() => void) | null = null

  function report(result: AutograbResult, success?: string): boolean {
    if (!result.ok) toast.error(result.error)
    else if (success) toast.success(success)
    reloadSoon()
    return result.ok
  }

  /** 无返回值的操作：做完稍后刷新 */
  const then =
    <A extends unknown[]>(run: (...args: A) => Promise<void>) =>
    async (...args: A): Promise<void> => {
      await run(...args)
      reloadSoon()
    }

  onMounted(() => (release = autograbStore.acquire()))
  onBeforeUnmount(() => release?.())

  const api = autograbApi
  return {
    overview,
    error,
    reload,
    setEnabled: then((enabled: boolean) => api().setEnabled(enabled)),
    setSeries: async (seriesId, patch) =>
      report(await api().setSeries(seriesId, patch)),
    setPrefs: then((prefs: AutograbPrefs) => api().setPrefs(prefs)),
    grab: async (key, index) =>
      report(await api().grab(key, index), '已转存，等待入库'),
    revert: async key =>
      report(await api().revert(key), '已撤销，这一集回到缺集'),
    skip: then((key: string) => api().skip(key)),
    retry: then((key: string) => api().retry(key)),
    runNow: then(() => api().runNow()),
    resume: then(() => api().resume()),
  }
}

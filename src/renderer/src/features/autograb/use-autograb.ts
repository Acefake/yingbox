/**
 * 追更面板的数据与操作：总览来自共享副本（autograb-store.ts，挂载期间订阅主进程推送）；
 * 操作失败用提示条报人话，成功后等 changed 刷新。
 */
import {
  type Ref,
  type ShallowRef,
  onBeforeUnmount,
  onMounted,
  reactive,
} from 'vue'

import { toast } from '@/components/ui/toast'
import type {
  AutograbOverview,
  AutograbResult,
  AutograbSeriesPatch,
} from '../../../../shared/contract/autograb'
import type { AutograbPrefs } from '../../../../shared/contract/autograb-prefs'
import type { GrabPolicyPatch } from '../../../../shared/contract/grab-policy'

import { autograbApi } from './api'
import { autograbStore } from './autograb-store'

/** 对一集的操作 */
export type EpisodeAction = 'grab' | 'revert' | 'skip' | 'retry'

/** 追更面板状态与操作 */
export interface AutograbPanelState {
  overview: ShallowRef<AutograbOverview | null>
  error: Ref<string | null>
  /** 正在操作的集 → 哪个操作（期间那个按钮转圈并拦住重复点） */
  busy: ReadonlyMap<string, EpisodeAction>
  reload(): Promise<void>
  setEnabled(enabled: boolean): Promise<void>
  setSeries(seriesId: number, patch: AutograbSeriesPatch): Promise<boolean>
  setPrefs(prefs: AutograbPrefs): Promise<void>
  /** 改剧集的全局策略；成功为 true */
  setPolicy(patch: GrabPolicyPatch): Promise<boolean>
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
  const busy = reactive(new Map<string, EpisodeAction>())

  /** 对某一集的操作：期间记入 busy */
  async function working<T>(
    key: string,
    action: EpisodeAction,
    run: () => Promise<T>
  ): Promise<T> {
    busy.set(key, action)
    try {
      return await run()
    } finally {
      busy.delete(key)
    }
  }

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
    busy,
    reload,
    setEnabled: then((enabled: boolean) => api().setEnabled(enabled)),
    setSeries: async (seriesId, patch) =>
      report(await api().setSeries(seriesId, patch)),
    setPrefs: then((prefs: AutograbPrefs) => api().setPrefs(prefs)),
    setPolicy: async patch => report(await api().setPolicy(patch)),
    grab: (key, index) =>
      working(key, 'grab', async () =>
        report(await api().grab(key, index), '已转存，等待入库')
      ),
    revert: key =>
      working(key, 'revert', async () =>
        report(await api().revert(key), '已撤销，这一集回到缺集')
      ),
    skip: key =>
      working(key, 'skip', async () => {
        await api().skip(key)
        reloadSoon()
      }),
    retry: key =>
      working(key, 'retry', async () => {
        await api().retry(key)
        reloadSoon()
      }),
    runNow: then(() => api().runNow()),
    resume: then(() => api().resume()),
  }
}

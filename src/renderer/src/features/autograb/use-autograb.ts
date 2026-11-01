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
  ref,
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
  /** 正在操作的集 → 哪个操作（全应用一份：页面、卡片、侧板看到同样的转圈并拦住重复点） */
  busy: ReadonlyMap<string, EpisodeAction>
  /** 「全部转存」进行中 */
  grabbingAll: Readonly<Ref<boolean>>
  reload(): Promise<void>
  setEnabled(enabled: boolean): Promise<void>
  setSeries(seriesId: number, patch: AutograbSeriesPatch): Promise<boolean>
  setPrefs(prefs: AutograbPrefs): Promise<void>
  /** 改剧集的全局策略；成功为 true */
  setPolicy(patch: GrabPolicyPatch): Promise<boolean>
  grab(key: string, index: number): Promise<boolean>
  /** 一次转存多集的最佳候选（逐集转，结束只提示一次）；返回成功几集 */
  grabBest(keys: readonly string[]): Promise<number>
  revert(key: string): Promise<boolean>
  skip(key: string): Promise<void>
  retry(key: string): Promise<void>
  runNow(): Promise<void>
  resume(): Promise<void>
}

const busy = reactive(new Map<string, EpisodeAction>())
const grabbingAll = ref(false)

/** 追更面板状态与操作 */
export function useAutograb(): AutograbPanelState {
  const { overview, error, reload, reloadSoon } = autograbStore
  let release: (() => void) | null = null

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
    grabbingAll,
    reload,
    setEnabled: then((enabled: boolean) => api().setEnabled(enabled)),
    setSeries: async (seriesId, patch) =>
      report(await api().setSeries(seriesId, patch)),
    setPrefs: then((prefs: AutograbPrefs) => api().setPrefs(prefs)),
    setPolicy: async patch => report(await api().setPolicy(patch)),
    grabBest: async keys => {
      // 已有操作在跑的集不碰；其余整批先记成转存中，免得排在后面的集被单独再点一次
      const queue = keys.filter(key => !busy.has(key))
      for (const key of queue) busy.set(key, 'grab')
      grabbingAll.value = true
      let saved = 0
      const failed: string[] = []
      try {
        for (const key of queue) {
          try {
            const result = await api().grab(key, 0)
            if (result.ok) saved++
            else failed.push(result.error)
          } catch (e) {
            failed.push((e as Error).message)
          } finally {
            busy.delete(key)
          }
        }
      } finally {
        for (const key of queue) busy.delete(key)
        grabbingAll.value = false
      }
      if (failed.length)
        toast.error(`有 ${failed.length} 集没存成：${failed[0]}`)
      if (saved) toast.success(`已转存 ${saved} 集，等待入库`)
      reloadSoon()
      return saved
    },
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

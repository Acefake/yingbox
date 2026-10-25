/**
 * 追更面板的数据：打开时取总览，主进程推 changed 时合并刷新（300 ms 内多次只取一次）；
 * 操作失败用提示条报人话，成功后等 changed 刷新。
 */
import {
  type Ref,
  type ShallowRef,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
} from 'vue'

import { toast } from '@/components/ui/toast'
import type {
  AutograbOverview,
  AutograbResult,
  AutograbSeriesPatch,
} from '../../../../shared/contract/autograb'

import { autograbApi } from './api'

/** 追更面板状态与操作 */
export interface AutograbPanelState {
  overview: ShallowRef<AutograbOverview | null>
  error: Ref<string | null>
  reload(): Promise<void>
  setEnabled(enabled: boolean): Promise<void>
  setSeries(seriesId: number, patch: AutograbSeriesPatch): Promise<boolean>
  grab(key: string, index: number): Promise<boolean>
  skip(key: string): Promise<void>
  retry(key: string): Promise<void>
  runNow(): Promise<void>
  resume(): Promise<void>
}

/** 追更面板状态与操作 */
export function useAutograb(): AutograbPanelState {
  const overview = shallowRef<AutograbOverview | null>(null)
  const error = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  async function load(): Promise<void> {
    try {
      const next = await autograbApi().overview()
      if (!disposed) {
        overview.value = next
        error.value = null
      }
    } catch (e) {
      if (!disposed) error.value = (e as Error).message
    }
  }

  function scheduleLoad(): void {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      void load()
    }, 300)
  }

  function report(result: AutograbResult, success?: string): boolean {
    if (!result.ok) toast.error(result.error)
    else if (success) toast.success(success)
    scheduleLoad()
    return result.ok
  }

  onMounted(() => {
    autograbApi().onChanged(scheduleLoad)
    void load()
  })
  onBeforeUnmount(() => {
    disposed = true
    if (timer) clearTimeout(timer)
    autograbApi().offChanged()
  })

  return {
    overview,
    error,
    reload: load,
    setEnabled: async (enabled: boolean) => {
      await autograbApi().setEnabled(enabled)
      scheduleLoad()
    },
    setSeries: async (seriesId: number, patch: AutograbSeriesPatch) =>
      report(await autograbApi().setSeries(seriesId, patch)),
    grab: async (key: string, index: number) =>
      report(await autograbApi().grab(key, index), '已转存，等待入库'),
    skip: async (key: string) => {
      await autograbApi().skip(key)
      scheduleLoad()
    },
    retry: async (key: string) => {
      await autograbApi().retry(key)
      scheduleLoad()
    },
    runNow: async () => {
      await autograbApi().runNow()
      scheduleLoad()
    },
    resume: async () => {
      await autograbApi().resume()
      scheduleLoad()
    },
  }
}

/**
 * 洗版 / 电影面板共用的数据钩子：挂载时取总览，主进程推 changed 时合并刷新（300 ms 内多次只取一次）；
 * 操作结果用提示条报人话，成功后等 changed 刷新。
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
import type { GrabResult } from '../../../../shared/contract/autograb-upgrade'

/** 一个域的总览状态 */
export interface OverviewState<T> {
  data: ShallowRef<T | null>
  error: Ref<string | null>
  /** 稍后刷新（合并多次） */
  refresh(): void
  /** 报告操作结果：失败提示原因、成功可给一句提示；返回是否成功 */
  report(result: GrabResult, success?: string): boolean
}

/** 订阅一个域的总览 */
export function useOverview<T>(source: {
  overview(): Promise<T>
  onChanged(listener: () => void): void
  offChanged(): void
}): OverviewState<T> {
  const data = shallowRef<T | null>(null)
  const error = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  async function load(): Promise<void> {
    try {
      const next = await source.overview()
      if (!disposed) {
        data.value = next
        error.value = null
      }
    } catch (e) {
      if (!disposed) error.value = (e as Error).message
    }
  }

  function refresh(): void {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      void load()
    }, 300)
  }

  onMounted(() => {
    source.onChanged(refresh)
    void load()
  })
  onBeforeUnmount(() => {
    disposed = true
    if (timer) clearTimeout(timer)
    source.offChanged()
  })

  return {
    data,
    error,
    refresh,
    report(result, success) {
      if (!result.ok) toast.error(result.error)
      else if (success) toast.success(success)
      refresh()
      return result.ok
    },
  }
}

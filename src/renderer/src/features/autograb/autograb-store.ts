/**
 * 追更总览的共享副本：追更面板和日历卡片的小标记读同一份，只订阅一次主进程的 changed。
 *
 * preload 的 offChanged 会移除这个通道的全部监听，所以不能每个组件各订各的：这里按使用者计数，
 * 第一个使用者进来时订阅、最后一个离开时退订；每个使用者进来都取一次最新的。changed 在 300 ms 内多次只取一次。
 */
import { type Ref, type ShallowRef, ref, shallowRef } from 'vue'

import type { AutograbOverview } from '../../../../shared/contract/autograb'

import { autograbApi } from './api'

const overview = shallowRef<AutograbOverview | null>(null)
const error = ref<string | null>(null)
let users = 0
let timer: ReturnType<typeof setTimeout> | null = null

/** 立刻取一次总览 */
async function reload(): Promise<void> {
  try {
    overview.value = await autograbApi().overview()
    error.value = null
  } catch (e) {
    error.value = (e as Error).message
  }
}

/** 稍后取一次（合并短时间内的多次变化） */
function reloadSoon(): void {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    if (users > 0) void reload()
  }, 300)
}

/** 开始使用：返回退订函数 */
function acquire(): () => void {
  if (users++ === 0) autograbApi().onChanged(reloadSoon)
  void reload()
  let released = false
  return () => {
    if (released) return
    released = true
    if (--users > 0) return
    autograbApi().offChanged()
    if (timer) clearTimeout(timer)
    timer = null
  }
}

/** 共享的总览与刷新方法 */
export const autograbStore: {
  overview: ShallowRef<AutograbOverview | null>
  error: Ref<string | null>
  reload: () => Promise<void>
  reloadSoon: () => void
  acquire: () => () => void
} = { overview, error, reload, reloadSoon, acquire }

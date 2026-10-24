/**
 * 「继续播放」记录的存取：全应用一份响应式列表，持久化在 localStorage（continue_watching）。
 *
 * - openMediaPlayer 带 continueAs 开播时 startContinue 建 / 更新记录；
 * - 应用内播放器记进度时 updateContinue（与续播进度同一节流），看完自动换下一集或删除；
 * - 其它窗口改了存储（storage 事件）时同步。
 * 规则都在 continue-rules.ts。
 */
import { type Ref, ref } from 'vue'

import { readStoredArray, saveStoredArray } from '@/utils/storage'

import {
  type ContinueMeta,
  type ContinueRecord,
  type ContinueReplay,
  type ProgressUpdate,
  applyProgress,
  sanitizeRecords,
  startRecord,
} from './continue-rules'

const STORAGE_KEY = 'continue_watching'

function load(): ContinueRecord[] {
  return sanitizeRecords(readStoredArray<unknown>(STORAGE_KEY))
}

let records: Ref<ContinueRecord[]> | null = null

function state(): Ref<ContinueRecord[]> {
  if (records) return records
  records = ref(load())
  if (typeof window !== 'undefined')
    window.addEventListener('storage', event => {
      if (event.key === STORAGE_KEY && records) records.value = load()
    })
  return records
}

function commit(next: ContinueRecord[]): void {
  const list = state()
  if (next === list.value) return
  list.value = next
  saveStoredArray(STORAGE_KEY, next)
}

/** 全部记录（响应式，只读；最近的在前）。 */
export function continueRecords(): Readonly<Ref<readonly ContinueRecord[]>> {
  return state()
}

/** 开播时登记；返回记录 id（交给播放器记进度用）。 */
export function startContinue(
  meta: ContinueMeta,
  replay: ContinueReplay,
  startAt = 0
): string {
  // 载荷里可能带着 Vue 的响应式对象：存储前转成普通 JSON
  const plain = JSON.parse(JSON.stringify({ meta, replay })) as {
    meta: ContinueMeta
    replay: ContinueReplay
  }
  const next = startRecord(
    state().value,
    plain.meta,
    plain.replay,
    startAt,
    Date.now()
  )
  commit(next)
  return next[0].id
}

/** 播放器记进度。 */
export function updateContinue(id: string, update: ProgressUpdate): void {
  if (!id) return
  commit(applyProgress(state().value, id, update, Date.now()))
}

/** 标记看完：剧集换成下一集，最后一集或单片直接移除。 */
export function finishContinue(id: string): void {
  const record = state().value.find(r => r.id === id)
  if (!record) return
  updateContinue(id, {
    index: record.replay.index ?? 0,
    progress: record.duration,
    duration: record.duration,
    ended: true,
  })
}

/** 从继续播放里移除。 */
export function removeContinue(id: string): void {
  commit(state().value.filter(r => r.id !== id))
}

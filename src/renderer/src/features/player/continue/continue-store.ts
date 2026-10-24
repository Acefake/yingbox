/**
 * 「继续播放」记录的存取：全应用一份响应式列表，持久化在 localStorage（continue_watching）。
 *
 * - openMediaPlayer 带 continueAs 开播时 startContinue 建 / 更新记录；
 * - 应用内播放器记进度时 updateContinue（与续播进度同一节流），看完自动换下一集或删除；
 * - 其它窗口改了存储（storage 事件）时同步；
 * - 整部看完（单片或最后一集播到 95%，且播放列表不是作品的一部分）时通知 onContinueFinished 的订阅者（如「想看」清单）。
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

type FinishedListener = (id: string) => void
const finishedListeners = new Set<FinishedListener>()

/**
 * 订阅「整部看完」：记录因看完最后一集 / 单片被移除时回调记录 id；返回取消订阅。
 * 标了 partial 的记录（只播了作品的一部分，如多季剧的前几季）播完不通知。
 */
export function onContinueFinished(listener: FinishedListener): () => void {
  finishedListeners.add(listener)
  return () => finishedListeners.delete(listener)
}

/** 播放器记进度。 */
export function updateContinue(id: string, update: ProgressUpdate): void {
  if (!id) return
  const before = state().value
  const next = applyProgress(before, id, update, Date.now())
  commit(next)
  // applyProgress 只在看完最后一集（或单片）时删掉记录；partial 只代表播完了一部分
  const old = before.find(r => r.id === id)
  if (old && !old.partial && !next.some(r => r.id === id))
    finishedListeners.forEach(listener => listener(id))
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

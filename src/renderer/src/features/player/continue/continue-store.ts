/**
 * 「继续播放」记录的存取：全应用一份响应式列表，持久化在 localStorage（continue_watching）。
 *
 * - openMediaPlayer 带 continueAs 开播时 startContinue 建 / 更新记录；
 * - 应用内播放器记进度时 updateContinue（与续播进度同一节流），看完自动换下一集或删除；
 * - 其它窗口改了存储（storage 事件）时同步；
 * - 无痕模式（isIncognito）下不建记录、不记进度；用户手动移除 / 标记看完照常。
 * - 整部看完（单片或最后一集播到 90%，且播放列表不是作品的一部分）时通知 onContinueFinished 的订阅者（如「想看」清单）。
 * - 媒体库按片库里的观看进度生成记录，经 mergeContinue 并入（后写胜出）；手动移除的记一块墓碑
 *   （continue_removed），更早的进度不会把它补回来。标记看完时媒体库条目同时上报片库。
 * 规则都在 continue-rules.ts。
 */
import { type Ref, ref } from 'vue'

import { isIncognito } from '@/features/incognito'
import { readStoredArray, saveStoredArray } from '@/utils/storage'

import { reportLibraryProgress } from '../progress/library-sink'
import {
  type ContinueMeta,
  type ContinueRecord,
  type ContinueReplay,
  type ContinueTombstones,
  type ProgressUpdate,
  addTombstone,
  applyProgress,
  mergeRecords,
  sanitizeRecords,
  startRecord,
} from './continue-rules'

const STORAGE_KEY = 'continue_watching'
const TOMBSTONE_KEY = 'continue_removed'

/** 墓碑存成 [id, 移除时间] 数组 */
function readTombstones(): ContinueTombstones {
  const pairs = readStoredArray<[string, number]>(
    TOMBSTONE_KEY,
    (v): v is [string, number] =>
      Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'number'
  )
  return Object.fromEntries(pairs)
}

function writeTombstones(stones: ContinueTombstones): void {
  saveStoredArray(TOMBSTONE_KEY, Object.entries(stones))
}

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

/** 开播时登记；返回记录 id（交给播放器记进度用）。无痕模式下不登记，返回空串。 */
export function startContinue(
  meta: ContinueMeta,
  replay: ContinueReplay,
  startAt = 0
): string {
  if (isIncognito()) return ''
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

/** 写入一次进度；整部看完时通知订阅者（播放器记进度与手动标记看完共用） */
function applyUpdate(id: string, update: ProgressUpdate): void {
  const before = state().value
  const next = applyProgress(before, id, update, Date.now())
  commit(next)
  // applyProgress 只在看完最后一集（或单片）时删掉记录；partial 只代表播完了一部分
  const old = before.find(r => r.id === id)
  if (old && !old.partial && !next.some(r => r.id === id))
    finishedListeners.forEach(listener => listener(id))
}

/** 播放器记进度（无痕模式下不记）。 */
export function updateContinue(id: string, update: ProgressUpdate): void {
  if (!id || isIncognito()) return
  applyUpdate(id, update)
}

/** 标记看完：剧集换成下一集，最后一集或单片直接移除；媒体库条目同时在片库记看完。 */
export function finishContinue(id: string): void {
  const record = state().value.find(r => r.id === id)
  if (!record) return
  const entry = record.replay.playlist?.[record.replay.index ?? 0]
  reportLibraryProgress(entry?.library, record.duration, record.duration, true)
  applyUpdate(id, {
    index: record.replay.index ?? 0,
    progress: record.duration,
    duration: record.duration,
    ended: true,
  })
}

/** 从继续播放里移除（记墓碑：片库里更早的进度不会再把它补回来）。 */
export function removeContinue(id: string): void {
  writeTombstones(addTombstone(readTombstones(), id, Date.now()))
  commit(state().value.filter(r => r.id !== id))
}

/** 并入别处来的记录（媒体库按片库观看进度生成）：后写胜出，移除过的不补回。 */
export function mergeContinue(incoming: readonly ContinueRecord[]): void {
  if (!incoming.length) return
  commit(mergeRecords(state().value, incoming, readTombstones()))
}

/** 按媒体库作品 ID 替换旧分区记录，保留用户手动移除的选择。 */
export function replaceLibraryContinue(
  rootId: number,
  section: 'movie' | 'tv',
  record: ContinueRecord | null
): void {
  const key = String(rootId)
  const retained = state().value.filter(
    r =>
      !(
        r.key === key &&
        (r.section === 'movie' || r.section === 'tv') &&
        r.section !== section
      )
  )
  const stones = readTombstones()
  const removedAt = Math.max(
    stones[`movie:${key}`] ?? 0,
    stones[`tv:${key}`] ?? 0
  )
  const next = record && record.updatedAt > removedAt ? [record] : []
  commit(mergeRecords(retained, next, stones))
}

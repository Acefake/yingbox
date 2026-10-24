/**
 * 片头片尾标记的存取：全应用一份响应式列表，持久化在 localStorage（skip_marks）。
 *
 * - 播放器右键菜单标记 / 清除时写入（记为手动）；
 * - 自动检测片头片尾的结果经 applyDetected 并入（手动优先，见 detect-merge.ts）；
 * - 其它窗口改了存储（storage 事件）时同步。
 * 规则都在 skip-rules.ts / detect-merge.ts。
 */
import { type Ref, ref } from 'vue'

import { readStoredArray, saveStoredArray } from '@/utils/storage'

import {
  type DetectedMarks,
  type MergeOutcome,
  mergeDetected,
  stampManual,
} from './detect-merge'
import {
  type SkipMarks,
  type SkipRecord,
  putRecord,
  sanitizeSkipRecords,
} from './skip-rules'

export const SKIP_STORAGE_KEY = 'skip_marks'

function load(): SkipRecord[] {
  return sanitizeSkipRecords(readStoredArray<unknown>(SKIP_STORAGE_KEY))
}

let records: Ref<SkipRecord[]> | null = null

function state(): Ref<SkipRecord[]> {
  if (records) return records
  records = ref(load())
  if (typeof window !== 'undefined')
    window.addEventListener('storage', event => {
      if (event.key === SKIP_STORAGE_KEY && records) records.value = load()
    })
  return records
}

function commit(next: SkipRecord[]): void {
  state().value = next
  saveStoredArray(SKIP_STORAGE_KEY, next)
}

/** 全部记录（响应式，只读；最近修改的在前）。 */
export function skipRecords(): Readonly<Ref<readonly SkipRecord[]>> {
  return state()
}

/** 某部剧的标记（在 computed 里调用即随存储更新）；没有时返回空对象。 */
export function getSkipMarks(key: string): SkipMarks {
  if (!key) return {}
  const record = state().value.find(r => r.key === key)
  if (!record) return {}
  const marks: SkipMarks = {}
  if (record.intro) marks.intro = { ...record.intro }
  if (record.outro !== undefined) marks.outro = record.outro
  return marks
}

/** 某部剧的标记连同来源；没有时返回空对象。 */
export function getSkipMarksWithSource(key: string): SkipMarks {
  const record = key ? state().value.find(r => r.key === key) : undefined
  if (!record) return {}
  const { key: _key, updatedAt: _at, ...marks } = record
  return { ...marks, ...(marks.intro ? { intro: { ...marks.intro } } : {}) }
}

/** 手动写入某部剧的标记（改动的项记为手动）；没有任何有效标记时等于清除。 */
export function setSkipMarks(key: string, marks: SkipMarks): void {
  if (!key) return
  const next = stampManual(getSkipMarksWithSource(key), marks)
  commit(putRecord(state().value, key, next, Date.now()))
}

/** 并入自动检测结果（手动标记优先）；返回各项是否采用。 */
export function applyDetected(key: string, found: DetectedMarks): MergeOutcome {
  const outcome = mergeDetected(getSkipMarksWithSource(key), found)
  if (key && (outcome.intro === 'applied' || outcome.outro === 'applied'))
    commit(putRecord(state().value, key, outcome.marks, Date.now()))
  return outcome
}

/** 清除某部剧的片头片尾。 */
export function clearSkipMarks(key: string): void {
  setSkipMarks(key, {})
}

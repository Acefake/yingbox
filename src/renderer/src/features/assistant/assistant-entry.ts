/**
 * 统一入口里「搜索结果 + 问 AI」一列的选中规则（纯规则 + 一个小 composable）。
 *
 * 列表从上到下：「问 AI：<输入>」一行（索引 -1，只在能问 AI 时有）、片库结果（0..n-1）。
 * 回车作用在选中的那一行上；Cmd/Ctrl+回车总是问 AI。默认选中：
 * - 第一条结果是片名精确命中 → 选它（回车直接打开这部片）；
 * - 否则能问 AI → 选「问 AI」行（回车把这句话交给 AI）；
 * - 否则（网页版）→ 选第一条结果。
 * 用户用 ↑ ↓ 选过之后，召回补入新结果时按稳定键保留选择；输入变了就回到默认。
 */
import { type Ref, ref, watch } from 'vue'

/** 选中规则需要的结果字段 */
export interface EntryRow {
  key: string
  exact: boolean
}

/** 「问 AI」行的索引 */
export const ASK_ROW = -1

/**
 * 默认选中哪一行。
 * @param rows 片库结果
 * @param askable 能不能问 AI（有「问 AI」行）
 */
export function defaultSelection(rows: EntryRow[], askable: boolean): number {
  if (rows[0]?.exact) return 0
  if (askable || !rows.length) return ASK_ROW
  return 0
}

/**
 * ↑ ↓ 移动选中，首尾相接；没有「问 AI」行时只在结果里转。
 * @param current 当前选中
 * @param delta 1 下移 / -1 上移
 * @param count 结果条数
 * @param askable 有没有「问 AI」行
 */
export function moveSelection(
  current: number,
  delta: 1 | -1,
  count: number,
  askable: boolean
): number {
  const first = askable ? ASK_ROW : 0
  const last = count - 1
  if (last < first) return ASK_ROW
  const next = current + delta
  if (next > last) return first
  if (next < first) return last
  return next
}

/** 选中行的元素 id（给 aria-activedescendant） */
export function selectionId(selected: number): string {
  return selected === ASK_ROW ? 'entry-ask' : `search-hit-${selected}`
}

/**
 * 选中状态：结果变化时按稳定键保留用户的选择，输入变化时回到默认。
 * @param rows 当前结果（响应式 getter）
 * @param askable 能不能问 AI
 * @param text 输入框文字
 */
export function useEntrySelection(
  rows: () => EntryRow[],
  askable: () => boolean,
  text: () => string
): { selected: Ref<number>; move: (delta: 1 | -1) => void } {
  const selected = ref(ASK_ROW)
  /** 用户选过的行（'' = 没选过，用默认） */
  let picked = ''

  // 输入变化时回到默认；结果追加时保留用户已选择的行。
  watch(
    [text, rows, askable],
    ([nextText], previous) => {
      if (!previous || nextText !== previous[0]) picked = ''
      const list = rows()
      if (picked === 'ask' && askable()) {
        selected.value = ASK_ROW
        return
      }
      const index = picked ? list.findIndex(row => row.key === picked) : -1
      selected.value = index >= 0 ? index : defaultSelection(list, askable())
    },
    { immediate: true }
  )

  function move(delta: 1 | -1): void {
    const list = rows()
    selected.value = moveSelection(
      selected.value,
      delta,
      list.length,
      askable()
    )
    picked = selected.value === ASK_ROW ? 'ask' : list[selected.value].key
    document
      .getElementById(selectionId(selected.value))
      ?.scrollIntoView?.({ block: 'nearest' })
  }

  return { selected, move }
}

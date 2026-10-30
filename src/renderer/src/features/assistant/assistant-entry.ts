/**
 * 统一入口里「搜索结果 + 问 AI」一列的选中规则（纯规则 + 一个小 composable）。
 *
 * 列表从上到下：完整搜索（-2）、「问 AI：<输入>」一行（索引 -1，只在能问 AI 时有）、片库结果（0..n-1）。
 * 回车默认提交完整搜索，Cmd/Ctrl+回车问 AI；方向键选中具体结果后可直接打开。
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

/** 默认回车提交完整搜索；具体结果只在用户显式选择后打开。 */
export const SEARCH_ROW = -2
export function defaultSelection(_rows: EntryRow[], _askable: boolean): number {
  return SEARCH_ROW
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
  const first = SEARCH_ROW
  const last = count - 1
  if (last < first) return SEARCH_ROW
  let next = current + delta
  if (!askable && next === ASK_ROW) next += delta
  if (next > last) return first
  if (next < first) return askable || last >= 0 ? last : SEARCH_ROW
  return next
}

/** 选中行的元素 id（给 aria-activedescendant） */
export function selectionId(selected: number): string {
  return selected === SEARCH_ROW
    ? 'entry-search'
    : selected === ASK_ROW
      ? 'entry-ask'
      : `search-hit-${selected}`
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
      if (picked === 'search') {
        selected.value = SEARCH_ROW
        return
      }
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
    picked =
      selected.value === SEARCH_ROW
        ? 'search'
        : selected.value === ASK_ROW
          ? 'ask'
          : list[selected.value].key
    document
      .getElementById(selectionId(selected.value))
      ?.scrollIntoView?.({ block: 'nearest' })
  }

  return { selected, move }
}

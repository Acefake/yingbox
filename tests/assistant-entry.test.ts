// @vitest-environment jsdom
/**
 * 统一入口「问 AI + 搜索结果」一列的选中规则（assistant-entry.ts）与搜索范围（librarySearchScope）。
 */
import { describe, expect, it } from 'vitest'

import {
  ASK_ROW,
  defaultSelection,
  moveSelection,
  selectionId,
} from '../src/renderer/src/features/assistant/assistant-entry'
import { groupOnline } from '../src/renderer/src/features/assistant/use-entry-online'
import { entryChips } from '../src/renderer/src/features/assistant/use-entry-search'
import {
  librarySearchScope,
  librarySectionLabel,
} from '../src/renderer/src/features/library/search/use-library-search'

const row = (key: string, exact = false): { key: string; exact: boolean } => ({
  key,
  exact,
})

describe('默认选中', () => {
  it('第一条是片名精确命中 → 选它（回车直接打开）', () => {
    expect(defaultSelection([row('a', true), row('b')], true)).toBe(0)
    expect(defaultSelection([row('a', true)], false)).toBe(0)
  })
  it('能问 AI → 选「问 AI」行；没有结果也是', () => {
    expect(defaultSelection([row('a'), row('b')], true)).toBe(ASK_ROW)
    expect(defaultSelection([], true)).toBe(ASK_ROW)
  })
  it('网页版（不能问 AI）→ 第一条结果；没有结果时什么都不选', () => {
    expect(defaultSelection([row('a')], false)).toBe(0)
    expect(defaultSelection([], false)).toBe(ASK_ROW)
  })
})

describe('↑ ↓ 移动', () => {
  it('有「问 AI」行时在 -1..n-1 间首尾相接', () => {
    expect(moveSelection(ASK_ROW, 1, 2, true)).toBe(0)
    expect(moveSelection(1, 1, 2, true)).toBe(ASK_ROW)
    expect(moveSelection(ASK_ROW, -1, 2, true)).toBe(1)
    expect(moveSelection(ASK_ROW, 1, 0, true)).toBe(ASK_ROW)
  })
  it('没有「问 AI」行时只在结果里转', () => {
    expect(moveSelection(0, -1, 3, false)).toBe(2)
    expect(moveSelection(2, 1, 3, false)).toBe(0)
    expect(moveSelection(ASK_ROW, 1, 0, false)).toBe(ASK_ROW)
  })
  it('选中行的 id 与列表里的行一致', () => {
    expect(selectionId(ASK_ROW)).toBe('entry-ask')
    expect(selectionId(3)).toBe('search-hit-3')
  })
})

describe('搜索范围', () => {
  it('默认全部本地片库；「当前分区」胶囊在电影页 / 剧集页只搜本分区；私密 → 私密库', () => {
    expect(librarySearchScope('Movie', false)).toBe('all')
    expect(librarySearchScope('Movie', false, true)).toBe('movie')
    expect(librarySearchScope('TV', false, true)).toBe('tv')
    expect(librarySearchScope('Online', false, true)).toBe('all')
    expect(librarySearchScope('Movie', true, true)).toBe(
      librarySearchScope(undefined, true)
    )
    expect(librarySearchScope(undefined, true)).not.toBe('all')
    expect(librarySectionLabel('Movie')).toBe('电影')
    expect(librarySectionLabel('TV')).toBe('剧集')
    expect(librarySectionLabel('Online')).toBeNull()
  })
  it('范围胶囊：全部 / 本地 / 在线（+ 当前分区）；网页版没有在线；私密模式没有胶囊', () => {
    const ids = (list: { id: string }[]): string[] => list.map(chip => chip.id)
    expect(ids(entryChips(null, true, false))).toEqual([
      'all',
      'local',
      'online',
    ])
    expect(entryChips('电影', true, false).at(-1)).toEqual({
      id: 'section',
      label: '电影',
    })
    expect(ids(entryChips(null, false, false))).toEqual(['all', 'local'])
    expect(entryChips('电影', true, true)).toEqual([])
  })
})

describe('在线结果合并', () => {
  const item = (
    name: string,
    year: string,
    source: string
  ): Parameters<typeof groupOnline>[0][number] => ({
    vod_id: 1,
    vod_name: name,
    vod_year: year,
    type_name: '',
    vod_remarks: '',
    vod_pic: '',
    source_name: source,
  })
  it('同名（忽略空白标点大小写）同年的多个源合成一行，保持先到的顺序，限制行数', () => {
    const rows = groupOnline([
      item('沙丘 2', '2024', '甲'),
      item('Dune', '2021', '甲'),
      item('沙丘·2', '2024', '乙'),
      item('沙丘 2', '2024', '乙'),
      item('沙丘2', '2023', '丙'),
    ])
    expect(rows.map(row => [row.title, row.year, row.sources])).toEqual([
      ['沙丘 2', '2024', ['甲', '乙']],
      ['Dune', '2021', ['甲']],
      ['沙丘2', '2023', ['丙']],
    ])
    expect(
      groupOnline([item('a', '', 'x'), item('b', '', 'x')], 1)
    ).toHaveLength(1)
    expect(groupOnline([item('  ', '', 'x')])).toEqual([])
  })
})

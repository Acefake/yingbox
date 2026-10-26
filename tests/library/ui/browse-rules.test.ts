/**
 * 片库页头规则：排序钮文字与菜单切换、浏览胶囊（全部 / 未看 / 最近添加 | 类型）的选中与切换、
 * 胶囊行列出的类型、标题里的类型、待确认提示、「⋯」里的匹配状态 / 媒体库分组，
 * 以及工具栏模板的源码级约定（不再有匹配状态胶囊、排序下拉与独立的升降序钮）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  browseSelected,
  libraryChoices,
  matchChoices,
  pickBrowse,
  pickGenre,
  reviewHintText,
  sortLabel,
  sortPick,
  titleGenre,
  topGenres,
} from '../../../src/renderer/src/features/library/page/browse-rules'
import { emptyTitleFor } from '../../../src/renderer/src/features/library/page/page-rules'

const values = (...names: string[]): Array<{ value: string; count: number }> =>
  names.map((value, i) => ({ value, count: 100 - i }))

describe('排序钮', () => {
  it('字段名 + 方向箭头；点当前字段切换升降序，点别的换字段', () => {
    expect(sortLabel('addedAt', 'desc')).toBe('添加时间 ↓')
    expect(sortLabel('title', 'asc')).toBe('片名 ↑')
    expect(sortPick('addedAt', 'addedAt')).toEqual({ kind: 'toggle-order' })
    expect(sortPick('addedAt', 'rating')).toEqual({
      kind: 'sort',
      sort: 'rating',
    })
  })
})

describe('浏览胶囊', () => {
  it('「全部」= 不限观看与类型；未看 / 最近添加看 browse', () => {
    expect(browseSelected({ browse: 'all', genre: null }, 'all')).toBe(true)
    expect(browseSelected({ browse: 'all', genre: '科幻' }, 'all')).toBe(false)
    expect(
      browseSelected({ browse: 'unwatched', genre: '科幻' }, 'unwatched')
    ).toBe(true)
    expect(browseSelected({ browse: 'recent', genre: null }, 'all')).toBe(false)
  })

  it('「全部」清空；未看 / 最近添加再点取消；观看与类型可叠加', () => {
    expect(pickBrowse({ browse: 'recent', genre: '科幻' }, 'all')).toEqual({
      browse: 'all',
      genre: null,
    })
    expect(pickBrowse({ browse: 'all', genre: '科幻' }, 'unwatched')).toEqual({
      browse: 'unwatched',
      genre: '科幻',
    })
    expect(
      pickBrowse({ browse: 'unwatched', genre: null }, 'unwatched')
    ).toEqual({ browse: 'all', genre: null })
    expect(pickGenre(null, '科幻')).toBe('科幻')
    expect(pickGenre('科幻', '科幻')).toBeNull()
    expect(pickGenre('科幻', '动作')).toBe('动作')
  })

  it('胶囊行取片数最多的前几个；选中的不在其中时换掉最后一个', () => {
    const all = values('剧情', '科幻', '动作', '喜剧', '爱情')
    expect(topGenres(all, null, 3).map(v => v.value)).toEqual([
      '剧情',
      '科幻',
      '动作',
    ])
    expect(topGenres(all, '科幻', 3).map(v => v.value)).toEqual([
      '剧情',
      '科幻',
      '动作',
    ])
    expect(topGenres(all, '爱情', 3).map(v => v.value)).toEqual([
      '剧情',
      '科幻',
      '爱情',
    ])
    // 选中的类型已经没有片了（如换了媒体库）也照样列出
    expect(topGenres(all, '西部', 2)).toEqual([
      { value: '剧情', count: 100 },
      { value: '西部', count: 0 },
    ])
    expect(topGenres([], null)).toEqual([])
    expect(topGenres(values(...'abcdefghijkl'.split('')), null)).toHaveLength(9)
  })

  it('标题只在海报墙选了类型时带类型；空状态把类型与浏览算作筛选', () => {
    expect(titleGenre('wall', '科幻')).toBe('科幻')
    expect(titleGenre('review', '科幻')).toBeNull()
    expect(titleGenre('wall', null)).toBeNull()
    expect(emptyTitleFor({ search: '', filter: 'all', genre: '科幻' })).toBe(
      '没有符合筛选条件的条目'
    )
    expect(
      emptyTitleFor({ search: '', filter: 'all', browse: 'unwatched' })
    ).toBe('没有符合筛选条件的条目')
  })
})

describe('待确认提示与「⋯」分组', () => {
  it('0 时不显示，其余带千分位', () => {
    expect(reviewHintText(0)).toBeNull()
    expect(reviewHintText(12)).toBe('12 部待确认')
    expect(reviewHintText(1234)).toBe('1,234 部待确认')
  })

  it('匹配状态：全部 / 已匹配 / 未匹配 / 已锁定，当前项打勾', () => {
    const choices = matchChoices('locked')
    expect(choices.map(c => c.label)).toEqual([
      '全部',
      '已匹配',
      '未匹配',
      '已锁定',
    ])
    expect(choices.filter(c => c.checked).map(c => c.value)).toEqual(['locked'])
    expect(new Set(choices.map(c => c.group))).toEqual(new Set(['匹配状态']))
  })

  it('媒体库：只有一个时不列，多个时当前项打勾', () => {
    const one = [
      { value: 0, label: '全部文件夹' },
      { value: 3, label: 'A' },
    ]
    expect(libraryChoices(one, 0)).toEqual([])
    const two = [...one, { value: 4, label: 'B' }]
    const choices = libraryChoices(two, 4)
    expect(choices.map(c => [c.label, c.checked])).toEqual([
      ['全部文件夹', false],
      ['A', false],
      ['B', true],
    ])
    expect(choices[0].group).toBe('媒体库')
  })
})

describe('工具栏模板', () => {
  const read = (name: string): string =>
    readFileSync(
      new URL(
        `../../../src/renderer/src/features/library/page/${name}`,
        import.meta.url
      ),
      'utf8'
    )

  it('右侧只有排序菜单、筛选、⋯；浏览胶囊与待确认提示各自成组件', () => {
    const src = read('LibraryToolbar.vue')
    expect(src).not.toContain('UiSelect')
    expect(src).not.toContain('FILTER_OPTIONS')
    expect(src).toContain('<UiMenuButton icon-only')
    expect(src).toContain('<BrowseRow')
    expect(src).toContain('<ReviewHint')
  })

  it('海报墙只在筛选非全部时显示状态角标', () => {
    const page = readFileSync(
      new URL(
        '../../../src/renderer/src/features/library/LibraryPage.vue',
        import.meta.url
      ),
      'utf8'
    )
    expect(page).toContain(':show-state-badge="state.filter !== \'all\'"')
    expect(page).toContain('v-model:genre="state.genre"')
  })
})

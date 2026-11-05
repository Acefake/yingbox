/**
 * 统一入口在线结果：相关度打分、折叠、与本地片库去重。
 */
import { describe, expect, it } from 'vitest'

import {
  isNoise,
  rankOnline,
  titleScore,
} from '../src/renderer/src/features/assistant/result-rank'

const row = (
  title: string,
  year = '',
  type = '电影',
  sources: string[] = ['A']
): { title: string; year: string; type: string; sources: string[] } => ({
  title,
  year,
  type,
  sources,
})

describe('titleScore', () => {
  it('完全一致最高，忽略标点和空白', () => {
    expect(titleScore('你好李焕英', '你好，李焕英')).toBe(100)
  })

  it('开头匹配高于包含，包含高于零星重合', () => {
    const start = titleScore('你好李焕英', '你好李焕英 超前点映')
    const inside = titleScore('李焕英', '贾玲你好李焕英')
    expect(start).toBeGreaterThan(inside)
    expect(inside).toBeGreaterThan(titleScore('你好李焕英', '你好2022'))
  })

  it('只共有开头两个字是弱相关', () => {
    expect(titleScore('你好李焕英', '你好2022')).toBeLessThan(50)
  })
})

describe('isNoise', () => {
  it('按分类名或片名认出解说、混剪', () => {
    expect(isNoise(row('你好，李焕英[电影解说]', '2020', '电影解说'))).toBe(
      true
    )
    expect(isNoise(row('某某 预告片'))).toBe(true)
    expect(isNoise(row('你好，李焕英'))).toBe(false)
  })
})

describe('rankOnline', () => {
  const rows = [
    row('你好，李焕英[电影解说]', '2020', '电影解说'),
    row('你好2022', '2022', '剧情片'),
    row('你好，李焕英', '2021', '喜剧片', ['A', 'B']),
    row('你好李焕英 花絮', '2021', '电影'),
    row('李焕英的故事', '2019', '电影'),
    row('另一部你好', '2018', '电影'),
  ]

  it('正片相关在前，弱相关与非正片折叠，非正片垫底', () => {
    const { main, more } = rankOnline(rows, '你好李焕英')
    expect(main[0].title).toBe('你好，李焕英')
    expect(main.map(r => r.title)).not.toContain('你好2022')
    expect(more.at(-1)?.type).toMatch(/解说|电影/)
    expect(more.map(r => r.title)).toContain('你好2022')
    expect(more.map(r => r.title)).toContain('你好，李焕英[电影解说]')
  })

  it('结果很少时不折叠', () => {
    const { main, more } = rankOnline(
      [row('你好，李焕英', '2021'), row('你好2022', '2022')],
      '你好李焕英'
    )
    expect(more).toEqual([])
    expect(main).toHaveLength(2)
  })

  it('没有一条相关时全部显示，不留空', () => {
    const { main, more } = rankOnline(
      [
        row('毫不相干甲'),
        row('毫不相干乙'),
        row('毫不相干丙'),
        row('毫不相干丁'),
      ],
      '你好李焕英'
    )
    expect(main).toHaveLength(4)
    expect(more).toEqual([])
  })

  it('同名同年的在线结果与本地重复时去掉；缺年份只比片名', () => {
    const { main, merged } = rankOnline(
      [row('你好，李焕英', '2021'), row('你好李焕英 花絮', '2021')],
      '你好李焕英',
      [{ title: '你好，李焕英', year: 2021 }]
    )
    expect(merged).toBe(1)
    expect(main.map(r => r.title)).toEqual(['你好李焕英 花絮'])
    expect(
      rankOnline([row('你好，李焕英', '')], '你好李焕英', [
        { title: '你好，李焕英', year: 2021 },
      ]).merged
    ).toBe(1)
    expect(
      rankOnline([row('你好，李焕英', '2020')], '你好李焕英', [
        { title: '你好，李焕英', year: 2021 },
      ]).merged
    ).toBe(0)
  })

  it('同分按年份新的在前，再按源多的在前', () => {
    const { main } = rankOnline(
      [
        row('流浪地球', '2019', '电影', ['A']),
        row('流浪地球', '2023', '电影', ['A']),
        row('流浪地球', '2023', '电影', ['A', 'B']),
      ],
      '流浪地球'
    )
    expect(main.map(r => `${r.year}:${r.sources.length}`)).toEqual([
      '2023:2',
      '2023:1',
      '2019:1',
    ])
  })
})

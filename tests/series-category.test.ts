/**
 * 剧的分类：按 TMDB 类型归成 剧集 / 动漫 / 综艺 / 纪录片；追更按分类选转存文件夹。
 */
import { describe, expect, it } from 'vitest'

import {
  categoriesIn,
  categoryOfSeries,
} from '../src/renderer/src/features/autograb/autograb-rules'
import {
  categoryOf,
  categoryOfGenres,
} from '../src/shared/contract/series-category'
import { type AutograbSeries, autograb } from '../src/shared/contract/autograb'
import { parseState } from '../src/main/autograb/state'
import { child, episode, setup } from './autograb-harness'

describe('类型 → 分类', () => {
  it('纪录片、综艺（真人秀 / 脱口秀）、动漫（动画）优先，其余是剧集', () => {
    expect(categoryOfGenres([18, 80])).toBe('tv')
    expect(categoryOfGenres([16, 10759])).toBe('anime')
    expect(categoryOfGenres([10764])).toBe('variety')
    expect(categoryOfGenres([10767, 35])).toBe('variety')
    expect(categoryOfGenres([99, 16])).toBe('documentary')
    expect(categoryOfGenres([])).toBe('tv')
  })

  it('认不出的分类返回 undefined', () => {
    expect(categoryOf('anime')).toBe('anime')
    expect(categoryOf('movie')).toBeUndefined()
  })

  it('界面：没给分类的剧当剧集，筛选只列出现过的分类并按固定先后', () => {
    const s = (category?: AutograbSeries['category']): AutograbSeries =>
      ({ seriesId: 1, category }) as AutograbSeries
    expect(categoryOfSeries(s())).toBe('tv')
    expect(categoriesIn([s('documentary'), s('anime'), s()])).toEqual([
      'tv',
      'anime',
      'documentary',
    ])
  })
})

describe('分类默认文件夹', () => {
  const anime = { ...episode(5), category: 'anime' as const }

  it('动漫存到自己的分类文件夹，剧集仍用剧集默认目录；单独选的文件夹优先', async () => {
    const h = setup([anime])
    h.deps.defaultFolder = () => ({ cid: '66', name: '剧集' })
    await h.service.setCategoryFolder('anime', '77', '动漫')
    await h.service.setPolicy({ mode: 'auto', confirmFirst: 0 })
    await h.service.tick()
    expect(h.received).toEqual([['101']])
    expect([...h.files.keys()]).toEqual([child('77')])

    const overview = await h.service.overview()
    expect(overview.categoryFolders).toEqual({
      anime: { cid: '77', name: '动漫' },
    })
    expect(overview.series[0].category).toBe('anime')
  })

  it('清掉分类文件夹后总览里不再有它', async () => {
    const h = setup([anime])
    await h.service.setCategoryFolder('anime', '77', '动漫')
    await h.service.setCategoryFolder('anime', '', '')
    expect((await h.service.overview()).categoryFolders).toEqual({})
  })

  it('分类文件夹重启后仍在（读回存档不丢）', () => {
    const raw = JSON.parse(
      JSON.stringify({
        version: 1,
        policy: {},
        categoryFolders: { anime: { cid: '77', name: '动漫' } },
      })
    )
    expect(parseState(raw, 0).categoryFolders).toEqual({
      anime: { cid: '77', name: '动漫' },
    })
  })

  it('设分类文件夹的参数校验接受数字 cid、拒绝非数字', () => {
    const parse = autograb.calls.setCategoryFolder.parse
    expect(parse(['anime', '3542635136703006276', '动漫'])).toEqual([
      'anime',
      '3542635136703006276',
      '动漫',
    ])
    expect(() => parse(['anime', 'abc', '动漫'])).toThrow('cid')
  })
})

import { describe, expect, it } from 'vitest'

import {
  eraYears,
  normalizeEra,
  parseDiscoverQuery,
  pickGenre,
  requestedYears,
} from '../src/renderer/src/features/discover/discover-query'
import {
  type DiscoverTitle,
  type LibraryTitleLike,
  findInLibrary,
  sizeText,
  splitByLibrary,
  titleKey,
} from '../src/renderer/src/features/discover/discover-rules'
import { discover } from '../src/shared/contract/discover'

const discoverTarget = (raw: unknown): unknown =>
  discover.calls.find.parse([raw])[0]

const title = (over: Partial<DiscoverTitle> = {}): DiscoverTitle => ({
  doubanId: '1',
  kind: 'movie',
  title: '黑客帝国',
  originalTitle: '',
  year: 1999,
  rate: '9.1',
  cover: '',
  tmdbId: null,
  ...over,
})
const item = (
  id: number,
  name: string,
  year: number | null,
  tmdb?: string,
  originalTitle: string | null = null
): LibraryTitleLike => ({
  id,
  title: name,
  originalTitle,
  year,
  providerIds: { tmdb },
})

describe('库外发现 · 和本地库去重', () => {
  it('TMDB id 相同即同一部（片名写法不同也算）', () => {
    const lib = [item(1, 'The Matrix', 1999, '603')]
    expect(findInLibrary(title({ tmdbId: '603' }), lib)?.id).toBe(1)
  })

  it('没有 TMDB id 时按片名 + 年份：归一化后相等、年份差不超过 1 年', () => {
    const lib = [item(2, '黑客帝国 ', 2000), item(3, '黑客帝国2', 2003)]
    expect(findInLibrary(title(), lib)?.id).toBe(2)
    expect(findInLibrary(title({ year: 1995 }), lib)).toBeNull()
    // 原名对上库里的原名也算
    expect(
      findInLibrary(title({ title: '骇客任务', originalTitle: 'The Matrix' }), [
        item(4, '黑客帝国', 1999, undefined, 'The Matrix'),
      ])?.id
    ).toBe(4)
  })

  it('TMDB id 对不上时退回片名 + 年份', () => {
    const lib = [item(5, '黑客帝国', 1999, '999')]
    expect(findInLibrary(title({ tmdbId: '603' }), lib)?.id).toBe(5)
  })

  it('拆分：库里有的给播放，库外的保持豆瓣顺序；同一条目只出现一次', () => {
    const a = title({ doubanId: 'a', title: '甲' })
    const b = title({ doubanId: 'b', title: '乙' })
    const c = title({ doubanId: 'c', title: '甲' })
    const lib = item(9, '甲', 1999)
    const result = splitByLibrary([a, b, c], t =>
      t.title === '甲' ? lib : null
    )
    expect(result.local.map(l => l.title.doubanId)).toEqual(['a'])
    expect(result.missing.map(m => m.doubanId)).toEqual(['b'])
  })

  it('状态键与体积文字', () => {
    expect(titleKey({ title: '黑客 帝国', year: 1999 })).toBe(
      titleKey({ title: '黑客帝国', year: 1999 })
    )
    expect(sizeText(4.3 * 1024 ** 3)).toBe('4.3 GB')
    expect(sizeText(820 * 1024 ** 2)).toBe('820 MB')
    expect(sizeText(0)).toBe('大小未知')
  })
})

describe('库外发现 · discover 参数解析', () => {
  it('「90 年代的科幻片」→ 电影 · 科幻 · 90年代 · 评分排序', () => {
    expect(parseDiscoverQuery('movie', '类型=科幻;年代=90年代', null)).toEqual({
      kind: 'movie',
      tag: '',
      genre: '科幻',
      region: '',
      era: '90年代',
      sort: 'S',
      minRating: 0,
    })
  })

  it('别名：香港 → 中国香港、1990s → 90年代、热度 → T；评分下限只认白名单', () => {
    expect(
      parseDiscoverQuery('movie', '地区：香港，年代:1990s 排序=热度', 8)
    ).toMatchObject({
      region: '中国香港',
      era: '90年代',
      sort: 'T',
      minRating: 8,
    })
    expect(parseDiscoverQuery('movie', '类型=科幻', 7.5)?.minRating).toBe(0)
  })

  it('不认识的值丢掉；一个条件都没有时返回 null；target 不对返回 null', () => {
    expect(
      parseDiscoverQuery('movie', '类型=不存在;地区=火星', null)
    ).toBeNull()
    expect(parseDiscoverQuery('movie', '', null)).toBeNull()
    expect(parseDiscoverQuery('anime', '类型=科幻', null)).toBeNull()
    expect(parseDiscoverQuery('tv', '类型=古装', null)).toMatchObject({
      kind: 'tv',
      genre: '古装',
    })
    // 剧集没有「战争」这个类型
    expect(parseDiscoverQuery('tv', '类型=战争', null)).toBeNull()
  })

  it('只给排序或评分下限也算条件', () => {
    expect(parseDiscoverQuery('movie', '排序=高分', null)).toMatchObject({
      sort: 'S',
    })
    expect(parseDiscoverQuery('movie', '', 9)).toMatchObject({ minRating: 9 })
  })

  it('年代写法统一', () => {
    expect(normalizeEra('90年代')).toBe('90年代')
    expect(normalizeEra('1980s')).toBe('80年代')
    expect(normalizeEra('2010年代')).toBe('2010年代')
    expect(normalizeEra('00年代')).toBe('2000年代')
    expect(normalizeEra('70年代')).toBe('更早')
    expect(normalizeEra('1997')).toBe('1997')
    expect(normalizeEra('很久以前')).toBe('')
  })

  it('80 年代以前：豆瓣档落到「更早」，另给出真正的年份范围', () => {
    expect(eraYears('70年代')).toEqual([1970, 1979])
    expect(eraYears('1960s')).toEqual([1960, 1969])
    expect(eraYears('90年代')).toBeNull()
    expect(eraYears('1997')).toBeNull()
    expect(requestedYears('类型=科幻;年代=70年代')).toEqual([1970, 1979])
    expect(requestedYears('类型=科幻;年代=90年代')).toBeNull()
    expect(requestedYears('类型=科幻')).toBeNull()
  })

  it('类型：取写法里最早出现的白名单类型，不按白名单顺序', () => {
    expect(pickGenre('动画喜剧', 'movie')).toBe('动画')
    expect(pickGenre('犯罪剧情', 'movie')).toBe('犯罪')
    expect(pickGenre('喜剧片', 'movie')).toBe('喜剧')
    expect(pickGenre('剧情片', 'movie')).toBe('剧情')
    expect(pickGenre('古装剧', 'tv')).toBe('古装')
    expect(pickGenre('不存在', 'movie')).toBe('')
  })
})

describe('库外发现 · IPC 参数校验', () => {
  it('只收电影、片名非空、年份在范围内', () => {
    expect(
      discoverTarget({ kind: 'movie', title: ' 星际穿越 ', year: 2014 })
    ).toEqual({
      kind: 'movie',
      title: '星际穿越',
      originalTitle: '',
      year: 2014,
    })
    expect(() => discoverTarget({ kind: 'tv', title: 'x' })).toThrow()
    expect(() => discoverTarget({ kind: 'movie', title: '  ' })).toThrow()
    expect(() =>
      discoverTarget({ kind: 'movie', title: 'x', year: 1800 })
    ).toThrow()
  })
})

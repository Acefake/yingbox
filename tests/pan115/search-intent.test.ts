/**
 * 网盘搜索词的集号意图（search-intent）与分享标题和这一集的关系（episode-hint）。
 */
import { describe, expect, it } from 'vitest'

import {
  episodeHint,
  episodeRangeOfTitle,
  fileIsEpisode,
  rankByEpisode,
  seasonOfTitle,
  seasonRangeOfTitle,
} from '../../src/shared/netdisk/episode-hint'
import {
  episodeLabel,
  episodeTargetOf,
  parseSearchIntent,
} from '../../src/shared/netdisk/search-intent'

describe('parseSearchIntent', () => {
  it.each([
    ['嫁金钗 S01E20', '嫁金钗', 1, 20],
    ['嫁金钗 s2e5', '嫁金钗', 2, 5],
    ['嫁金钗 第20集', '嫁金钗', undefined, 20],
    ['嫁金钗第二十集', '嫁金钗', undefined, 20],
    ['嫁金钗 EP20', '嫁金钗', undefined, 20],
    ['嫁金钗 E20', '嫁金钗', undefined, 20],
    ['嫁金钗 第二季 第3集', '嫁金钗', 2, 3],
    ['嫁金钗 第二季', '嫁金钗', 2, undefined],
    ['The Bear Season 3', 'The Bear', 3, undefined],
    ['嫁金钗 (2026) S01E20', '嫁金钗', 1, 20],
  ])('%s → %s S%s E%s', (input, query, season, episode) => {
    const intent = parseSearchIntent(input)
    expect(intent.query).toBe(query)
    expect(intent.kind).toBe('tv')
    expect(intent.season).toBe(season)
    expect(intent.episode).toBe(episode)
  })

  it.each([
    '沙丘2',
    '1917',
    'WALL·E 2008',
    'Blade Runner 2049',
    '奥本海默 (2023)',
    'magnet:?xt=urn:btih:abc',
    'https://115.com/s/abc',
  ])('%s 不判剧集、原样搜索', input => {
    expect(parseSearchIntent(input)).toEqual({ query: input, kind: null })
  })

  it('只有集号时搜索词什么都不剩：用原词', () => {
    expect(parseSearchIntent('第20集').query).toBe('第20集')
  })

  it('要找的那一集与文案', () => {
    const intent = parseSearchIntent('嫁金钗 S01E20')
    const target = episodeTargetOf(intent)
    expect(target).toEqual({ season: 1, episode: 20 })
    expect(episodeLabel(target!)).toBe('第 1 季 第 20 集')
    expect(episodeLabel({ episode: 20 })).toBe('第 20 集')
    expect(episodeTargetOf(parseSearchIntent('嫁金钗 第二季'))).toBeNull()
  })
})

describe('episodeHint', () => {
  const ep20 = { season: 1, episode: 20 }

  it.each([
    ['嫁金钗 (2026) S01E20 1080p WEB-DL', 'exact'],
    ['嫁金钗 第20集 4K', 'exact'],
    ['嫁金钗 EP20 中字', 'exact'],
    ['嫁金钗 更新至20集', 'exact'],
    ['嫁金钗 更新至第24集 2160p', 'covers'],
    ['嫁金钗 已更22集', 'covers'],
    ['嫁金钗 全30集 4K', 'covers'],
    ['嫁金钗 30集全', 'covers'],
    ['嫁金钗 01-24 1080p', 'covers'],
    ['嫁金钗 第1-20集', 'covers'],
    ['嫁金钗 S01E01-E24', 'covers'],
    ['嫁金钗 EP01-30', 'covers'],
    ['嫁金钗 完结 4K', 'covers'],
    ['嫁金钗 更新至S01E22', 'covers'],
    ['嫁金钗 更新至EP22 4K', 'covers'],
    ['嫁金钗 第1集-第24集', 'covers'],
    ['嫁金钗 EP01-EP24', 'covers'],
    ['嫁金钗 E01-E24', 'covers'],
    ['嫁金钗 S01E01-S01E24', 'covers'],
    ['嫁金钗 1-24集', 'covers'],
    ['嫁金钗 全24集', 'covers'],
    ['嫁金钗 S01-S03', 'covers'],
    ['嫁金钗 第1-3季 1080p', 'covers'],
    ['嫁金钗 第一季至第三季', 'covers'],
    ['嫁金钗 S01-S03 全24集', 'covers'],
    ['嫁金钗 2160p HEVC 2026', 'unknown'],
    ['嫁金钗 S01 1080p', 'unknown'],
    ['嫁金钗 更新至18集', 'other'],
    ['嫁金钗 S01E19', 'other'],
    ['嫁金钗 第21集', 'other'],
    ['嫁金钗 01-10', 'other'],
    ['嫁金钗 全12集', 'other'],
    ['嫁金钗 S02E20', 'other'],
    ['嫁金钗 第二季 全30集', 'other'],
    ['嫁金钗 更新至S01E18', 'other'],
    ['嫁金钗 第1集-第10集', 'other'],
    ['嫁金钗 EP01-EP12', 'other'],
    ['嫁金钗 S02-S03', 'other'],
    ['嫁金钗 第2-3季', 'other'],
    ['嫁金钗 S01-S03 全12集', 'other'],
  ])('%s → %s', (title, hint) => {
    expect(episodeHint(title, ep20)).toBe(hint)
  })

  it('要找的正好是区间 / 更新至的最后一集：exact 或 covers 都算在这一集里', () => {
    const ep22 = { season: 1, episode: 22 }
    expect(episodeHint('嫁金钗 更新至S01E22', ep22)).toBe('exact')
    expect(episodeHint('嫁金钗 第1集-第22集', ep22)).toBe('covers')
    expect(episodeHint('嫁金钗 S01-S03', { season: 2, episode: 5 })).toBe(
      'covers'
    )
    expect(episodeHint('嫁金钗 S01-S03', { season: 4, episode: 5 })).toBe(
      'other'
    )
  })

  it('季区间', () => {
    expect(seasonRangeOfTitle('嫁金钗 S01-S03')).toEqual([1, 3])
    expect(seasonRangeOfTitle('嫁金钗 Season 1-2')).toEqual([1, 2])
    expect(seasonRangeOfTitle('嫁金钗 第一季至第三季')).toEqual([1, 3])
    expect(seasonRangeOfTitle('嫁金钗 S01E01-E24')).toBeNull()
    expect(episodeRangeOfTitle('嫁金钗 第1集-第24集')).toEqual([1, 24])
  })

  it('搜索没写季号时不按季区分', () => {
    expect(episodeHint('嫁金钗 S02E20', { episode: 20 })).toBe('exact')
  })

  it('日期、分辨率、编码里的数字不当集号', () => {
    expect(episodeRangeOfTitle('嫁金钗 2026-10-27 更新')).toBeNull()
    expect(episodeRangeOfTitle('嫁金钗 x264-10bit')).toBeNull()
    expect(episodeHint('嫁金钗 H.265 5.1 2026-10-27', ep20)).toBe('unknown')
  })

  it('季号', () => {
    expect(seasonOfTitle('嫁金钗 S02E05')).toBe(2)
    expect(seasonOfTitle('嫁金钗 第三季')).toBe(3)
    expect(seasonOfTitle('嫁金钗 Season 4')).toBe(4)
    expect(seasonOfTitle('嫁金钗 4K')).toBeUndefined()
  })
})

describe('rankByEpisode', () => {
  const titles = [
    '嫁金钗 4K',
    '嫁金钗 第19集',
    '嫁金钗 更新至24集',
    '嫁金钗 S01E20',
    '嫁金钗 1080p',
    '嫁金钗 01-10',
  ]

  it('正好这一集 → 包含这一集 → 没写集号，别的集单独放', () => {
    const { main, others } = rankByEpisode(titles, { episode: 20 }, t => t)
    expect(main).toEqual([
      '嫁金钗 S01E20',
      '嫁金钗 更新至24集',
      '嫁金钗 4K',
      '嫁金钗 1080p',
    ])
    expect(others).toEqual(['嫁金钗 第19集', '嫁金钗 01-10'])
  })

  it('没有目标集时原样返回', () => {
    expect(rankByEpisode(titles, null, t => t)).toEqual({
      main: titles,
      others: [],
    })
  })
})

describe('fileIsEpisode', () => {
  it('文件名是这一集', () => {
    expect(fileIsEpisode('嫁金钗.S01E20.2160p.mkv', { episode: 20 })).toBe(true)
    expect(fileIsEpisode('嫁金钗 第20集.mp4', { season: 1, episode: 20 })).toBe(
      true
    )
    expect(fileIsEpisode('20.mp4', { episode: 20 }, '嫁金钗 第一季')).toBe(true)
  })

  it('别的集、别的季、合并文件、文件夹不算', () => {
    expect(fileIsEpisode('嫁金钗.S01E19.mkv', { episode: 20 })).toBe(false)
    expect(fileIsEpisode('嫁金钗.S02E20.mkv', { season: 1, episode: 20 })).toBe(
      false
    )
    expect(fileIsEpisode('嫁金钗.S01E19-E20.mkv', { episode: 20 })).toBe(false)
    expect(fileIsEpisode('嫁金钗 第一季', { episode: 20 })).toBe(false)
  })
})

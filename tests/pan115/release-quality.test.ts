/**
 * 网盘结果的画质规则：从标题认分辨率 / 片源 / 动态范围，角标两行字，最佳版本与排序。
 */
import { describe, expect, it } from 'vitest'

import {
  parseReleaseQuality,
  pickBest,
  qualityBadge,
  qualityLabel,
  sizeFromTitle,
  sortReleases,
} from '../../src/renderer/src/features/netdisk/utils/release-quality'

const badge = (title: string): ReturnType<typeof qualityBadge> =>
  qualityBadge(parseReleaseQuality(title))

describe('parseReleaseQuality / qualityBadge', () => {
  it('4K REMUX：Remux 先于 BluRay', () => {
    const q = parseReleaseQuality(
      '电影｜流浪地球2 (2023) 2160P.Ultra HD BluRay Remux.DoVi.HDR'
    )
    expect(q).toMatchObject({
      resolution: '4K',
      source: 'REMUX',
      dolbyVision: true,
      hdr: false,
    })
    expect(qualityBadge(q)).toEqual({ main: '4K', sub: 'REMUX' })
    expect(qualityLabel(q)).toBe('4K REMUX 杜比视界')
  })

  it('4K WEB、1080 BD（BD1080P 连写）、720 HDTV', () => {
    expect(badge('流浪地球2：再次冒险 (2024) WEB-DL 2160p')).toEqual({
      main: '4K',
      sub: 'WEB',
    })
    expect(badge('流浪地球.2019.BD1080P.国英双语.中英双字【纯净版】')).toEqual({
      main: '1080',
      sub: 'BD',
    })
    expect(badge('Some.Show.S01E01.720p.HDTV.x264')).toEqual({
      main: '720',
      sub: 'HDTV',
    })
  })

  it('只认出分辨率时下行为空；都认不出为 null', () => {
    expect(badge('流浪地球 (2019) 4K高码 TrueHD Atmos')).toEqual({
      main: '4K',
      sub: '',
    })
    expect(badge('流浪地球 全集 合集')).toBeNull()
  })

  it('只认出片源时上行放片源', () => {
    expect(badge('流浪地球 蓝光原盘')).toEqual({ main: 'BD', sub: '' })
  })

  it('不误认：DVD 不是杜比视界，HDRip 不是 HDR，10800 不是 1080', () => {
    const dvd = parseReleaseQuality('Movie.DVD.x264')
    expect(dvd.dolbyVision).toBe(false)
    expect(parseReleaseQuality('Movie.HDRip').hdr).toBe(false)
    expect(parseReleaseQuality('Movie 10800 帧').resolution).toBeNull()
    expect(parseReleaseQuality('Movie.HDR10+.2160p').hdr).toBe(true)
  })

  it('排序分：分辨率 > 片源 > 动态范围', () => {
    const rank = (t: string): number => parseReleaseQuality(t).rank
    expect(rank('4K WEB-DL')).toBeGreaterThan(rank('1080p BluRay Remux'))
    expect(rank('2160p Remux')).toBeGreaterThan(rank('2160p BluRay'))
    expect(rank('2160p WEB-DL DV')).toBeGreaterThan(rank('2160p WEB-DL HDR'))
    expect(rank('无信息')).toBe(0)
  })
})

describe('sizeFromTitle', () => {
  it('认 GB / G / TB / MB，没写为 0', () => {
    expect(sizeFromTitle('xx 106.63 GB')).toBe(Math.round(106.63 * 1024 ** 3))
    expect(sizeFromTitle('xx【73.3G】')).toBe(Math.round(73.3 * 1024 ** 3))
    expect(sizeFromTitle('1.2TB')).toBe(Math.round(1.2 * 1024 ** 4))
    expect(sizeFromTitle('700MB')).toBe(700 * 1024 ** 2)
    expect(sizeFromTitle('2160p')).toBe(0)
  })
})

describe('pickBest / sortReleases', () => {
  const rows = [
    { title: 'A 1080p WEB-DL', datetime: '2024-01-01T00:00:00Z' },
    { title: 'B 2160p BluRay Remux', datetime: '2023-01-01T00:00:00Z' },
    { title: 'C 2160p BluRay Remux 80GB', datetime: '2025-01-01T00:00:00Z' },
    { title: 'D 无信息' },
  ]

  it('最佳取最高分，同分取靠前；空列表为 null', () => {
    expect(pickBest(rows, r => r.title)?.item.title).toMatch(/^B/)
    expect(pickBest([], (r: { title: string }) => r.title)).toBeNull()
  })

  it('排序不改原数组，同分保持原顺序', () => {
    const titles = (sort: Parameters<typeof sortReleases>[1]): string[] =>
      sortReleases(rows, sort, r => r).map(r => r.title[0])
    expect(titles('default')).toEqual(['A', 'B', 'C', 'D'])
    expect(titles('quality')).toEqual(['B', 'C', 'A', 'D'])
    expect(titles('date')).toEqual(['C', 'A', 'B', 'D'])
    expect(titles('size')).toEqual(['C', 'A', 'B', 'D'])
    expect(rows[0].title).toMatch(/^A/)
  })
})

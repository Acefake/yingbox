/**
 * 追更设置跟着剧走：片库重建（换成混合库、重新扫描）后同一部剧换了条目 id，
 * 原 id 下的设置与各集记录要并到新 id 上，追更页不能出现两部同名的剧。
 * 只并片库确认已经没有的旧 id；有 TMDB id 时按 id 认，老设置没有 id 时按唯一的同名剧认。
 */
import { describe, expect, it } from 'vitest'

import { AIR, episode, setup } from './autograb-harness'

/** 旧 id 2933 下的设置与一条已入库记录（版本 1 的状态文件） */
const legacy = (tmdbId?: string): unknown => ({
  version: 1,
  enabled: true,
  policy: { mode: 'confirm' },
  series: {
    2933: {
      title: '繁花',
      mode: 'auto',
      cid: '555',
      cidName: '繁花 (2026)',
      confirmed: 8,
      prefs: {},
      confirmFirst: 3,
      ...(tmdbId ? { tmdbId } : {}),
    },
  },
  episodes: {
    '2933:1:4': {
      key: '2933:1:4',
      seriesId: 2933,
      seriesTitle: '繁花',
      season: 1,
      episode: 4,
      airDate: AIR,
      status: 'done',
      attempts: 1,
      nextTry: null,
      candidates: [],
      error: null,
      notified: true,
    },
  },
})

const withTmdb = (n: number, tmdbId: string): ReturnType<typeof episode> => ({
  ...episode(n),
  tmdbId,
})

const sortedIds = (ids: number[]): number[] => [...ids].sort((a, b) => a - b)

describe('剧换了条目 id', () => {
  it('老设置没有 TMDB id、旧条目已不在片库：按剧名并到新 id，方式、文件夹、确认数都保留', async () => {
    const h = setup([episode(5)], legacy())
    await h.service.tick()
    const overview = await h.service.overview()
    const same = overview.series.filter(s => s.title === '繁花')
    expect(same).toHaveLength(1)
    expect(same[0]).toMatchObject({
      seriesId: 7,
      mode: 'auto',
      cid: '555',
      confirmed: 8,
    })
    const keys = overview.episodes.map(e => e.key)
    expect(keys).toContain('7:1:4')
    expect(keys).not.toContain('2933:1:4')
  })

  it('日历里有两部同名的剧时，没有 TMDB id 的老设置不并', async () => {
    const other = { ...episode(5), seriesId: 8 }
    const h = setup([episode(5), other], legacy())
    await h.service.tick()
    const ids = (await h.service.overview()).series.map(s => s.seriesId)
    expect(sortedIds(ids)).toEqual([7, 8, 2933])
  })

  it('两边都有 TMDB id 时按 id 认：同名但不是同一部的不并', async () => {
    const h = setup([withTmdb(5, '300146')], legacy('999'))
    await h.service.tick()
    const ids = (await h.service.overview()).series.map(s => s.seriesId)
    expect(sortedIds(ids)).toEqual([7, 2933])
  })

  it('旧条目还在片库（只是不在近期日历里）时不并', async () => {
    const h = setup([withTmdb(5, '300146')], legacy('300146'))
    h.deps.seriesExists = async () => true
    await h.service.tick()
    const ids = (await h.service.overview()).series.map(s => s.seriesId)
    expect(sortedIds(ids)).toEqual([7, 2933])
  })

  it('旧 id 被别的条目占用（剧名对不上）时当作已不在，照并', async () => {
    const h = setup([withTmdb(5, '300146')], legacy('300146'))
    h.deps.seriesExists = async (_id, title) => title !== '繁花'
    await h.service.tick()
    const ids = (await h.service.overview()).series.map(s => s.seriesId)
    expect(ids).toEqual([7])
  })

  it('片库查不了旧条目时不并', async () => {
    const h = setup([withTmdb(5, '300146')], legacy('300146'))
    h.deps.seriesExists = async () => {
      throw new Error('片库没响应')
    }
    await h.service.tick()
    const ids = (await h.service.overview()).series.map(s => s.seriesId)
    expect(sortedIds(ids)).toEqual([7, 2933])
  })

  it('TMDB id 相同就并，新 id 上已有的单独设置优先，确认数取大的', async () => {
    const h = setup([withTmdb(5, '300146')], legacy('300146'))
    await h.service.setSeries(7, { mode: 'confirm' })
    await h.service.tick()
    const series = (await h.service.overview()).series.filter(
      s => s.title === '繁花'
    )
    expect(series).toHaveLength(1)
    expect(series[0]).toMatchObject({
      seriesId: 7,
      mode: 'confirm',
      cid: '555',
      confirmed: 8,
    })
  })
})

describe('剧换了条目 id · 都不追时', () => {
  it('两条都是「不追」，打开追更页（不跑检查）也并成一部', async () => {
    const state = legacy() as { series: Record<string, { mode: string }> }
    state.series['2933'].mode = 'off'
    const h = setup([episode(5)], state)
    await h.service.setSeries(7, { mode: 'off' })
    const same = (await h.service.overview()).series.filter(
      s => s.title === '繁花'
    )
    expect(same).toHaveLength(1)
    expect(same[0]).toMatchObject({ seriesId: 7, cid: '555', confirmed: 8 })
  })
})

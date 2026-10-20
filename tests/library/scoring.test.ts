import { describe, expect, it } from 'vitest'
import type { Candidate } from '../../src/shared/library/provider'
import {
  DEFAULT_SCORING_OPTIONS,
  decide,
  normalizeTitle,
  rankCandidates,
  titleSimilarity,
} from '../../src/shared/library/scoring'

const movie = (id: string, extra: Partial<Candidate>): Candidate => ({
  ref: { provider: 'tmdb', kind: 'movie', id },
  title: '',
  ...extra,
})

describe('normalizeTitle', () => {
  it('繁简统一、全角转半角、去标点与重音', () => {
    expect(normalizeTitle('霸王別姬')).toBe(normalizeTitle('霸王别姬'))
    expect(normalizeTitle('復仇者聯盟４：終局之戰')).toBe(
      '复仇者联盟4 终局之战'
    )
    expect(normalizeTitle('Amélie')).toBe('amelie')
  })

  it('冠词、& 与罗马数字', () => {
    expect(normalizeTitle('The Matrix')).toBe('matrix')
    expect(normalizeTitle('Fast & Furious')).toBe('fast and furious')
    expect(normalizeTitle('The Godfather Part II')).toBe('godfather part 2')
    expect(normalizeTitle('Rocky IV')).toBe('rocky 4')
    expect(normalizeTitle('Kill Bill Vol. I')).toBe('kill bill vol 1')
    // 单独的 I 不在 Part/Vol 之后时不转换
    expect(normalizeTitle('I Robot')).toBe('i robot')
  })
})

describe('titleSimilarity', () => {
  it('词序不同但词相同视为一致', () => {
    expect(titleSimilarity('earth wandering', 'wandering earth')).toBe(1)
  })

  it('续集号不同时相似度明显下降', () => {
    expect(titleSimilarity('流浪地球', '流浪地球2')).toBeCloseTo(0.8)
  })
})

describe('rankCandidates / decide', () => {
  it('对 original_title / 别名 / 译名取最大相似度', () => {
    const [best] = rankCandidates(
      { kind: 'movie', titles: ['让子弹飞'], year: 2010 },
      [
        movie('1', {
          title: 'Let the Bullets Fly',
          translations: ['讓子彈飛'],
          year: 2010,
        }),
      ]
    )
    expect(best.breakdown.title).toBe(1)
    expect(best.score).toBe(1)
  })

  it('年份一致 / 差一年 / 不符', () => {
    const q = { kind: 'movie' as const, titles: ['Dune'], year: 2021 }
    const exact = rankCandidates(q, [
      movie('1', { title: 'Dune', year: 2021 }),
    ])[0]
    const near = rankCandidates(q, [
      movie('1', { title: 'Dune', year: 2020 }),
    ])[0]
    const off = rankCandidates(q, [
      movie('1', { title: 'Dune', year: 1984 }),
    ])[0]
    expect(exact.breakdown.year).toBe(1)
    expect(near.breakdown.year).toBe(0.7)
    expect(off.breakdown.year).toBe(0)
    expect(exact.score).toBeGreaterThan(near.score)
    expect(near.score).toBeGreaterThan(off.score)
  })

  it('同名不同年份的电影按年份区分，旧片落到待确认以下', () => {
    const ranked = rankCandidates(
      { kind: 'movie', titles: ['Dune'], year: 2021 },
      [
        movie('old', { title: 'Dune', year: 1984, popularity: 999 }),
        movie('new', { title: 'Dune', year: 2021, popularity: 10 }),
      ]
    )
    expect(ranked.map(r => r.candidate.ref.id)).toEqual(['new', 'old'])
    expect(decide(ranked)).toMatchObject({ status: 'auto' })
  })

  it('时长比对只用于电影', () => {
    const [close] = rankCandidates(
      { kind: 'movie', titles: ['Heat'], runtimeMinutes: 170 },
      [movie('1', { title: 'Heat', runtimeMinutes: 171 })]
    )
    const [far] = rankCandidates(
      { kind: 'movie', titles: ['Heat'], runtimeMinutes: 90 },
      [movie('1', { title: 'Heat', runtimeMinutes: 171 })]
    )
    expect(close.breakdown.runtime).toBe(1)
    expect(far.breakdown.runtime).toBe(0)
  })

  it('剧集按季 / 集数比对，绝对集数比对总集数', () => {
    const show: Candidate = {
      ref: { provider: 'tmdb', kind: 'tv', id: '1' },
      title: 'Show',
      seasons: [
        { season: 0, episodeCount: 5 },
        { season: 1, episodeCount: 10 },
        { season: 2, episodeCount: 8 },
      ],
    }
    const score = (q: object): number | undefined =>
      rankCandidates({ kind: 'tv', titles: ['Show'], ...q }, [show])[0]
        .breakdown.episodes
    expect(score({ season: 2, episodes: [8] })).toBe(1)
    expect(score({ season: 2, episodes: [9] })).toBe(0.3)
    expect(score({ season: 3, episodes: [1] })).toBe(0)
    expect(score({ episodes: [18], absolute: true })).toBe(1)
    expect(score({ episodes: [19], absolute: true })).toBe(0)
  })

  it('热度只决定同分候选的先后', () => {
    const ranked = rankCandidates({ kind: 'movie', titles: ['Hero'] }, [
      movie('a', { title: 'Hero', popularity: 1 }),
      movie('b', { title: 'Hero', popularity: 50 }),
      movie('c', { title: 'Heron', popularity: 1000 }),
    ])
    expect(ranked.map(r => r.candidate.ref.id)).toEqual(['b', 'a', 'c'])
  })

  it('阈值：≥0.85 自动，0.6–0.85 待确认（前 3），<0.6 未匹配，阈值可配置', () => {
    const q = { kind: 'movie' as const, titles: ['Inception'], year: 2010 }
    const ranked = rankCandidates(q, [
      movie('1', { title: 'Inception', year: 2008 }),
      movie('2', { title: 'Inceptio', year: 2008 }),
      movie('3', { title: 'Incept', year: 2008 }),
      movie('4', { title: 'Inc', year: 2008 }),
    ])
    const review = decide(ranked)
    expect(review.status).toBe('review')
    expect(review.status === 'review' && review.candidates).toHaveLength(3)

    const strict = decide(ranked, {
      ...DEFAULT_SCORING_OPTIONS,
      reviewThreshold: 0.9,
    })
    expect(strict.status).toBe('unmatched')
    const loose = decide(ranked, {
      ...DEFAULT_SCORING_OPTIONS,
      autoThreshold: 0.6,
    })
    expect(loose).toMatchObject({
      status: 'auto',
      best: { candidate: { ref: { id: '1' } } },
    })
  })
})

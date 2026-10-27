/**
 * 画质识别（shared/release/quality.ts）与版本分（shared/release/score.ts）：
 * 识别黄金用例、硬过滤、三种取向、候选排序、洗版的「更好」判断，以及追更认文件的两维分。
 */
import { describe, expect, it } from 'vitest'

import { AUTO_SCORE, matchFile } from '../src/main/autograb/match-rules'
import { matchMovieFile } from '../src/main/autograb/movies/movie-rules'
import {
  DEFAULT_GRAB_PREFS,
  type GrabPrefs,
  prefsOf,
} from '../src/shared/contract/grab-prefs'
import {
  fileQuality,
  parseReleaseQuality,
  qualitySpecs,
} from '../src/shared/release/quality'
import {
  isBetterVersion,
  rankCandidates,
  rejectByPrefs,
  versionScore,
  wantsUpgrade,
} from '../src/shared/release/score'

const GB = 1024 ** 3
const MB = 1024 ** 2
const prefs = (patch: Partial<GrabPrefs>): GrabPrefs => ({
  ...DEFAULT_GRAB_PREFS,
  ...patch,
})
const q = parseReleaseQuality

describe('画质识别', () => {
  it('认出分辨率、片源、动态范围、编码、中字、全景声', () => {
    const r = q('Dune.2024.2160p.UHD.BluRay.REMUX.DV.HDR.HEVC.Atmos.简繁中字')
    expect(r).toMatchObject({
      resolution: '4K',
      height: 2160,
      source: 'REMUX',
      dolbyVision: true,
      hdr: false,
      codec: 'HEVC',
      chineseSubs: true,
      atmos: true,
    })
    expect(qualitySpecs(r)).toEqual(['4K', 'REMUX', 'DV', '中字'])
    expect(q('繁花.E05.1080p.WEB-DL.x264').codec).toBe('AVC')
    expect(q('老片.576p.avi').height).toBe(480)
    expect(q('三体 4K 30GB').chineseSubs).toBe(false)
    expect(q('老电影 DVDRip').dolbyVision).toBe(false)
  })

  it('分享里的文件：分辨率只认文件名与文件夹，中字与片源可由分享标题补', () => {
    const r = fileQuality('繁花.E05.mkv', '', '繁花 4K 合集 WEB-DL 中字')
    expect(r.height).toBeNull()
    expect(r.source).toBe('WEB')
    expect(r.chineseSubs).toBe(true)
    expect(fileQuality('E05.mkv', '繁花 1080p', '').height).toBe(1080)
  })
})

describe('资源偏好 · 硬过滤', () => {
  it('最低分辨率、避开杜比视界 / HDR、必须中字、体积、排除词', () => {
    const reject = (
      text: string,
      p: Partial<GrabPrefs>,
      size = 2 * GB
    ): string | null => rejectByPrefs(q(text), size, text, prefs(p), 'tv')
    expect(reject('a.720p.mkv', { minResolution: '1080p' })).toBe('低于 1080p')
    // 认不出分辨率的不拦
    expect(reject('a.mkv', { minResolution: '1080p' })).toBeNull()
    expect(reject('a.2160p.DV.mkv', { dolbyVision: 'avoid' })).toContain(
      '杜比视界'
    )
    expect(reject('a.2160p.HDR10.mkv', { hdr: 'avoid' })).toContain('HDR')
    expect(reject('a.1080p.mkv', { chineseSubs: 'require' })).toBe(
      '没写中文字幕'
    )
    expect(reject('a.1080p.中字.mkv', { chineseSubs: 'require' })).toBeNull()
    expect(reject('a.mkv', {}, 10 * MB)).toBe('体积太小')
    expect(reject('a.mkv', { maxMb: 1024 })).toBe('体积太大')
    expect(reject('a.HDTV.mkv', { excludeWords: ['hdtv'] })).toBe(
      '含排除词「hdtv」'
    )
  })

  it('电影的默认体积范围是 500 MB – 80 GB', () => {
    const r = (size: number): string | null =>
      rejectByPrefs(q('a.mkv'), size, 'a', DEFAULT_GRAB_PREFS, 'movie')
    expect(r(300 * MB)).toBe('体积太小')
    expect(r(60 * GB)).toBeNull()
    expect(r(90 * GB)).toBe('体积太大')
  })
})

describe('版本分 · 取向', () => {
  const score = (text: string, p: Partial<GrabPrefs>, size = 4 * GB): number =>
    versionScore(q(text), size, text, prefs(p), 'movie').score

  it('画质优先：4K REMUX > 4K WEB > 1080p，体积大一些更好', () => {
    const p = { strategy: 'quality' as const }
    expect(score('a.2160p.REMUX.mkv', p, 60 * GB)).toBeGreaterThan(
      score('a.2160p.WEB-DL.mkv', p, 15 * GB)
    )
    expect(score('a.2160p.WEB-DL.mkv', p)).toBeGreaterThan(
      score('a.1080p.WEB-DL.mkv', p)
    )
  })

  it('省空间：1080p HEVC 小文件 > 4K REMUX', () => {
    const p = { strategy: 'compact' as const }
    expect(score('a.1080p.WEB-DL.x265.mkv', p, 2 * GB)).toBeGreaterThan(
      score('a.2160p.REMUX.mkv', p, 60 * GB)
    )
  })

  it('均衡：首选分辨率命中高于更高的分辨率；杜比视界优先时加分；中字加分', () => {
    const p = { resolution: '1080p' as const }
    expect(score('a.1080p.mkv', p)).toBeGreaterThan(score('a.2160p.mkv', p))
    expect(score('a.2160p.DV.mkv', { dolbyVision: 'prefer' })).toBeGreaterThan(
      score('a.2160p.mkv', { dolbyVision: 'prefer' })
    )
    expect(score('a.1080p.中字.mkv', {})).toBeGreaterThan(
      score('a.1080p.mkv', {})
    )
  })

  it('分数在 0–100 之间', () => {
    const s = score(
      'a.2160p.REMUX.DV.HDR.中字.ADWeb.mkv',
      {
        strategy: 'quality',
        dolbyVision: 'prefer',
        hdr: 'prefer',
        chineseSubs: 'prefer',
        preferWords: ['ADWeb', 'REMUX', 'DV'],
      },
      70 * GB
    )
    expect(s).toBeLessThanOrEqual(100)
    expect(s).toBeGreaterThan(0)
  })
})

describe('候选排序', () => {
  it('匹配分过线的在前，同组按版本分，再按匹配分', () => {
    const list = [
      { id: 'a', score: 60, quality: 99 },
      { id: 'b', score: 80, quality: 40 },
      { id: 'c', score: 75, quality: 70 },
      { id: 'd', score: 90, quality: 70 },
    ]
    expect(rankCandidates(list, 70).map(c => c.id)).toEqual([
      'd',
      'c',
      'b',
      'a',
    ])
  })
})

describe('洗版 · 更好的版本', () => {
  it('同分辨率：杜比视界优先时有 DV 算更好；画质优先时 REMUX 算更好；默认都不算', () => {
    const now = q('a.2160p.WEB-DL.mkv')
    const dv = q('a.2160p.WEB-DL.DV.mkv')
    const remux = q('a.2160p.REMUX.mkv')
    expect(isBetterVersion(now, dv, 2160)).toBe(false)
    expect(isBetterVersion(now, remux, 2160)).toBe(false)
    expect(
      isBetterVersion(now, dv, 2160, prefs({ dolbyVision: 'prefer' }))
    ).toBe(true)
    expect(
      isBetterVersion(now, remux, 2160, prefs({ strategy: 'quality' }))
    ).toBe(true)
    expect(
      isBetterVersion(now, remux, 2160, prefs({ strategy: 'balanced' }))
    ).toBe(false)
  })

  it('已达目标的文件：只有偏好让同分辨率版本算更好时才洗', () => {
    const now = q('a.2160p.WEB-DL.mkv')
    expect(wantsUpgrade(now, 2160)).toBe(false)
    expect(wantsUpgrade(now, 2160, prefs({ dolbyVision: 'prefer' }))).toBe(true)
    expect(wantsUpgrade(now, 2160, prefs({ strategy: 'quality' }))).toBe(true)
    expect(
      wantsUpgrade(q('a.2160p.REMUX.mkv'), 2160, prefs({ strategy: 'quality' }))
    ).toBe(false)
  })
})

describe('认文件 · 两维分', () => {
  const ep = { seriesTitle: '繁花', season: 1, episode: 5 }

  it('匹配分不受画质影响：确定是这一集的 720p 也能过全自动线', () => {
    const m720 = matchFile(
      { name: '繁花.S01E05.720p.mkv', size: GB, isDir: false },
      ep,
      { shareTitle: '繁花', folder: '' }
    )
    const m4k = matchFile(
      { name: '繁花.S01E05.2160p.WEB-DL.mkv', size: GB, isDir: false },
      ep,
      { shareTitle: '繁花', folder: '' }
    )
    expect(m720.ok && m4k.ok).toBe(true)
    if (!m720.ok || !m4k.ok) return
    expect(m720.score).toBe(m4k.score)
    expect(m720.score).toBeGreaterThanOrEqual(AUTO_SCORE)
    expect(m4k.quality).toBeGreaterThan(m720.quality)
    expect(m4k.specs).toEqual(['4K', 'WEB'])
  })

  it('只靠分享标题担保、没写季号的「第5集.mp4」不过全自动线', () => {
    const m = matchFile({ name: '第5集.mp4', size: GB, isDir: false }, ep, {
      shareTitle: '繁花 更新至5集',
      folder: '',
    })
    expect(m.ok).toBe(true)
    if (m.ok) expect(m.score).toBeLessThan(AUTO_SCORE)
  })

  it('电影：偏好里的最低分辨率与避开杜比视界拦得住', () => {
    const movie = { title: '流浪地球2', originalTitle: '', year: 2023 }
    const ctx = { shareTitle: '', folder: '' }
    const file = (
      name: string
    ): { name: string; size: number; isDir: boolean } => ({
      name,
      size: 8 * GB,
      isDir: false,
    })
    const p = prefsOf({ minResolution: '2160p', dolbyVision: 'avoid' })
    expect(
      matchMovieFile(
        file('流浪地球2.2023.1080p.WEB-DL.mkv'),
        movie,
        ctx,
        true,
        p
      ).ok
    ).toBe(false)
    expect(
      matchMovieFile(file('流浪地球2.2023.2160p.DV.mkv'), movie, ctx, true, p)
        .ok
    ).toBe(false)
    expect(
      matchMovieFile(
        file('流浪地球2.2023.2160p.WEB-DL.mkv'),
        movie,
        ctx,
        true,
        p
      ).ok
    ).toBe(true)
  })
})

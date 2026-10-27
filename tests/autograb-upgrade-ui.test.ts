import { describe, expect, it } from 'vitest'

import {
  entryName,
  movieNote,
  moviesNotice,
  resolutionText,
  targetsText,
  upgradeNotice,
  upgradeSummary,
  watchlistTitles,
} from '../src/renderer/src/features/autograb-upgrade/upgrade-rules'
import { policyOf } from '../src/shared/contract/grab-policy'
import type {
  MoviesOverview,
  TrackedMovie,
  UpgradeEntry,
  UpgradeOverview,
} from '../src/shared/contract/autograb-upgrade'

const counts = {
  waiting: 0,
  found: 0,
  saved: 0,
  replaced: 0,
  cleaned: 0,
  ignored: 0,
}
const upgrade: UpgradeOverview = {
  enabled: true,
  targets: { movie: 1080, tv: 1080 },
  ready: { loggedIn: true, pansou: true, cloudLibraries: true },
  scannedAt: 1,
  pauseReason: null,
  counts,
  entries: [],
  running: false,
}

describe('洗版 / 电影面板规则', () => {
  it('分辨率与目标（首选分辨率）', () => {
    expect(resolutionText(2160)).toBe('4K')
    expect(resolutionText(720)).toBe('720p')
    expect(resolutionText(null)).toBe('未知')
    expect(targetsText({ movie: 2160, tv: 2160 })).toBe('4K')
    expect(targetsText({ movie: 2160, tv: 1080 })).toBe('电影 4K / 剧集 1080p')
  })

  it('条目名：剧集带季集号，电影带年份', () => {
    const base = {
      title: '繁花',
      year: 2023,
      season: 1,
      episode: 5,
    } as UpgradeEntry
    expect(entryName({ ...base, kind: 'episode' })).toBe('繁花 S01E05')
    expect(entryName({ ...base, kind: 'movie' })).toBe('繁花 (2023)')
  })

  it('提示优先级：登录 > PanSou > 网盘库 > 暂停', () => {
    expect(upgradeNotice(upgrade)).toBeNull()
    expect(
      upgradeNotice({
        ...upgrade,
        ready: { loggedIn: false, pansou: false, cloudLibraries: false },
      })
    ).toContain('扫码')
    expect(
      upgradeNotice({
        ...upgrade,
        ready: { loggedIn: true, pansou: true, cloudLibraries: false },
      })
    ).toContain('CloudDrive2')
    expect(upgradeNotice({ ...upgrade, pauseReason: '暂停' })).toBe('暂停')
    const movies: MoviesOverview = {
      cid: '',
      cidName: '',
      policy: policyOf(undefined, 'movie'),
      defaultFolder: { cid: '0', name: '' },
      ready: { loggedIn: true, pansou: true, tmdb: false },
      pauseReason: null,
      movies: [],
      running: false,
    }
    expect(moviesNotice(movies)).toContain('TMDB')
  })

  it('概况', () => {
    expect(upgradeSummary({ ...upgrade, enabled: false })).toContain(
      '不自动替换'
    )
    expect(upgradeSummary(upgrade)).toBe('片库里没有不如首选（1080p）的文件')
    expect(
      upgradeSummary({
        ...upgrade,
        counts: { ...counts, waiting: 10, found: 2 },
      })
    ).toBe('12 个文件不如首选（1080p），2 个有更清楚的版本')
  })

  it('电影说明与想看片名', () => {
    const m = {
      status: 'upcoming',
      releaseDate: '2026-11-10',
      dateSource: 'digital',
      attempts: 0,
      error: null,
    } as TrackedMovie
    expect(movieNote(m)).toBe('2026-11-10 数字发行后开始搜')
    expect(movieNote({ ...m, releaseDate: null })).toContain('还没有发行日期')
    expect(movieNote({ ...m, status: 'searching', attempts: 3 })).toContain(
      '已搜 3 次'
    )
    expect(
      watchlistTitles([
        { section: 'online', title: 'A' },
        { section: 'movie', title: 'B' },
        { section: 'online', title: 'A ' },
      ])
    ).toEqual(['A'])
  })
})

import { describe, expect, it } from 'vitest'

import {
  confirmsLeft,
  episodeCode,
  episodeNote,
  overviewNotice,
  sizeText,
} from '../src/renderer/src/features/autograb/autograb-rules'
import type {
  AutograbEpisode,
  AutograbOverview,
} from '../src/shared/contract/autograb'

const base: AutograbOverview = {
  enabled: true,
  pausedUntil: null,
  pauseReason: null,
  ready: { loggedIn: true, pansou: true },
  today: { snaps: 0, receives: 0 },
  series: [],
  episodes: [],
  running: false,
}

describe('追更面板规则', () => {
  it('提示优先级：登录 > PanSou > 暂停 > 关闭', () => {
    expect(overviewNotice(base)).toBeNull()
    expect(
      overviewNotice({ ...base, ready: { loggedIn: false, pansou: false } })
    ).toContain('扫码')
    expect(
      overviewNotice({ ...base, ready: { loggedIn: true, pansou: false } })
    ).toContain('PanSou')
    expect(
      overviewNotice({ ...base, pausedUntil: 1, pauseReason: '风控' })
    ).toBe('风控')
    expect(overviewNotice({ ...base, enabled: false })).toBe('追更已关闭')
  })

  it('集号、体积、确认数', () => {
    expect(episodeCode({ season: 1, episode: 5 })).toBe('S01E05')
    expect(sizeText(2 * 1024 ** 3)).toBe('2.0 GB')
    expect(sizeText(300 * 1024 ** 2)).toBe('300 MB')
    expect(sizeText(0)).toBe('')
    expect(confirmsLeft(1)).toBe(2)
    expect(confirmsLeft(5)).toBe(0)
  })

  it('说明：错误优先，其次下次搜索时间', () => {
    const ep: AutograbEpisode = {
      key: '1:1:1',
      seriesId: 1,
      seriesTitle: 'A',
      season: 1,
      episode: 1,
      airDate: '2026-10-20',
      status: 'waiting',
      attempts: 2,
      nextTry: new Date(2026, 9, 26, 8, 0).getTime(),
      candidates: [],
      error: null,
    }
    expect(episodeNote(ep)).toBe('已搜 2 次，10月26日 08:00 再搜')
    expect(episodeNote({ ...ep, error: '没找到' })).toBe('没找到')
    expect(episodeNote({ ...ep, status: 'done', nextTry: null })).toBe('')
  })
})

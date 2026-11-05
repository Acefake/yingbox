/**
 * 在线剧追更（ADR-0049）：日历去重与年份规则、记录 ↔ 片库剧的对应表、契约参数校验。
 */
import { describe, expect, it } from 'vitest'

import { autograb } from '../src/shared/contract/autograb'
import { parseRpcParams } from '../src/shared/library/ipc'
import {
  type CalendarEntry,
  dropLinkedOnline,
  onlineYear,
} from '../src/renderer/src/features/calendar/calendar-rules'
import { sameTitle } from '../src/renderer/src/services/online-series-links'

const entry = (patch: Partial<CalendarEntry>): CalendarEntry => ({
  id: 'x',
  source: 'library',
  title: 'X',
  code: 'S01E01',
  episodeTitle: null,
  airDate: '2026-11-03',
  image: null,
  imageKind: 'remote',
  status: 'unwatched',
  newCount: 1,
  ...patch,
})
const lib = (seriesId: number): CalendarEntry =>
  entry({
    title: `片库剧${seriesId}`,
    id: `lib:${seriesId}`,
    library: { seriesId, season: 1, episode: 1, playable: false },
  })
const online = (recordId: string): CalendarEntry =>
  entry({
    id: recordId,
    title: `在线剧${recordId}`,
    source: 'online',
    airDate: null,
    online: { recordId, detail: {} },
  })

describe('在线卡与片库卡去重', () => {
  it('片库里这部剧在区间内有播出集：丢掉对应的在线卡', () => {
    const out = dropLinkedOnline(
      [lib(7), online('r1'), online('r2')],
      new Map([['r1', 7]])
    )
    expect(out.map(e => e.id)).toEqual(['lib:7', 'r2'])
  })

  it('区间内没有播出集或没建过对应：在线卡保留', () => {
    const entries = [lib(8), online('r1')]
    expect(dropLinkedOnline(entries, new Map([['r1', 7]]))).toHaveLength(2)
    expect(dropLinkedOnline(entries, new Map())).toHaveLength(2)
  })

  it('没有记录对应（重启后）时按剧名相同去重', () => {
    const same = { ...online('r1'), title: '小城 良方' }
    const other = { ...online('r2'), title: '别的剧' }
    const library = { ...lib(7), title: '小城良方' }
    const out = dropLinkedOnline([library, same, other], new Map())
    expect(out.map(e => e.id)).toEqual(['lib:7', 'r2'])
  })
})

describe('在线剧年份', () => {
  it('只认四位年份', () => {
    expect(onlineYear({ vod_year: '2024' })).toBe(2024)
    expect(onlineYear({ vod_year: 2023 })).toBe(2023)
    expect(onlineYear({ vod_year: '2024-05' })).toBeUndefined()
    expect(onlineYear({ vod_year: '' })).toBeUndefined()
    expect(onlineYear(null)).toBeUndefined()
  })
})

describe('剧名对应', () => {
  it('忽略空白与大小写，空名不对应', () => {
    expect(sameTitle('小城 良方', '小城良方')).toBe(true)
    expect(sameTitle('Severance', ' severance ')).toBe(true)
    expect(sameTitle('', '')).toBe(false)
    expect(sameTitle('甲', '乙')).toBe(false)
  })
})

describe('契约参数', () => {
  it('autograb.trackOnline：剧名必填，tmdbId 只能是数字', () => {
    const parse = autograb.calls.trackOnline.parse
    expect(
      parse([{ title: ' 小城良方 ', year: 2024, tmdbId: '1001' }])
    ).toEqual([{ title: '小城良方', year: 2024, tmdbId: '1001' }])
    expect(() => parse([{ title: ' ' }])).toThrow()
    expect(() => parse([{ title: 'a', tmdbId: 'x1' }])).toThrow()
  })

  it('calendar.ensureSeries：同样的规则', () => {
    expect(
      parseRpcParams('calendar.ensureSeries', { title: ' 甲 ', tmdbId: '5' })
    ).toEqual({ title: '甲', tmdbId: '5' })
    expect(() =>
      parseRpcParams('calendar.ensureSeries', { title: '' })
    ).toThrow()
    expect(() =>
      parseRpcParams('calendar.ensureSeries', { title: 'a', year: 12 })
    ).toThrow()
  })
})

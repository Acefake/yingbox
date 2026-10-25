import { describe, expect, it } from 'vitest'

import {
  CONTINUE_LIMIT,
  CONTINUE_ROW_LIMIT,
  type ContinueMeta,
  type ContinueRecord,
  applyProgress,
  lastWatchedLabel,
  metaOf,
  progressRatio,
  recordsFor,
  remainingLabel,
  replayOptions,
  sanitizeRecords,
  startRecord,
  subtitleOf,
} from '../src/renderer/src/features/player/continue/continue-rules'

const series: ContinueMeta = {
  section: 'tv',
  key: '42',
  title: '漫长的季节',
  cover: 'yingbox-media://image/a?w=780',
  detail: { itemId: 42 },
}
const episodes = [
  { filePath: '/tv/e1.mkv', name: 'S01E01' },
  { filePath: '/tv/e2.mkv', name: 'S01E02' },
]

function started(index = 0, startAt = 0): ContinueRecord[] {
  return startRecord(
    [],
    series,
    { filePath: episodes[index].filePath, playlist: episodes, index },
    startAt,
    1000
  )
}

describe('继续播放：开播登记', () => {
  it('新建记录，剧集记下当前集名', () => {
    const [record] = started(1)
    expect(record.id).toBe('tv:42')
    expect(record.episode).toBe('S01E02')
    expect(record.progress).toBe(0)
  })

  it('同一集再次开播沿用旧进度；换了集从头', () => {
    let list = applyProgress(
      started(),
      'tv:42',
      { index: 0, progress: 600, duration: 2400 },
      2000
    )
    list = startRecord(list, series, list[0].replay, 0, 3000)
    expect(list[0].progress).toBe(600)
    list = startRecord(list, series, { playlist: episodes, index: 1 }, 0, 4000)
    expect(list[0].progress).toBe(0)
  })

  it('最多保留 CONTINUE_LIMIT 条，最新的在前', () => {
    let list: ContinueRecord[] = []
    for (let i = 0; i < CONTINUE_LIMIT + 5; i++)
      list = startRecord(list, { ...series, key: String(i) }, {}, 0, i)
    expect(list).toHaveLength(CONTINUE_LIMIT)
    expect(list[0].key).toBe(String(CONTINUE_LIMIT + 4))
  })
})

describe('继续播放：进度', () => {
  it('播放不足 10 秒不记（误点）', () => {
    const list = started()
    expect(
      applyProgress(list, 'tv:42', { index: 0, progress: 4, duration: 100 }, 2)
    ).toBe(list)
  })

  it('看完一集指向下一集，从头开始', () => {
    const list = applyProgress(
      started(),
      'tv:42',
      { index: 0, progress: 2390, duration: 2400 },
      2000
    )
    expect(list[0]).toMatchObject({
      nextUp: true,
      progress: 0,
      episode: 'S01E02',
      replay: { index: 1 },
    })
  })

  it('最后一集看完（ended）移除记录', () => {
    const list = applyProgress(
      started(1),
      'tv:42',
      { index: 1, progress: 0, duration: 0, ended: true },
      2000
    )
    expect(list).toHaveLength(0)
  })

  it('换到别的集时丢掉预解析的起始地址（只对应原来那一集）', () => {
    const online = startRecord(
      [],
      { ...series, section: 'online' },
      {
        url: 'https://cdn/e1.m3u8',
        playlist: [{ url: 'p1' }, { url: 'p2' }],
        index: 0,
      },
      0,
      1
    )
    const next = applyProgress(
      online,
      'online:42',
      { index: 1, progress: 30, duration: 100 },
      2
    )
    expect(next[0].replay.url).toBeUndefined()
    expect(replayOptions(next[0])).toMatchObject({ index: 1, startAt: 30 })
  })
})

describe('继续播放：展示', () => {
  it('每个板块只列自己的记录，最多 CONTINUE_ROW_LIMIT 张', () => {
    let list: ContinueRecord[] = []
    for (let i = 0; i < CONTINUE_ROW_LIMIT + 3; i++)
      list = startRecord(list, { ...series, key: String(i) }, {}, 0, i)
    list = startRecord(list, { ...series, section: 'online' }, {}, 0, 99)
    expect(recordsFor(list, 'tv')).toHaveLength(CONTINUE_ROW_LIMIT)
    expect(recordsFor(list, 'online')).toHaveLength(1)
    expect(recordsFor(list, 'movie')).toHaveLength(0)
    // 首页合并几个板块：仍按更新时间倒序、总数封顶
    const merged = recordsFor(list, ['online', 'tv'])
    expect(merged).toHaveLength(CONTINUE_ROW_LIMIT)
    expect(merged[0].section).toBe('online')
  })

  it('剩余时间与进度比例', () => {
    const [record] = applyProgress(
      started(),
      'tv:42',
      { index: 0, progress: 1200, duration: 2400 },
      2
    )
    expect(progressRatio(record)).toBe(0.5)
    expect(remainingLabel(record)).toBe('剩余 20 分钟')
    expect(remainingLabel({ ...record, duration: 6000 })).toBe(
      '剩余 1 小时 20 分'
    )
    expect(remainingLabel({ ...record, duration: 0 })).toBe('')
  })

  it('上次观看的相对时间', () => {
    const now = new Date(2026, 9, 24, 12, 0).getTime()
    expect(lastWatchedLabel(now - 20_000, now)).toBe('刚刚')
    expect(lastWatchedLabel(now - 25 * 60_000, now)).toBe('25 分钟前')
    expect(lastWatchedLabel(now - 3 * 3600_000, now)).toBe('3 小时前')
    expect(lastWatchedLabel(new Date(2026, 9, 23, 22).getTime(), now)).toBe(
      '昨天'
    )
    expect(lastWatchedLabel(new Date(2026, 9, 20).getTime(), now)).toBe(
      '4 天前'
    )
    expect(lastWatchedLabel(new Date(2026, 9, 3).getTime(), now)).toBe(
      '10月3日'
    )
  })

  it('副标题：集名；电影写电影，其余写上次时间；下一集写上一集已看完', () => {
    const [record] = started()
    expect(subtitleOf(record, 1000)).toBe('S01E01')
    expect(subtitleOf({ ...record, episode: undefined }, 1000)).toBe(
      '上次 刚刚'
    )
    expect(
      subtitleOf({ ...record, episode: undefined, section: 'movie' }, 1000)
    ).toBe('电影')
    expect(subtitleOf({ ...record, nextUp: true }, 1000)).toBe(
      '上一集已看完 · 上次 刚刚'
    )
  })

  it('重新开播只交回 meta，不带进度等字段', () => {
    const [record] = started()
    expect(metaOf(record)).toEqual(series)
  })

  it('读回存储时丢掉形状不对的记录', () => {
    const [record] = started()
    expect(sanitizeRecords([record, { id: 1 }, null, 'x'])).toEqual([record])
    expect(sanitizeRecords('nope')).toEqual([])
  })
})

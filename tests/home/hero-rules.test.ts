import { describe, expect, it } from 'vitest'

import type { ContinueRecord } from '../../src/renderer/src/features/player'
import {
  composeSlides,
  libraryItemIdOf,
  pickResumeRecord,
  resumeKicker,
  resumePlayLabel,
} from '../../src/renderer/src/features/online/utils/hero-rules'

/** 首页 Hero 选片：没看完的片子放第一张，标签行写来源与进度，主按钮写剩余时间，后面接精选并去重 */

const record = (patch: Partial<ContinueRecord> = {}): ContinueRecord => ({
  section: 'movie',
  key: '7',
  id: 'movie:7',
  title: '沙丘2',
  cover: 'https://img/cover.jpg',
  detail: { itemId: 7 },
  replay: { filePath: '/m/dune2.mkv' },
  progress: 6200,
  duration: 9960,
  updatedAt: 1,
  ...patch,
})

describe('pickResumeRecord', () => {
  it('取首页板块里最近的一条（列表已按时间倒序），AV / 番号板块不上首页', () => {
    const av = record({ section: 'av', id: 'av:1', key: '1' })
    const tv = record({ section: 'tv', id: 'tv:9', key: '9' })
    expect(pickResumeRecord([av, tv, record()])?.id).toBe('tv:9')
  })

  it('没有封面、也不是片库条目（取不到背景图）的跳过', () => {
    const bare = record({
      section: 'online',
      id: 'online:x',
      cover: undefined,
      detail: { vod_name: 'x' },
    })
    expect(pickResumeRecord([bare, record()])?.id).toBe('movie:7')
    // 片库条目没有封面也能放：Hero 另取背景图
    const library = record({ cover: undefined })
    expect(pickResumeRecord([library])?.id).toBe('movie:7')
  })

  it('没有记录时为 null', () => {
    expect(pickResumeRecord([])).toBeNull()
  })
})

describe('libraryItemIdOf', () => {
  it('片库电影 / 剧集记录读 detail.itemId，在线记录为 null', () => {
    expect(libraryItemIdOf(record())).toBe(7)
    expect(libraryItemIdOf(record({ section: 'online' }))).toBeNull()
    expect(libraryItemIdOf(record({ detail: { itemId: 'x' } }))).toBeNull()
  })
})

describe('resumeKicker', () => {
  it('来源 · 看到 N%（取整，夹在 1–99）', () => {
    expect(resumeKicker(record())).toBe('本地片库 · 看到 62%')
    expect(resumeKicker(record({ progress: 9950 }))).toBe('本地片库 · 看到 99%')
  })

  it('剧集带集名；在线记录写「在线」；时长未知写「继续观看」', () => {
    expect(
      resumeKicker(
        record({
          section: 'online',
          episode: '第 14 集',
          progress: 600,
          duration: 1500,
        })
      )
    ).toBe('在线 · 第 14 集 · 看到 40%')
    expect(resumeKicker(record({ duration: 0 }))).toBe('本地片库 · 继续观看')
  })

  it('上一集已看完：写下一集', () => {
    expect(
      resumeKicker(record({ section: 'tv', nextUp: true, episode: '第 15 集' }))
    ).toBe('本地片库 · 下一集 第 15 集')
  })
})

describe('resumePlayLabel', () => {
  it('剩余分钟（四舍五入，至少 1），一小时以上写小时和分', () => {
    expect(resumePlayLabel(record({ progress: 7080, duration: 9960 }))).toBe(
      '继续播放 · 剩 48 分钟'
    )
    expect(resumePlayLabel(record({ progress: 0, duration: 4320 }))).toBe(
      '继续播放 · 剩 1 小时 12 分'
    )
    expect(resumePlayLabel(record({ progress: 0, duration: 7200 }))).toBe(
      '继续播放 · 剩 2 小时'
    )
    expect(resumePlayLabel(record({ progress: 9959, duration: 9960 }))).toBe(
      '继续播放 · 剩 1 分钟'
    )
  })

  it('下一集写「播放下一集」，时长未知写「继续播放」', () => {
    expect(resumePlayLabel(record({ nextUp: true }))).toBe('播放下一集')
    expect(resumePlayLabel(record({ duration: 0 }))).toBe('继续播放')
  })
})

describe('composeSlides', () => {
  const s = (key: string): { key: string } => ({ key })

  it('继续观看那一张在最前，同一部不重复，最多 5 张', () => {
    const rest = [
      'library:7',
      'library:1',
      'library:2',
      'library:3',
      'library:4',
    ]
    expect(composeSlides(s('library:7'), rest.map(s)).map(x => x.key)).toEqual([
      'library:7',
      'library:1',
      'library:2',
      'library:3',
      'library:4',
    ])
  })

  it('没有继续观看时就是精选', () => {
    expect(composeSlides(null, [s('a'), s('b')]).map(x => x.key)).toEqual([
      'a',
      'b',
    ])
  })
})

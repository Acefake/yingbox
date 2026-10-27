import { describe, expect, it } from 'vitest'

import {
  liveNowCards,
  remainingText,
} from '../../src/renderer/src/features/live/utils/live-now'
import type { LiveChannel } from '../../src/renderer/src/features/live/utils/playlist-parse'

/** 首页「正在直播」：收藏频道按收藏顺序，带当前节目、时段、剩余时间与进度；没有收藏或不在源里时为空 */

const channel = (name: string): LiveChannel =>
  ({
    id: name.toLowerCase(),
    name,
    group: '央视',
    urls: [`https://demo/${name}.m3u8`],
  }) as LiveChannel

const at = (h: number, m = 0): number => new Date(2026, 9, 27, h, m).getTime()

describe('liveNowCards', () => {
  const channels = [channel('CCTV-1'), channel('CCTV-9'), channel('湖南卫视')]
  const programmes = {
    'cctv-9': [
      { start: at(19), stop: at(20), title: '动物世界' },
      { start: at(20), stop: at(21), title: '自然的力量' },
    ],
  }

  it('按收藏顺序，有节目单的写「频道 · 节目」、时段与剩余时间、进度', () => {
    const cards = liveNowCards(
      channels,
      ['cctv-9', '湖南卫视'],
      programmes,
      at(20, 29)
    )
    expect(cards.map(c => c.channel.id)).toEqual(['cctv-9', '湖南卫视'])
    expect(cards[0].title).toBe('CCTV-9 · 自然的力量')
    expect(cards[0].subtitle).toBe('20:00–21:00 · 还剩 31 分钟')
    expect(cards[0].progress).toBeCloseTo(29 / 60)
  })

  it('没有节目单的收藏频道只写频道名与「正在直播」，不画进度', () => {
    const [card] = liveNowCards(channels, ['湖南卫视'], programmes, at(20))
    expect(card).toMatchObject({
      title: '湖南卫视',
      subtitle: '正在直播',
      progress: null,
    })
  })

  it('收藏了但不在当前直播源里的频道跳过；没有收藏为空；最多 limit 张', () => {
    expect(liveNowCards(channels, ['cctv-5'], programmes, at(20))).toEqual([])
    expect(liveNowCards(channels, [], programmes, at(20))).toEqual([])
    expect(
      liveNowCards(channels, ['cctv-1', 'cctv-9', '湖南卫视'], {}, at(20), 2)
    ).toHaveLength(2)
  })

  it('收藏集合（Set）也按加入顺序', () => {
    const favorites = new Set(['湖南卫视', 'cctv-1'])
    expect(
      liveNowCards(channels, favorites, {}, at(20)).map(c => c.channel.id)
    ).toEqual(['湖南卫视', 'cctv-1'])
  })
})

describe('remainingText', () => {
  it('一小时内写分钟，以上写小时和分', () => {
    expect(remainingText(31)).toBe('还剩 31 分钟')
    expect(remainingText(100)).toBe('还剩 1 小时 40 分')
    expect(remainingText(120)).toBe('还剩 2 小时')
  })
})

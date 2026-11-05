import { describe, expect, it } from 'vitest'

import {
  HOME_SECTIONS,
  composeSlides,
} from '../../src/shared/playback/hero-rules'

/** 首页 Hero 选片：只放精选，同一部不重复，最多 5 张；继续观看不进轮播 */

describe('HOME_SECTIONS', () => {
  it('首页继续观看只合并在线与片库电影、剧集，番号和 AV 不上首页', () => {
    expect(HOME_SECTIONS).toEqual(['online', 'movie', 'tv'])
  })
})

describe('composeSlides', () => {
  const s = (key: string): { key: string } => ({ key })

  it('同一部不重复，最多 5 张', () => {
    const keys = [
      'library:7',
      'library:7',
      'library:1',
      'library:2',
      'library:3',
      'library:4',
      'library:5',
    ]
    expect(composeSlides(keys.map(s)).map(x => x.key)).toEqual([
      'library:7',
      'library:1',
      'library:2',
      'library:3',
      'library:4',
    ])
  })

  it('不足 5 张时原样返回', () => {
    expect(composeSlides([s('a'), s('b')]).map(x => x.key)).toEqual(['a', 'b'])
  })
})

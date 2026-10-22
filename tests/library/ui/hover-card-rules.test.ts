/** 海报悬停详情卡的位置与信息规则（wall/hover-card-rules.ts）。 */
import { describe, expect, it } from 'vitest'
import type { LibraryItemNode } from '../../../src/shared/library/ipc'
import {
  HOVER_CARD,
  clipList,
  hoverCardPosition,
  hoverFactsOf,
} from '../../../src/renderer/src/features/library/wall/hover-card-rules'

const viewport = { width: 1400, height: 900 }
const cell = (
  left: number,
  top = 100
): {
  left: number
  top: number
  right: number
  bottom: number
  width: number
} => ({
  left,
  top,
  right: left + 200,
  bottom: top + 352,
  width: 200,
})

describe('悬停卡位置', () => {
  it('右侧放得下放右侧，放不下放左侧', () => {
    expect(hoverCardPosition(cell(100), viewport)).toEqual({
      left: 100 + 200 + HOVER_CARD.gap,
      top: 100,
    })
    expect(hoverCardPosition(cell(1100), viewport).left).toBe(
      1100 - HOVER_CARD.gap - HOVER_CARD.width
    )
  })

  it('两边都放不下：压在格子上并收进视口；底部超出时上移', () => {
    const narrow = { width: 500, height: 600 }
    const pos = hoverCardPosition(cell(150, 400), narrow)
    expect(pos.left).toBeGreaterThanOrEqual(HOVER_CARD.margin)
    expect(pos.left + HOVER_CARD.width).toBeLessThanOrEqual(
      narrow.width - HOVER_CARD.margin
    )
    expect(pos.top).toBe(600 - HOVER_CARD.maxHeight - HOVER_CARD.margin)
  })
})

describe('悬停卡信息', () => {
  it('名单超长截短', () => {
    expect(clipList(['a', 'b'], 3, ' / ')).toBe('a / b')
    expect(clipList(['a', 'b', 'c', 'd'], 2, ' / ')).toBe('a / b / 等 4 个')
  })

  it('番号：日期、时长、评分、制作商 / 发行商 / 系列 / 导演 / 演员 / 标签', () => {
    const node = {
      year: 2024,
      airDate: '2024-05-10',
      runtime: 120,
      rating: 7.8,
      genres: ['巨乳', '单体作品'],
      overview: null,
      files: [{ kind: 'video' }, { kind: 'video' }, { kind: 'image' }],
      metadata: {
        level: 'title',
        ref: { provider: 'jav', kind: 'movie', id: 'IPZZ-370' },
        companies: ['IDEA POCKET', 'ティッシュ'],
        collection: { id: 's', name: '系列名' },
        crew: [{ id: 'd', name: '导演甲', job: 'Director' }],
        cast: [{ id: 'a', name: '長浜みつり' }],
      },
    } as unknown as LibraryItemNode
    const facts = hoverFactsOf(node)
    expect(facts.meta).toEqual(['2024-05-10', '120 分钟', '★ 7.8', '2 个文件'])
    expect(facts.rows.map(r => `${r.label}:${r.value}`)).toEqual([
      '制作商:IDEA POCKET',
      '发行商:ティッシュ',
      '系列:系列名',
      '导演:导演甲',
      '演员:長浜みつり',
      '标签:巨乳 · 单体作品',
    ])
  })

  it('电影：出品合并成一行', () => {
    const node = {
      year: 2010,
      airDate: null,
      runtime: null,
      rating: null,
      genres: [],
      overview: '简介',
      files: [],
      metadata: {
        level: 'title',
        ref: { provider: 'tmdb', kind: 'movie', id: '1' },
        companies: ['A', 'B', 'C'],
        crew: [],
        cast: [],
      },
    } as unknown as LibraryItemNode
    const facts = hoverFactsOf(node)
    expect(facts.meta).toEqual(['2010'])
    expect(facts.rows).toEqual([{ label: '出品', value: 'A、B', wrap: false }])
  })
})

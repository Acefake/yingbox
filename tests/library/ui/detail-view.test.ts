/**
 * 详情页（Apple TV 式）视图层的纯规则：规格行去分级、规格标签、主创行、底部胶囊分区、滚动时的当前分区。
 */
import { describe, expect, it } from 'vitest'

import type { TitleMeta } from '../../../src/renderer/src/features/library/detail/detail-rules'
import {
  activeTabAt,
  creditLinesOf,
  detailTabsOf,
  heroMetaParts,
  heroSpecsOf,
  keepTab,
} from '../../../src/renderer/src/features/library/detail/detail-view'

const meta = (patch: Partial<TitleMeta> = {}): TitleMeta =>
  ({
    level: 'title',
    certification: '16+',
    cast: [
      { id: 1, name: '张鲁一', character: '汪淼' },
      { id: 2, name: '于和伟', character: '史强' },
      { id: 3, name: '陈瑾', character: '叶文洁' },
      { id: 4, name: '王子文', character: '叶文洁（青年）' },
    ],
    crew: [
      { id: 9, name: '杨磊', job: 'Director' },
      { id: 9, name: '杨磊', job: 'Director' },
      { id: 8, name: '田良良', job: 'Writer' },
    ],
    ...patch,
  }) as unknown as TitleMeta

describe('详情头图规格', () => {
  it('分级从文字行里拿掉，改成圆标；更长的分级用描边方块', () => {
    expect(heroMetaParts(['2023', '16+', '★ 8.7'], meta())).toEqual([
      '2023',
      '★ 8.7',
    ])
    expect(heroMetaParts(['2023'], null)).toEqual(['2023'])
    // 分级带空白时也要去掉，不与圆标重复
    expect(
      heroMetaParts(['2023', ' 16+ '], meta({ certification: '16+ ' }))
    ).toEqual(['2023'])
    expect(heroSpecsOf({ videoRange: 'dv' }, meta())).toEqual([
      { variant: 'rating', text: '16+' },
      { variant: 'dolby', text: 'VISION' },
    ])
    expect(
      heroSpecsOf({ videoRange: 'sdr' }, meta({ certification: 'PG-13' }))
    ).toEqual([{ variant: 'outline', text: 'PG-13' }])
    expect(heroSpecsOf({ videoRange: null }, null)).toEqual([])
  })

  it('主创行：主演取前 3 位，导演去重；没有导演时用主创', () => {
    expect(creditLinesOf(meta())).toEqual([
      { label: '主演', names: '张鲁一、于和伟、陈瑾' },
      { label: '导演', names: '杨磊' },
    ])
    expect(
      creditLinesOf(
        meta({ cast: [], crew: [{ id: 1, name: '刘慈欣', job: 'Creator' }] })
      )
    ).toEqual([{ label: '主创', names: '刘慈欣' }])
    expect(creditLinesOf(null)).toEqual([])
  })
})

describe('详情底部分区胶囊', () => {
  it('概览与关于总在，其余按区块出现，顺序与页面一致', () => {
    expect(detailTabsOf({}).map(t => t.label)).toEqual(['概览', '关于'])
    expect(
      detailTabsOf({ cast: true, episodes: true, versions: false }).map(
        t => t.key
      )
    ).toEqual(['overview', 'episodes', 'cast', 'about'])
  })

  it('当前分区：判定线以上最后一个区块；滚到底取最后一个', () => {
    const sections = [
      { key: 'overview' as const, top: 0 },
      { key: 'episodes' as const, top: 800 },
      { key: 'cast' as const, top: 1300 },
      { key: 'about' as const, top: 1700 },
    ]
    expect(activeTabAt(sections, 0, 900, 2400)).toBe('overview')
    expect(activeTabAt(sections, 500, 900, 2400)).toBe('episodes')
    expect(activeTabAt(sections, 1000, 900, 2400)).toBe('cast')
    expect(activeTabAt(sections, 1500, 900, 2400)).toBe('about')
    expect(activeTabAt([], 0, 900, 900)).toBeNull()
    // 内容不足一屏：不算滚到底，仍是概览
    expect(activeTabAt(sections, 0, 900, 900)).toBe('overview')
    expect(activeTabAt(sections, 0, 900, 600)).toBe('overview')
  })
})

describe('分区列表变化后校正当前分区', () => {
  const tabs = detailTabsOf({ episodes: true, cast: true })
  it('还在就不动，消失了取它前面最近的一个', () => {
    expect(keepTab(tabs, 'cast')).toBe('cast')
    expect(keepTab(tabs, 'stills')).toBe('episodes')
    expect(keepTab(tabs, 'versions')).toBe('cast')
    expect(keepTab(detailTabsOf({}), 'episodes')).toBe('overview')
    expect(keepTab([], 'cast')).toBe('cast')
  })
})

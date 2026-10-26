// @vitest-environment jsdom
/**
 * 结果卡与搜索结果行的数据映射：片库条目 → 卡片信息（说明行、规格标签、评分、详情路由），
 * 继续播放记录 / 库内发现补片库信息（等不到就原样出），片库搜索结果行（卡片信息到前后），
 * 在线结果行（分类、更新进度、备注里的清晰度、来源）。片库与播放器换成替身。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const fakes = vi.hoisted(() => ({
  info: vi.fn(async (_id: number): Promise<unknown> => null),
}))

vi.mock('@/features/library', () => ({
  libraryCardInfo: (id: number) => fakes.info(id),
}))

vi.mock('@/features/player', async () => {
  const { shallowRef } = await import('vue')
  return {
    continueRecords: () => shallowRef([]),
    metaOf: vi.fn(),
    openMediaPlayer: vi.fn(),
    progressRatio: (r: { progress: number; duration: number }) =>
      r.progress / r.duration,
    replayOptions: vi.fn(),
  }
})

import type { ContinueRecord } from '../src/renderer/src/features/player/continue/continue-rules'
import {
  CARD_INFO_WAIT_MS,
  cardInfos,
  withLibraryInfo,
} from '../src/renderer/src/features/assistant/skills/card-info'
import {
  continueCard,
  continueItemId,
} from '../src/renderer/src/features/assistant/skills/continue-cards'
import type { AssistantMediaCard } from '../src/renderer/src/features/assistant/skills/skill-types'
import {
  cardNote,
  cardPlayLabel,
  onlineRowView,
  onlineSource,
} from '../src/renderer/src/features/assistant/result-rows'
import { groupOnline } from '../src/renderer/src/features/assistant/use-entry-online'
import {
  type LibraryCardInfo,
  cardInfoOf,
} from '../src/renderer/src/features/library/detail/card-info'
import type { LibraryItemNode } from '../src/shared/library/ipc'
import { hitRow } from '../src/renderer/src/features/library/search/hit-row'
import type { SearchHit } from '../src/renderer/src/features/library/search/types'

afterEach(() => {
  vi.useRealTimers()
  fakes.info.mockReset()
  fakes.info.mockImplementation(async () => null)
})

const info: LibraryCardInfo = {
  id: 1000,
  meta: ['2023 年', '剧情、悬疑', '1 季'],
  specs: [
    { variant: 'rating', text: '16+' },
    { variant: 'solid', text: '4K' },
    { variant: 'dolby', text: 'VISION' },
  ],
  rating: '8.7',
  watchlist: { section: 'tv', key: '1000', title: '三体', poster: 'p.jpg' },
  location: { path: '/tv', query: { item: '1000' } },
}

const record = (over: Partial<ContinueRecord>): ContinueRecord => ({
  id: 'tv:1000',
  section: 'tv',
  key: '1000',
  title: '三体',
  cover: 'backdrop.jpg',
  detail: { itemId: 1000 },
  replay: {},
  episode: '第 1 季 · 第 12 集',
  progress: 1800,
  duration: 2880,
  updatedAt: 0,
  ...over,
})

describe('继续观看卡片', () => {
  it('片库记录补片库信息：竖版海报、年份 · 类型 · 季数、规格标签、评分、详情；看到哪儿进备注', () => {
    const card = continueCard(record({}), info)
    expect(card.image).toBe('p.jpg')
    expect(card.meta).toBe('2023 年 · 剧情、悬疑 · 1 季')
    expect(card.specs).toEqual(info.specs)
    expect(card.rating).toBe('8.7')
    expect(card.library).toBe(info)
    expect(card.progress).toBeCloseTo(0.625)
    expect(card.progressNote).toBe('第 1 季 · 第 12 集 · 剩 18 分钟')
    expect(cardNote(card)).toEqual(['第 1 季 · 第 12 集 · 剩 18 分钟'])
    expect(cardPlayLabel(card)).toBe('继续')
  })

  it('没有片库信息（在线记录）：用记录的封面，没有详情；下一集不写剩余时间', () => {
    const card = continueCard(
      record({
        section: 'online',
        detail: {},
        episode: '第 3 集',
        nextUp: true,
      })
    )
    expect(card.image).toBe('backdrop.jpg')
    expect(card.meta).toBe('')
    expect(card.library).toBeUndefined()
    expect(card.progressNote).toBe('第 3 集 · 下一集')
  })

  it('只有片库板块的记录对得上条目 id', () => {
    expect(continueItemId(record({}))).toBe(1000)
    expect(continueItemId(record({ section: 'online' }))).toBeNull()
    expect(
      continueItemId(record({ section: 'av', detail: { url: 'x' } }))
    ).toBeNull()
    expect(continueItemId(record({ detail: undefined }))).toBeNull()
  })
})

describe('补片库信息', () => {
  const base: AssistantMediaCard = {
    id: 'lib-1',
    title: '沙丘：第二部',
    image: null,
    meta: '2024',
    rating: '豆瓣 8.2',
    source: '本地片库',
    reason: 'AI 理解 · 科幻',
    playLabel: '播放',
    play: async () => true,
  }

  it('卡片自己给的评分（豆瓣）优先，说明行与规格标签换成片库的；没有信息原样返回', () => {
    const card = withLibraryInfo(base, info)
    expect(card.rating).toBe('豆瓣 8.2')
    expect(card.meta).toBe('2023 年 · 剧情、悬疑 · 1 季')
    expect(withLibraryInfo({ ...base, rating: '' }, info).rating).toBe('8.7')
    expect(withLibraryInfo(base, null)).toBe(base)
    expect(cardNote(card)).toEqual(['AI 理解 · 科幻', '本地片库'])
    expect(cardPlayLabel(card)).toBe('播放')
  })

  it('cardInfos：与 id 一一对应；null id 不取；取失败为 null', async () => {
    fakes.info.mockImplementation(async id => {
      if (id === 2) throw new Error('boom')
      return { ...info, id }
    })
    const got = await cardInfos([1, null, 2])
    expect(got.map(x => (x as LibraryCardInfo | null)?.id ?? null)).toEqual([
      1,
      null,
      null,
    ])
    expect(fakes.info).toHaveBeenCalledTimes(2)
  })

  it(`cardInfos：最多等 ${CARD_INFO_WAIT_MS} 毫秒，等不到就不补`, async () => {
    vi.useFakeTimers()
    fakes.info.mockImplementation(() => new Promise(() => {}))
    const pending = cardInfos([1])
    await vi.advanceTimersByTimeAsync(CARD_INFO_WAIT_MS)
    expect(await pending).toEqual([null])
  })
})

describe('片库搜索结果行', () => {
  const hit = {
    key: '1',
    item: {
      id: 1,
      title: '沙丘：第二部',
      year: 2024,
      poster: null,
      rating: 8.06,
      videoRange: 'dv',
    },
    versions: [{}, {}],
    score: 1,
    exact: true,
    reasons: ['片名匹配'],
  } as unknown as SearchHit

  it('卡片信息没到：先用结果自带的评分与动态范围', () => {
    expect(hitRow(hit)).toEqual({
      image: null,
      year: 2024,
      meta: [],
      specs: [{ variant: 'dolby', text: 'VISION' }],
      rating: '8.1',
      note: ['片名匹配', '2 个版本'],
    })
  })

  it('卡片信息到了：完整规格标签与类型时长，年份不重复', () => {
    const row = hitRow(hit, {
      ...info,
      meta: ['2024 年', '科幻、冒险', '2 小时 46 分'],
    })
    expect(row.meta).toEqual(['科幻、冒险', '2 小时 46 分'])
    expect(row.specs).toEqual(info.specs)
    expect(row.rating).toBe('8.7')
  })
})

describe('在线结果行', () => {
  const item = (
    name: string,
    source: string,
    remarks: string,
    type = '电影'
  ): Parameters<typeof groupOnline>[0][number] => ({
    vod_id: 1,
    vod_name: name,
    vod_year: '2023',
    type_name: type,
    vod_remarks: remarks,
    vod_pic: '',
    source_name: source,
  })

  it('合并时收集各源备注（去重）与第一个分类', () => {
    const [row] = groupOnline([
      item('三体', '甲', '更新至 12 集', '国产剧'),
      item('三体', '乙', '4K'),
      item('三体', '丙', '4K'),
    ])
    expect(row.type).toBe('国产剧')
    expect(row.remarks).toEqual(['更新至 12 集', '4K'])
    expect(onlineRowView(row)).toEqual({
      meta: ['国产剧', '更新至 12 集'],
      specs: [{ variant: 'solid', text: '4K' }],
      note: ['在线 · 甲 等 3 个源'],
    })
  })

  it('没有清晰度信息不出规格标签；来源只有一个 / 没有来源', () => {
    const [row] = groupOnline([item('星际穿越', '墨斗', 'HD')])
    expect(onlineRowView(row)).toEqual({
      meta: ['电影'],
      specs: [],
      note: ['在线 · 墨斗'],
    })
    expect(onlineSource({ sources: [] })).toBe('在线')
  })
})

describe('片库条目 → 卡片信息', () => {
  it('说明行、规格标签（分级 + 探测动态范围 + 文件名）、评分、想看与详情路由', () => {
    const node = {
      id: 7,
      libraryId: 99,
      type: 'movie',
      title: '沙丘：第二部',
      originalTitle: null,
      year: 2024,
      matchState: 'auto',
      providerIds: {},
      poster: null,
      backdrop: null,
      logo: null,
      rating: 8.24,
      addedAt: 0,
      updatedAt: 0,
      videoRange: 'dv',
      seasonNumber: null,
      episodeNumber: null,
      overview: null,
      runtime: 166,
      genres: ['科幻', '冒险', '剧情'],
      airDate: null,
      metadata: null,
      files: [
        {
          id: 1,
          path: 'D:\\M\\Dune.Part.Two.2160p.DV.Atmos.mkv',
          kind: 'video',
          size: 1,
          mtime: 1,
        },
      ],
      children: [],
    } as unknown as LibraryItemNode
    const got = cardInfoOf(node)
    expect(got.meta).toEqual(['2024 年', '科幻、冒险', '2 小时 46 分'])
    expect(got.specs.map(s => s.text)).toEqual(['4K', 'VISION', 'ATMOS'])
    expect(got.rating).toBe('8.2')
    expect(got.watchlist).toMatchObject({ section: 'movie', key: '7' })
    expect(got.location).toEqual({ path: '/movie', query: { item: '7' } })
  })
})

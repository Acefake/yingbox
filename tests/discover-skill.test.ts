/**
 * 库外发现技能包：参数槽解析、桌面端门槛、库外卡片按钮随入库状态变化、回复文案。媒体库换成替身。
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/library', () => ({
  findLibraryItems: vi.fn(async () => ({
    items: [
      {
        id: 77,
        title: '星际穿越',
        originalTitle: 'Interstellar',
        year: 2014,
        providerIds: { tmdb: '157336' },
      },
    ],
    total: 1,
  })),
  libraryPoster: (url: string | null) => url,
  libraryCardInfo: async () => null,
  playLibraryItem: vi.fn(async () => true),
}))

import { checkLibrary } from '../src/renderer/src/features/discover/discover-state'
import type { DiscoverTitle } from '../src/renderer/src/features/discover/discover-rules'
import {
  createDiscoverSkill,
  discoverMessage,
  inYears,
  missingActions,
  missingCard,
} from '../src/renderer/src/features/assistant/skills/discover-skill'
import { SENSITIVE } from './assistant-fixtures'

const router = { push: vi.fn(async () => undefined) } as never
const movie: DiscoverTitle = {
  doubanId: '1889243',
  kind: 'movie',
  title: '星际穿越',
  originalTitle: '',
  year: 2014,
  rate: '9.4',
  cover: '',
  tmdbId: null,
}

describe('库外发现技能包', () => {
  const action = createDiscoverSkill().actions[0]

  it('参数槽：target + command + value → 豆瓣条件；不合格返回 null', () => {
    const raw = { text: '', target: 'movie', on: null }
    expect(
      action.parse({ ...raw, command: '类型=科幻;年代=90年代', value: null })
    ).toMatchObject({
      query: { kind: 'movie', genre: '科幻', era: '90年代' },
      years: null,
    })
    // 70 年代：豆瓣取「更早」，再按 1970–1979 筛
    expect(
      action.parse({ ...raw, command: '类型=科幻;年代=70年代', value: null })
    ).toMatchObject({ query: { era: '更早' }, years: [1970, 1979] })
    expect(action.parse({ ...raw, command: '', value: null })).toBeNull()
  })

  it('没有主进程（网页端）时只给一句说明', () => {
    expect(action.gate?.({}, {} as never)).toEqual({
      kind: 'explain',
      text: '库外找片只在桌面端可用。',
    })
  })

  it('电影：「找 115 资源」展开候选面板 +「在线看」跳在线搜索；剧集只有「在线看」', async () => {
    const actions = missingActions(movie, router)
    expect(actions.map(a => a.label)).toEqual(['找 115 资源', '在线看'])
    expect(actions[0].panel?.props).toEqual({ target: movie })
    expect(await actions[1].run?.()).toBe(true)
    expect(
      (router as { push: ReturnType<typeof vi.fn> }).push
    ).toHaveBeenCalledWith({
      path: '/',
      query: { tab: 'search', q: '星际穿越' },
    })
    expect(
      missingActions({ ...movie, kind: 'tv' }, router).map(a => a.label)
    ).toEqual(['在线看'])
  })

  it('入库后：角标变「已入库」，按钮变「播放」', async () => {
    const card = missingCard(movie, router)
    expect(card.tag?.()).toBe('未入库')
    expect(await checkLibrary(movie)).toBe(true)
    expect(card.tag?.()).toBe('已入库')
    expect(card.actions?.().map(a => a.label)).toEqual(['播放'])
  })

  it('回复文案不含敏感词', () => {
    for (const text of [
      discoverMessage(0, 0, 'movie'),
      discoverMessage(2, 0, 'movie'),
      discoverMessage(0, 3, 'tv'),
      discoverMessage(1, 3, 'movie'),
    ])
      expect(SENSITIVE.test(text)).toBe(false)
  })

  it('库内数量照实说：卡片只列前 3 部时说明', () => {
    expect(discoverMessage(5, 2, 'movie')).toContain(
      '本地库里有 5 部（先列 3 部）'
    )
    expect(discoverMessage(5, 0, 'movie')).toContain('先列 3 部')
    expect(discoverMessage(2, 2, 'movie')).not.toContain('先列')
  })

  it('年份范围：没有范围都算在，有范围时年份未知的不算', () => {
    expect(inYears(1999, null)).toBe(true)
    expect(inYears(null, null)).toBe(true)
    expect(inYears(1975, [1970, 1979])).toBe(true)
    expect(inYears(1965, [1970, 1979])).toBe(false)
    expect(inYears(null, [1970, 1979])).toBe(false)
  })
})

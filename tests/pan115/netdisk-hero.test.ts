/**
 * 网盘页 Hero：TMDB 匹配规则（挑片、整理剧照 / 标志 / 元信息）、防抖可取消的匹配组合函数、状态行。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import { useHeroMatch } from '../../src/renderer/src/features/netdisk/composables/use-hero-match'
import { useNetdiskStatus } from '../../src/renderer/src/features/netdisk/composables/use-netdisk-status'
import {
  heroFromTmdb,
  matchQuery,
  pickTmdbHit,
  titleMatches,
} from '../../src/renderer/src/features/netdisk/utils/hero-match'
import { heroStatusItems } from '../../src/renderer/src/features/netdisk/utils/hero-status'
import type { OfflineList } from '../../src/shared/contract/offline'

const HIT = {
  id: 842675,
  media_type: 'movie',
  title: '流浪地球2',
  original_title: '流浪地球2',
  backdrop_path: '/bd.jpg',
}
const DETAIL = {
  title: '流浪地球2',
  release_date: '2023-01-22',
  genres: [{ name: '科幻' }, { name: '动作' }],
  runtime: 173,
  vote_average: 7.26,
  images: {
    logos: [
      { file_path: '/en.png', iso_639_1: 'en' },
      { file_path: '/zh.png', iso_639_1: 'zh' },
    ],
  },
}

afterEach(() => {
  vi.useRealTimers()
})

describe('hero-match 规则', () => {
  it('磁力 / 电驴 / 网址不匹配', () => {
    expect(matchQuery('  流浪地球 ')).toBe('流浪地球')
    expect(matchQuery('magnet:?xt=urn:btih:abc')).toBe('')
    expect(matchQuery('ed2k://|file|x|')).toBe('')
    expect(matchQuery('https://115.com/s/xx')).toBe('')
  })

  it('片名互相包含才算对上（忽略空格标点、大小写）', () => {
    expect(titleMatches('流浪地球', ['流浪地球2'])).toBe(true)
    expect(
      titleMatches('the wandering earth', ['The Wandering Earth II'])
    ).toBe(true)
    expect(titleMatches('流浪地球', ['满江红'])).toBe(false)
    expect(titleMatches('a', ['a'])).toBe(false)
  })

  it('挑第一条有剧照、片名对得上的电影或剧集', () => {
    const hits = [
      { id: 1, media_type: 'person', name: '流浪地球' },
      { id: 2, media_type: 'movie', title: '流浪地球', backdrop_path: null },
      { id: 3, media_type: 'movie', title: '别的片', backdrop_path: '/x.jpg' },
      HIT,
    ]
    expect(pickTmdbHit(hits, '流浪地球')?.id).toBe(842675)
    expect(pickTmdbHit(hits.slice(0, 3), '流浪地球')).toBeNull()
  })

  it('详情整理：中文标志优先、年份 · 类型 · 时长、TMDB 评分', () => {
    const hit = pickTmdbHit([HIT], '流浪地球')!
    expect(heroFromTmdb(hit, DETAIL)).toEqual({
      kind: 'movie',
      tmdbId: 842675,
      title: '流浪地球2',
      backdrop: 'https://image.tmdb.org/t/p/w1280/bd.jpg',
      logo: 'https://image.tmdb.org/t/p/w500/zh.png',
      meta: ['2023', '科幻', '173 分钟'],
      rating: 'TMDB 7.3',
    })
  })

  it('剧集用首播年份与单集时长；没有标志 / 评分时留空', () => {
    const hit = { ...HIT, media_type: 'tv' as const }
    const tv = heroFromTmdb(hit, {
      name: '繁花',
      first_air_date: '2023-12-27',
      episode_run_time: [45],
    })
    expect(tv).toMatchObject({
      title: '繁花',
      logo: null,
      meta: ['2023', '每集 45 分钟'],
      rating: '',
    })
  })
})

describe('useHeroMatch', () => {
  it('防抖：连着换词只查最后一个；新词先清掉旧片', async () => {
    vi.useFakeTimers()
    const tmdb = vi.fn(async (path: string, _query?: object) =>
      path === '/search/multi' ? { results: [HIT] } : DETAIL
    )
    const keyword = ref('')
    const { match } = useHeroMatch(keyword, {
      tmdb: async () => tmdb,
      delayMs: 300,
    })
    keyword.value = '流浪'
    await nextTick()
    keyword.value = '流浪地球'
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)
    expect(tmdb).toHaveBeenCalledTimes(2)
    expect(tmdb.mock.calls[0][1]).toMatchObject({ query: '流浪地球' })
    expect(match.value?.title).toBe('流浪地球2')

    keyword.value = 'magnet:?xt=urn:btih:abc'
    await nextTick()
    expect(match.value).toBeNull()
    await vi.advanceTimersByTimeAsync(300)
    expect(tmdb).toHaveBeenCalledTimes(2)
  })

  it('晚到的旧响应作废；请求失败静默保持默认', async () => {
    vi.useFakeTimers()
    let release: () => void = () => {}
    const slow = new Promise<void>(resolve => (release = resolve))
    const tmdb = vi.fn(
      async (path: string, query?: Record<string, unknown>) => {
        if (query?.query === '流浪地球') await slow
        if (query?.query === '出错') throw new Error('boom')
        return path === '/search/multi' ? { results: [HIT] } : DETAIL
      }
    )
    const keyword = ref('')
    const { match } = useHeroMatch(keyword, { tmdb: async () => tmdb })
    keyword.value = '流浪地球'
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)
    keyword.value = '出错'
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(match.value).toBeNull()
  })
})

describe('状态行', () => {
  const offline = (statuses: string[]): OfflineList =>
    ({
      loggedIn: true,
      folder: '',
      checkedAt: null,
      tasks: statuses.map(status => ({ status })),
    }) as unknown as OfflineList

  it('只显示读到的项', () => {
    expect(
      heroStatusItems({
        account: { loggedIn: true, userId: '1', userName: '小明' },
        pansou: true,
        torznabCount: 3,
        offline: offline(['running', 'waiting', 'done', 'failed']),
      })
    ).toEqual([
      { text: '115 已登录 · 小明', ok: true },
      { text: 'PanSou · Torznab 3 个源' },
      { text: '离线中 2' },
    ])
    expect(
      heroStatusItems({
        account: null,
        pansou: false,
        torznabCount: null,
        offline: null,
      })
    ).toEqual([])
    expect(
      heroStatusItems({
        account: { loggedIn: false },
        pansou: false,
        torznabCount: 0,
        offline: offline(['done']),
      })
    ).toEqual([{ text: '115 未登录' }])
  })

  it('useNetdiskStatus：哪项失败哪项为 null', async () => {
    const status = useNetdiskStatus({
      pan115: () => ({
        account: async () => ({ loggedIn: false }),
        torznab: async () => {
          throw new Error('x')
        },
      }),
      offline: () => ({ tasks: async () => offline(['running']) }),
    })
    await status.refresh()
    expect(status.account.value).toEqual({ loggedIn: false })
    expect(status.torznabCount.value).toBeNull()
    expect(status.offline.value?.tasks).toHaveLength(1)
  })
})

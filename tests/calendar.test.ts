/**
 * 追剧日历：渲染层纯规则（按周分组、状态判定、徽标计数、在线剧集数）、
 * 引擎侧规则（拉哪几季、区间内的集）、RPC 参数校验，以及引擎模块对本地文件的对应。
 */
import { describe, expect, it } from 'vitest'

import type { CalendarEpisode } from '../src/shared/library/ipc'
import { parseRpcParams } from '../src/shared/library/ipc'
import { CalendarModule } from '../src/main/library/calendar/calendar-module'
import {
  episodesInRange,
  fallbackEpisodes,
  seasonsToFetch,
} from '../src/main/library/calendar/calendar-rules'
import { openLibraryDb } from '../src/main/library/db/database'
import type {
  TmdbSeason,
  TmdbTvDetails,
} from '../src/main/library/providers/tmdb/tmdb-types'
import {
  addDays,
  dayLabel,
  dayParts,
  daysBetween,
  groupByWeek,
  shiftWeek,
  weekDays,
  weekLabel,
  weekPrefix,
  weekStart,
} from '../src/renderer/src/features/calendar/calendar-dates'
import {
  type CalendarEntry,
  type ContinueLike,
  badgeCount,
  badgeRange,
  episodeStatus,
  libraryEntries,
  libraryEpisodeWatched,
  listGroups,
  onlineEntries,
  parseRemarks,
  showKey,
  weekSummary,
} from '../src/renderer/src/features/calendar/calendar-rules'
import {
  groupShowsByDay,
  mergedCode,
} from '../src/renderer/src/features/calendar/calendar-rows'

const TODAY = '2026-10-24' // 周六

const episode = (patch: Partial<CalendarEpisode> = {}): CalendarEpisode => ({
  seriesId: 7,
  libraryId: 1,
  seriesTitle: 'Severance',
  originalTitle: null,
  season: 3,
  episode: 2,
  title: '第二集',
  airDate: TODAY,
  still: 'https://image.tmdb.org/t/p/w780/s.jpg',
  backdrop: 'yingbox-media://image/0123456789abcdef0123456789abcdef',
  poster: null,
  itemId: 70,
  fileId: 700,
  filePath: '/tv/Severance/S03E02.mkv',
  ...patch,
})

const tvRecord = (patch: Partial<ContinueLike> = {}): ContinueLike => ({
  id: 'tv:7',
  section: 'tv',
  key: '7',
  title: 'Severance',
  replay: {
    playlist: [
      { name: 'S03E01 · 第一集' },
      { name: 'S03E02 · 第二集' },
      { name: 'S03E03 · 第三集' },
    ],
    index: 1,
  },
  ...patch,
})

describe('日历日期：周一开头的周', () => {
  it('周一是一周的开始，周日属于上一周', () => {
    expect(weekStart('2026-10-24')).toBe('2026-10-19')
    expect(weekStart('2026-10-19')).toBe('2026-10-19')
    expect(weekStart('2026-10-25')).toBe('2026-10-19')
    expect(weekStart('2026-10-26')).toBe('2026-10-26')
  })

  it('一周七天、翻周、跨月跨年', () => {
    expect(weekDays('2026-10-26')).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ])
    expect(shiftWeek('2026-10-19', 1)).toBe('2026-10-26')
    expect(shiftWeek('2026-10-19', -1)).toBe('2026-10-12')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(daysBetween('2026-10-18', TODAY)).toBe(6)
  })

  it('标题与日名：今天带前缀，跨年带年份', () => {
    expect(weekLabel('2026-10-19', TODAY)).toBe('10月19日 – 10月25日')
    expect(weekLabel('2026-12-28', TODAY)).toBe('2026年12月28日 – 2027年1月3日')
    expect(dayLabel(TODAY, TODAY)).toBe('今天 · 周六 24')
    expect(dayLabel('2026-10-19', TODAY)).toBe('周一 19')
    expect(dayParts('2026-10-19')).toEqual({ weekday: '周一', day: '19' })
    expect(dayParts('2026-10-25')).toEqual({ weekday: '周日', day: '25' })
    expect(dayParts('bad')).toEqual({ weekday: 'bad', day: '' })
  })

  it('页头周称呼：本周 / 下周 / 上周，更远的周写那周周一，跨年带年份', () => {
    expect(weekPrefix('2026-10-19', TODAY)).toBe('本周')
    expect(weekPrefix('2026-10-26', TODAY)).toBe('下周')
    expect(weekPrefix('2026-10-12', TODAY)).toBe('上周')
    expect(weekPrefix('2026-11-02', TODAY)).toBe('11月2日那周')
    expect(weekPrefix('2027-01-04', TODAY)).toBe('2027年1月4日那周')
  })

  it('按周分组：七个格子，今天标记，别的周和没日期的不进格子', () => {
    const items = [
      { id: 'a', airDate: '2026-10-19' },
      { id: 'b', airDate: TODAY },
      { id: 'c', airDate: TODAY },
      { id: 'd', airDate: '2026-10-26' },
      { id: 'e', airDate: null },
    ]
    const week = groupByWeek(items, '2026-10-21', TODAY)
    expect(week.map(d => d.date)[0]).toBe('2026-10-19')
    expect(week).toHaveLength(7)
    expect(week[0].items.map(i => i.id)).toEqual(['a'])
    expect(week[5]).toMatchObject({ isToday: true })
    expect(week[5].items.map(i => i.id)).toEqual(['b', 'c'])
    expect(week.flatMap(d => d.items).map(i => i.id)).not.toContain('d')
    expect(week.flatMap(d => d.items).map(i => i.id)).not.toContain('e')
  })
})

describe('状态判定', () => {
  it('明天播出是待播；已播出的按是否看过', () => {
    expect(episodeStatus('2026-10-25', TODAY, false)).toBe('upcoming')
    expect(episodeStatus(TODAY, TODAY, false)).toBe('unwatched')
    expect(episodeStatus('2026-10-20', TODAY, true)).toBe('watched')
    expect(episodeStatus(null, TODAY, false)).toBe('unwatched')
  })

  it('媒体库的一集：进度过 90% 或继续播放记录已越过它算看过', () => {
    const ep = { season: 3, episode: 1 }
    expect(libraryEpisodeWatched(ep, tvRecord(), null)).toBe(true)
    expect(
      libraryEpisodeWatched({ season: 3, episode: 2 }, tvRecord(), null)
    ).toBe(false)
    expect(
      libraryEpisodeWatched({ season: 3, episode: 3 }, undefined, {
        progress: 2900,
        duration: 3000,
      })
    ).toBe(true)
    expect(
      libraryEpisodeWatched({ season: 3, episode: 3 }, undefined, {
        progress: 100,
        duration: 0,
      })
    ).toBe(false)
  })

  it('播出数据 → 卡片：剧照优先、本地有文件可播放、未看计 1 集', () => {
    const [watched, current, upcoming, missing] = libraryEntries(
      [
        episode({ episode: 1, airDate: '2026-10-17' }),
        episode(),
        episode({ episode: 3, airDate: '2026-10-31', still: null }),
        episode({ episode: 4, fileId: null, filePath: null, itemId: null }),
      ],
      TODAY,
      [tvRecord()],
      () => null
    )
    expect(watched).toMatchObject({ status: 'watched', newCount: 0 })
    expect(current).toMatchObject({
      code: 'S03E02',
      status: 'unwatched',
      newCount: 1,
      imageKind: 'remote',
      library: { seriesId: 7, season: 3, episode: 2, playable: true },
    })
    expect(upcoming).toMatchObject({
      status: 'upcoming',
      imageKind: 'library',
      newCount: 0,
    })
    expect(missing.library?.playable).toBe(false)
  })
})

describe('在线剧：CMS 备注里的集数', () => {
  it('认出更新到第几集和是否完结', () => {
    expect(parseRemarks('更新至12集')).toEqual({ count: 12, complete: false })
    expect(parseRemarks('更新到第8集')).toEqual({ count: 8, complete: false })
    expect(parseRemarks('第5集')).toEqual({ count: 5, complete: false })
    expect(parseRemarks('全30集')).toEqual({ count: 30, complete: true })
    expect(parseRemarks('36集全')).toEqual({ count: 36, complete: true })
    expect(parseRemarks('已完结')).toEqual({ count: null, complete: true })
    expect(parseRemarks('HD中字')).toEqual({ count: null, complete: false })
    expect(parseRemarks(undefined)).toEqual({ count: null, complete: false })
  })

  const online = (patch: Partial<ContinueLike> = {}): ContinueLike => ({
    id: 'online:庆余年 3',
    section: 'online',
    key: '庆余年 3',
    title: '庆余年 3',
    cover: 'https://img.example/c.jpg',
    detail: { vod_remarks: '更新至6集', vod_time: '2026-10-23 20:00:00' },
    replay: {
      playlist: Array.from({ length: 4 }, (_, i) => ({ name: `第${i + 1}集` })),
      index: 3,
    },
    nextUp: true,
    ...patch,
  })

  it('已更新集数取备注与播放列表的较大值，减去看到的集数', () => {
    const [entry] = onlineEntries([online()], TODAY)
    expect(entry).toMatchObject({
      code: 'E04–06',
      airDate: '2026-10-23',
      status: 'unwatched',
      newCount: 3,
      episodeTitle: '3 集未看',
      online: { recordId: 'online:庆余年 3' },
    })
    // 正在看第 4 集（不是「下一集」）：新集只有 5、6
    const [watching] = onlineEntries([online({ nextUp: false })], TODAY)
    expect(watching).toMatchObject({ code: 'E05–06', newCount: 2 })
  })

  it('看到最新一集为已看；完结剧不计新集；单片和别的板块跳过', () => {
    const [done] = onlineEntries(
      [
        online({
          nextUp: false,
          replay: { playlist: [{}, {}, {}, {}, {}, {}], index: 5 },
        }),
      ],
      TODAY
    )
    expect(done).toMatchObject({ status: 'watched', newCount: 0, code: 'E06' })
    const [complete] = onlineEntries(
      [online({ detail: { vod_remarks: '全40集' } })],
      TODAY
    )
    expect(complete).toMatchObject({
      status: 'unwatched',
      newCount: 0,
      airDate: null,
    })
    expect(
      onlineEntries(
        [
          online({ replay: { playlist: [{}], index: 0 }, detail: {} }),
          online({ section: 'av' }),
        ],
        TODAY
      )
    ).toEqual([])
  })
})

describe('徽标与列表分组', () => {
  const entry = (patch: Partial<CalendarEntry>): CalendarEntry => ({
    id: Math.random().toString(36),
    source: 'library',
    title: 'X',
    code: 'S01E01',
    episodeTitle: null,
    airDate: TODAY,
    image: null,
    imageKind: 'remote',
    status: 'unwatched',
    newCount: 1,
    ...patch,
  })

  it('只数最近 7 天播出且未看的新集；没日期的连载在线剧也算', () => {
    const entries = [
      entry({}),
      entry({ airDate: '2026-10-18' }), // 第 7 天前一天：6 天前
      entry({ airDate: '2026-10-17' }), // 7 天前：不算
      entry({ status: 'watched', newCount: 0 }),
      entry({ status: 'upcoming', airDate: '2026-10-25', newCount: 0 }),
      entry({ source: 'online', airDate: null, newCount: 3 }),
    ]
    expect(badgeCount(entries, TODAY)).toBe(5)
    expect(badgeRange(TODAY)).toEqual({ from: '2026-10-18', to: TODAY })
  })

  it('页头统计按剧的唯一标识去重：同名不同剧分开算，同一部剧多集只算一次', () => {
    const lib = (
      seriesId: number,
      episode: number
    ): CalendarEntry['library'] => ({
      seriesId,
      season: 1,
      episode,
      playable: true,
    })
    const items = [
      entry({ title: '同名剧', library: lib(1, 1) }),
      entry({ title: '同名剧', library: lib(1, 2) }),
      entry({ title: '同名剧', library: lib(2, 1) }),
      entry({
        source: 'online',
        title: '同名剧',
        online: { recordId: 'r1', detail: null },
      }),
    ]
    expect(showKey(items[0])).toBe('library:1')
    expect(showKey(entry({ title: 'Y' }))).toBe('title:Y')
    expect(weekSummary(items, '2026-10-19', TODAY)).toBe(
      '本周 3 部剧 · 4 集更新'
    )
    expect(weekSummary(items, '2026-10-26', TODAY)).toBe(
      '下周 3 部剧 · 4 集更新'
    )
    expect(weekSummary([], '2026-10-19', TODAY)).toBe('')
  })

  it('列表视图按日期分组，今天标记，没日期的在线剧在最后', () => {
    const groups = listGroups(
      [
        entry({ id: 'u', airDate: null, source: 'online', title: '庆余年 3' }),
        entry({ id: 't', title: 'B' }),
        entry({ id: 'm', airDate: '2026-10-19' }),
        entry({ id: 'n', airDate: '2026-10-26' }),
        entry({ id: 's', title: 'A' }),
      ],
      '2026-10-19',
      TODAY
    )
    expect(groups.map(g => g.key)).toEqual(['2026-10-19', TODAY, 'undated'])
    expect(groups[1]).toMatchObject({ isToday: true, label: '今天 · 周六 24' })
    expect(groups[1].items.map(i => i.id)).toEqual(['s', 't'])
    expect(groups[2].label).toBe('在线追剧 · 更新日期未知')
  })
})

describe('引擎：要拉的季与区间内的集', () => {
  const details = (patch: Partial<TmdbTvDetails> = {}): TmdbTvDetails => ({
    id: 95396,
    status: 'Returning Series',
    seasons: [
      { season_number: 0, air_date: '2021-01-01' },
      { season_number: 1, air_date: '2022-02-18' },
      { season_number: 2, air_date: '2025-01-17' },
      { season_number: 3, air_date: '2026-10-17' },
    ],
    last_episode_to_air: {
      season_number: 3,
      episode_number: 2,
      air_date: TODAY,
    },
    next_episode_to_air: {
      season_number: 3,
      episode_number: 3,
      air_date: '2026-10-31',
    },
    ...patch,
  })
  const range = { from: '2026-10-19', to: '2026-10-25' }

  it('季的播出区间与查询区间相交才拉，不拉特别篇', () => {
    expect(seasonsToFetch(details(), range)).toEqual([3])
    expect(
      seasonsToFetch(details(), { from: '2025-06-01', to: '2025-06-07' })
    ).toEqual([2])
  })

  it('季首播日缺失时靠下一集兜底；早已完结的剧不拉', () => {
    const noDate = details({
      seasons: [{ season_number: 3, air_date: null }],
      last_episode_to_air: null,
    })
    expect(
      seasonsToFetch(noDate, { from: '2026-10-26', to: '2026-11-01' })
    ).toEqual([3])
    const ended = details({
      status: 'Ended',
      last_episode_to_air: {
        season_number: 2,
        episode_number: 10,
        air_date: '2025-03-21',
      },
    })
    expect(seasonsToFetch(ended, range)).toEqual([])
  })

  it('季详情里区间内的集；季详情缺失时用上一集 / 下一集', () => {
    const season: TmdbSeason = {
      season_number: 3,
      episodes: [
        { season_number: 3, episode_number: 1, air_date: '2026-10-17' },
        {
          season_number: 3,
          episode_number: 2,
          air_date: TODAY,
          name: '第二集',
          still_path: '/s.jpg',
        },
        { season_number: 3, episode_number: 3, air_date: '2026-10-31' },
        { season_number: 3, episode_number: 4, air_date: '' },
      ],
    }
    expect(episodesInRange(season, range)).toEqual([
      {
        season: 3,
        episode: 2,
        title: '第二集',
        airDate: TODAY,
        stillPath: '/s.jpg',
      },
    ])
    expect(
      fallbackEpisodes(details(), range, new Set()).map(e => e.episode)
    ).toEqual([2])
    expect(fallbackEpisodes(details(), range, new Set([3]))).toEqual([])
  })
})

describe('RPC calendar.episodes', () => {
  it('参数：YYYY-MM-DD 闭区间，最多 62 天', () => {
    expect(
      parseRpcParams('calendar.episodes', { from: '2026-10-19', to: TODAY })
    ).toEqual({ from: '2026-10-19', to: TODAY })
    expect(() =>
      parseRpcParams('calendar.episodes', { from: '2026-10-19' })
    ).toThrow()
    expect(() =>
      parseRpcParams('calendar.episodes', { from: TODAY, to: '2026-10-19' })
    ).toThrow()
    expect(() =>
      parseRpcParams('calendar.episodes', { from: '2026-02-30', to: TODAY })
    ).toThrow()
    expect(() =>
      parseRpcParams('calendar.episodes', {
        from: '2026-01-01',
        to: '2026-12-31',
      })
    ).toThrow()
  })

  it('混合库剧集参与日历，并合并不同库中的本地集', async () => {
    const db = openLibraryDb(':memory:')
    const library = db.prepare(
      'INSERT INTO libraries (root, root_display, kind, name, created_at, mixed) VALUES (?, ?, ?, ?, 1, ?) RETURNING id'
    )
    const movie = Number(
      library.get('/movies', '/movies', 'movie', '混合', 1)!.id
    )
    const tv = Number(library.get('/tv', '/tv', 'tv', '剧集', 0)!.id)
    const add = db.prepare(
      `INSERT INTO media_items (library_id, type, parent_id, local_key, title,
        season_number, episode_number, tmdb_id, match_state, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1) RETURNING id`
    )
    const mixedSeries = Number(
      add.get(movie, 'series', null, 'mixed', '剧', null, null, '42', 'auto')!
        .id
    )
    const tvSeries = Number(
      add.get(tv, 'series', null, 'tv', '剧', null, null, '42', 'auto')!.id
    )
    const episode = Number(
      add.get(tv, 'episode', tvSeries, 'ep', '第一集', 1, 1, null, 'auto')!.id
    )
    const file = Number(
      db
        .prepare(
          `INSERT INTO files (library_id, path, display_path, dir, name, kind, size, mtime, added_at, updated_at)
       VALUES (?, '/tv/e.mkv', '/tv/e.mkv', '/tv', 'e.mkv', 'video', 1, 1, 1, 1) RETURNING id`
        )
        .get(tv)!.id
    )
    db.prepare('INSERT INTO file_media (file_id, item_id) VALUES (?, ?)').run(
      file,
      episode
    )
    const calendar = new CalendarModule({
      db,
      provider: () => ({
        configured: true,
        airing: async () => ({
          id: 42,
          status: 'Returning Series',
          seasons: [{ season_number: 1, air_date: TODAY }],
        }),
        airingSeason: async () => ({
          season_number: 1,
          episodes: [{ season_number: 1, episode_number: 1, air_date: TODAY }],
        }),
      }),
    })
    const result = await calendar.episodes({ from: TODAY, to: TODAY })
    expect(result.series).toBe(1)
    expect(result.episodes).toMatchObject([
      { seriesId: mixedSeries, itemId: episode, fileId: file },
    ])
    expect(tvSeries).not.toBe(mixedSeries)
    db.close()
  })

  it('引擎模块：已匹配的剧按 TMDB 播出日排列，并对上本地文件', async () => {
    const db = openLibraryDb(':memory:')
    const lib = Number(
      db
        .prepare(
          "INSERT INTO libraries (root, root_display, kind, name, created_at) VALUES ('/tv', '/tv', 'tv', 'tv', 1) RETURNING id"
        )
        .get()!.id
    )
    const insert = db.prepare(
      `INSERT INTO media_items (library_id, type, parent_id, local_key, title,
         season_number, episode_number, tmdb_id, match_state, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1) RETURNING id`
    )
    const add = (...args: Array<string | number | null>): number =>
      Number(insert.get(lib, ...args)!.id)
    const series = add(
      'series',
      null,
      's',
      'Severance',
      null,
      null,
      '95396',
      'auto'
    )
    db.prepare(
      "UPDATE media_items SET original_title = '人生切割术' WHERE id = ?"
    ).run(series)
    add('series', null, 'u', '未匹配', null, null, null, 'unmatched')
    const season = add('season', series, 's3', 'S3', 3, null, null, 'auto')
    const ep2 = add('episode', season, 's3e2', 'E2', 3, 2, null, 'auto')
    const file = Number(
      db
        .prepare(
          `INSERT INTO files (library_id, path, display_path, dir, name, kind, size, mtime, added_at, updated_at)
           VALUES (?, '/tv/S03E02.mkv', '/tv/S03E02.mkv', '/tv', 'S03E02.mkv', 'video', 1, 1, 1, 1) RETURNING id`
        )
        .get(lib)!.id
    )
    db.prepare('INSERT INTO file_media (file_id, item_id) VALUES (?, ?)').run(
      file,
      ep2
    )
    const calls: string[] = []
    const module = new CalendarModule({
      db,
      provider: () => ({
        configured: true,
        airing: async id => {
          calls.push(`tv:${id}`)
          return {
            id: 95396,
            status: 'Returning Series',
            seasons: [{ season_number: 3, air_date: '2026-10-17' }],
          }
        },
        airingSeason: async (id, n) => {
          calls.push(`season:${id}:${n}`)
          return {
            season_number: 3,
            episodes: [
              { season_number: 3, episode_number: 3, air_date: '2026-10-25' },
              { season_number: 3, episode_number: 2, air_date: TODAY },
            ],
          }
        },
      }),
    })
    const result = await module.episodes({
      from: '2026-10-19',
      to: '2026-10-25',
    })
    expect(calls).toEqual(['tv:95396', 'season:95396:3'])
    expect(result).toMatchObject({ configured: true, series: 1, failed: 0 })
    expect(result.episodes.map(e => [e.episode, e.fileId, e.itemId])).toEqual([
      [2, file, ep2],
      [3, null, null],
    ])
    expect(result.episodes[0]).toMatchObject({
      seriesId: series,
      seriesTitle: 'Severance',
      originalTitle: '人生切割术',
      filePath: '/tv/S03E02.mkv',
    })
    const off = new CalendarModule({
      db,
      provider: () => ({
        configured: false,
        airing: async () => null,
        airingSeason: async () => null,
      }),
    })
    expect(await off.episodes({ from: TODAY, to: TODAY })).toMatchObject({
      configured: false,
      episodes: [],
    })
    db.close()
  })
})

describe('周视图同剧同日合并', () => {
  const ep = (
    seriesId: number,
    episode: number,
    patch: Partial<CalendarEntry> = {}
  ): CalendarEntry => ({
    id: `lib:${seriesId}:1:${episode}`,
    source: 'library',
    title: `剧${seriesId}`,
    code: `S01E${String(episode).padStart(2, '0')}`,
    episodeTitle: `第 ${episode} 集`,
    airDate: TODAY,
    image: null,
    imageKind: 'remote',
    status: 'unwatched',
    newCount: 1,
    library: { seriesId, season: 1, episode, playable: true },
    ...patch,
  })

  it('同一部剧同一天合并成一行，集号写成区间，保持剧出现的先后', () => {
    const groups = groupShowsByDay([
      ep(1, 10),
      ep(2, 3, { image: 'b.jpg' }),
      ep(1, 9, { image: 'a.jpg' }),
    ])
    expect(groups.map(g => g.title)).toEqual(['剧1', '剧2'])
    expect(groups[0].code).toBe('S01E09–E10')
    expect(groups[0].entries.map(e => e.code)).toEqual(['S01E09', 'S01E10'])
    expect(groups[0].image).toBe('a.jpg')
    expect(groups[0].episodeTitle).toBeNull()
    expect(groups[1].code).toBe('S01E03')
    expect(groups[1].episodeTitle).toBe('第 3 集')
  })

  it('集号不连续或跨季时写「第一集 等 N 集」', () => {
    expect(mergedCode([ep(1, 9), ep(1, 12)])).toBe('S01E09 等 2 集')
    const s2 = ep(1, 1, {
      code: 'S02E01',
      library: { seriesId: 1, season: 2, episode: 1, playable: true },
    })
    expect(mergedCode([ep(1, 9), s2])).toBe('S01E09 等 2 集')
  })

  it('状态与点开的那一集：有未看就未看并打开第一集未看；全待播才待播', () => {
    const [g] = groupShowsByDay([ep(1, 9, { status: 'watched' }), ep(1, 10)])
    expect(g.status).toBe('unwatched')
    expect(g.primary.code).toBe('S01E10')
    const [up] = groupShowsByDay([
      ep(1, 9, { status: 'upcoming' }),
      ep(1, 10, { status: 'upcoming' }),
    ])
    expect(up.status).toBe('upcoming')
    expect(up.primary.code).toBe('S01E09')
    const [seen] = groupShowsByDay([
      ep(1, 9, { status: 'watched' }),
      ep(1, 10, { status: 'upcoming' }),
    ])
    expect(seen.status).toBe('watched')
  })
})

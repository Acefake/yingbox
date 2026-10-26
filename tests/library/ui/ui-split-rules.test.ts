import { describe, expect, it } from 'vitest'

import type {
  LibraryItemFile,
  LibraryItemNode,
  LibraryItemSummary,
} from '../../../src/shared/library/ipc'
import {
  allVideoFiles,
  defaultSeasonKey,
  infoRowsOf,
  metaLineOf,
  peopleOf,
  playLabelOf,
  seasonEpisodes,
  seasonName,
  sortedSeasons,
  titleMetaOf,
} from '../../../src/renderer/src/features/library/detail/detail-rules'
import {
  emptyTitleFor,
  libraryOptionsFor,
  parseDetailId,
  reviewChipCount,
  selectionStep,
} from '../../../src/renderer/src/features/library/page/page-rules'
import {
  candidateKeyIndex,
  clipFiles,
  confidenceClass,
} from '../../../src/renderer/src/features/library/review/match-rules'
import {
  batchDescription,
  batchTitle,
  folderDescription,
  showUndo,
  templateOf,
  templateVariablesFor,
  tokenStatus,
} from '../../../src/renderer/src/features/library/settings/settings-rules'
import {
  arrowTarget,
  buildCells,
  clickModifiers,
  loadedIds,
} from '../../../src/renderer/src/features/library/wall/wall-cells'
import { DEFAULT_WRITER_SETTINGS } from '../../../src/shared/library/ipc'

const summary = (
  id: number,
  extra: Partial<LibraryItemSummary> = {}
): LibraryItemSummary => ({
  id,
  libraryId: 1,
  type: 'movie',
  title: `T${id}`,
  originalTitle: null,
  year: null,
  matchState: 'auto',
  providerIds: {},
  poster: null,
  backdrop: null,
  rating: null,
  addedAt: 0,
  updatedAt: 0,
  ...extra,
})

const file = (id: number, path: string, kind = 'video'): LibraryItemFile =>
  ({ id, path, kind, size: 1 }) as LibraryItemFile

const node = (
  id: number,
  extra: Partial<LibraryItemNode> = {}
): LibraryItemNode => ({
  ...summary(id),
  seasonNumber: null,
  episodeNumber: null,
  overview: null,
  logo: null,
  runtime: null,
  genres: [],
  airDate: null,
  metadata: null,
  files: [],
  children: [],
  ...extra,
})

const meta = (
  extra: Record<string, unknown> = {}
): LibraryItemNode['metadata'] =>
  ({
    level: 'title',
    cast: [],
    crew: [],
    countries: [],
    companies: [],
    ...extra,
  }) as unknown as LibraryItemNode['metadata']

describe('媒体库页面规则', () => {
  it('详情路由参数只认正的安全整数', () => {
    expect(parseDetailId('12')).toBe(12)
    expect(parseDetailId('0')).toBeNull()
    expect(parseDetailId('1.5')).toBeNull()
    expect(parseDetailId('abc')).toBeNull()
    expect(parseDetailId(['3'])).toBeNull()
    expect(parseDetailId(undefined)).toBeNull()
  })

  it('空状态标题：搜索 > 筛选 > 未扫描', () => {
    expect(emptyTitleFor({ search: 'x', filter: 'review' })).toBe('没有找到“x”')
    expect(emptyTitleFor({ search: '', filter: 'review' })).toBe(
      '没有符合筛选条件的条目'
    )
    expect(emptyTitleFor({ search: '', filter: 'all' })).toBe(
      '文件夹里还没有扫描到视频'
    )
  })

  it('待确认标签与媒体库下拉', () => {
    expect(reviewChipCount(0)).toBeUndefined()
    expect(reviewChipCount(1)).toBe('1')
    expect(reviewChipCount(1234)).toBe('1,234')
    expect(libraryOptionsFor([{ id: 3, name: 'A' }])).toEqual([
      { value: 0, label: '全部文件夹' },
      { value: 3, label: 'A' },
    ])
  })

  it('多选：Shift 从锚点连选（跳过未加载），锚点不变', () => {
    const at = (i: number): { id: number } | undefined =>
      i === 3 ? undefined : { id: 100 + i }
    const step = selectionStep(
      new Set([1]),
      5,
      2,
      { id: 102 },
      { toggle: false, range: true, double: false },
      at
    )
    expect(step).toEqual({
      kind: 'select',
      selection: new Set([1, 102, 104, 105]),
      anchor: 5,
    })
  })

  it('多选：没有锚点时 Shift 当普通点击；Ctrl 切换并移锚点', () => {
    const at = (i: number): { id: number } => ({ id: i })
    expect(
      selectionStep(
        new Set(),
        -1,
        2,
        { id: 2 },
        { toggle: false, range: true, double: false },
        at
      )
    ).toEqual({ kind: 'open', clear: false, anchor: 2 })
    expect(
      selectionStep(
        new Set([2]),
        0,
        2,
        { id: 2 },
        { toggle: true, range: false, double: false },
        at
      )
    ).toEqual({ kind: 'select', selection: new Set(), anchor: 2 })
    expect(
      selectionStep(
        new Set(),
        0,
        4,
        { id: 4 },
        { toggle: true, range: false, double: false },
        at
      )
    ).toEqual({ kind: 'select', selection: new Set([4]), anchor: 4 })
  })

  it('多选：有选区时单击先清空再打开，双击不清空', () => {
    const at = (): undefined => undefined
    const sel = new Set([9])
    expect(
      selectionStep(
        sel,
        0,
        1,
        { id: 1 },
        { toggle: false, range: false, double: false },
        at
      )
    ).toEqual({ kind: 'open', clear: true, anchor: 1 })
    expect(
      selectionStep(
        sel,
        0,
        1,
        { id: 1 },
        { toggle: false, range: false, double: true },
        at
      )
    ).toEqual({ kind: 'open', clear: false, anchor: 1 })
  })
})

describe('匹配对照规则', () => {
  it('置信度分档、文件截断、数字键', () => {
    expect(confidenceClass(0.8)).toBe('is-high')
    expect(confidenceClass(0.79)).toBe('is-mid')
    expect(confidenceClass(0.6)).toBe('is-mid')
    expect(confidenceClass(0.59)).toBe('is-low')
    expect(clipFiles(['a', 'b', 'c', 'd', 'e', 'f'])).toEqual({
      shown: ['a', 'b', 'c', 'd'],
      more: 2,
    })
    expect(clipFiles(['a']).more).toBeLessThanOrEqual(0)
    expect([
      candidateKeyIndex('1'),
      candidateKeyIndex('3'),
      candidateKeyIndex('4'),
    ]).toEqual([0, 2, -1])
  })
})

describe('媒体库设置规则', () => {
  it('文件夹描述与令牌状态', () => {
    const fmt = (t: number): string => `@${t}`
    expect(folderDescription({ root: '/m', lastScanAt: 5 }, fmt)).toBe(
      '/m · 上次扫描 @5'
    )
    expect(folderDescription({ root: '/m', lastScanAt: null }, fmt)).toBe(
      '/m · 尚未扫描'
    )
    expect(tokenStatus(false, true)).toBe('仅桌面版可用')
    expect(tokenStatus(true, true)).toBe('已配置')
    expect(tokenStatus(true, false)).toBe('尚未配置，无法识别')
  })

  it('模板变量：电影不含剧集变量；按类型取模板', () => {
    const movie = templateVariablesFor('movie')
    const tv = templateVariablesFor('tv')
    expect(movie).toContain('{title}')
    expect(movie).not.toContain('{season}')
    expect(movie).not.toContain('{episodeTitle}')
    expect(tv).toContain('{season}')
    expect(tv).toContain('{episodeTitle}')
    expect(templateOf(DEFAULT_WRITER_SETTINGS, 'movie')).toBe(
      DEFAULT_WRITER_SETTINGS.organize.movieTemplate
    )
    expect(templateOf(DEFAULT_WRITER_SETTINGS, 'tv')).toBe(
      DEFAULT_WRITER_SETTINGS.organize.tvTemplate
    )
  })

  it('批次标题 / 描述 / 撤销按钮', () => {
    expect(batchTitle({ createdAt: 1, state: 'partial' }, t => `@${t}`)).toBe(
      '@1 · 部分完成'
    )
    expect(batchDescription({ moved: 3, total: 5, failed: 0 })).toBe(
      '移动 3 / 5 个文件'
    )
    expect(batchDescription({ moved: 3, total: 5, failed: 2 })).toBe(
      '移动 3 / 5 个文件，2 个失败'
    )
    expect(showUndo('done') && showUndo('partial')).toBe(true)
    expect(
      showUndo('failed') || showUndo('undone') || showUndo('running')
    ).toBe(false)
  })
})

describe('海报墙规则', () => {
  const items = new Map([
    [
      0,
      summary(10, {
        poster: 'p10',
        rating: 7.25,
        ratingSource: 'douban',
        matchState: 'review',
      }),
    ],
    [2, summary(12, { matchState: 'unmatched' })],
  ])
  const base = {
    start: 0,
    end: 3,
    at: (i: number) => items.get(i),
    offset: (i: number) => ({ x: i * 10, y: 5 }),
    deferImages: false,
    shown: new Set<number>(),
    selected: new Set([12]),
    showStateBadge: true,
    image: (p: string | null) => (p ? `img:${p}` : null),
  }

  it('渲染格：占位格、图片、角标、评分、选中、位移', () => {
    const cells = buildCells(base)
    expect(cells.map(c => c.key)).toEqual([10, 'p1', 12])
    expect(cells[0]).toMatchObject({
      src: 'img:p10',
      badge: '待确认',
      rating: '豆瓣 7.3',
      selected: false,
      style: { transform: 'translate3d(0px, 5px, 0)' },
    })
    expect(cells[1]).toMatchObject({
      item: undefined,
      src: null,
      badge: '',
      rating: '',
    })
    expect(cells[2]).toMatchObject({
      badge: '未匹配',
      selected: true,
      src: null,
    })
  })

  it('动态范围规格标签与详情同一套（videoRangeSpec），SDR 与没探测过不显示', () => {
    const ranged = new Map([
      [0, summary(20, { videoRange: 'dv' })],
      [1, summary(21, { videoRange: 'hdr10' })],
      [2, summary(22, { videoRange: 'sdr' })],
      [3, summary(23)],
    ])
    const cells = buildCells({
      ...base,
      end: 4,
      at: (i: number) => ranged.get(i),
    })
    expect(cells.map(c => c.range)).toEqual([
      { variant: 'dolby', text: 'VISION' },
      { variant: 'solid', text: 'HDR10' },
      null,
      null,
    ])
  })

  it('快速滚动只给显示过的条目图片；关掉角标', () => {
    const cells = buildCells({
      ...base,
      deferImages: true,
      shown: new Set([12]),
      showStateBadge: false,
      image: () => 'x',
    })
    expect(cells.map(c => c.src)).toEqual([null, null, 'x'])
    expect(cells.every(c => c.badge === '')).toBe(true)
  })

  it('已加载 id、方向键目标、修饰键', () => {
    expect([...loadedIds(0, 3, i => items.get(i))]).toEqual([10, 12])
    expect(arrowTarget('ArrowRight', 4, 5, 10)).toBe(5)
    expect(arrowTarget('ArrowDown', 7, 5, 10)).toBe(9)
    expect(arrowTarget('ArrowUp', 2, 5, 10)).toBe(0)
    expect(arrowTarget('ArrowLeft', 0, 5, 10)).toBe(0)
    expect(arrowTarget('Tab', 3, 5, 10)).toBeNull()
    expect(
      clickModifiers({ metaKey: false, ctrlKey: true, shiftKey: true })
    ).toEqual({
      toggle: true,
      range: true,
      double: false,
    })
    expect(
      clickModifiers({ metaKey: true, ctrlKey: false, shiftKey: false }).toggle
    ).toBe(true)
  })
})

describe('条目详情规则', () => {
  const ep = (
    id: number,
    n: number | null,
    files: LibraryItemFile[] = []
  ): LibraryItemNode => node(id, { type: 'episode', episodeNumber: n, files })
  const season = (
    id: number,
    n: number | null,
    children: LibraryItemNode[] = []
  ): LibraryItemNode =>
    node(id, { type: 'season', seasonNumber: n, title: `S${id}`, children })

  it('季排序（特别篇最后）、命名、默认季、集排序', () => {
    const series = node(1, {
      type: 'series',
      children: [
        season(20, 0),
        season(21, null),
        season(22, 2),
        season(23, 1, [ep(3, 2), ep(4, 1), ep(5, null)]),
      ],
    })
    expect(sortedSeasons(series).map(s => s.id)).toEqual([23, 22, 21, 20])
    expect(sortedSeasons(series).map(seasonName)).toEqual([
      '第 1 季',
      '第 2 季',
      'S21',
      '特别篇',
    ])
    expect(defaultSeasonKey(series)).toBe('23')
    expect(defaultSeasonKey(node(9))).toBe('')
    expect(seasonEpisodes(series.children[3]).map(e => e.id)).toEqual([5, 4, 3])
    expect(seasonEpisodes(null)).toEqual([])
  })

  it('信息行：电影带时长，剧集数季（不含特别篇），分级、评分、前三个类型', () => {
    const movie = node(1, {
      year: 2020,
      runtime: 125,
      rating: 8.06,
      genres: ['a', 'b', 'c', 'd'],
      metadata: meta({ certification: 'PG-13' }),
    })
    expect(metaLineOf(movie, [])).toEqual([
      '2020',
      '2 小时 5 分钟',
      'PG-13',
      '★ 8.1',
      'a / b / c',
    ])
    const series = node(2, { type: 'series', runtime: 40 })
    expect(
      metaLineOf(series, [season(1, 0), season(2, 1), season(3, 2)])
    ).toEqual(['2 季'])
    expect(
      metaLineOf(node(3, { rating: 7.94, ratingSource: 'tmdb' }), [])
    ).toEqual(['★ TMDB 7.9'])
    expect(metaLineOf(null, [])).toEqual([])
  })

  it('演职员：导演 / 主创在前，其余幕后不要', () => {
    const m = meta({
      crew: [
        { id: 1, name: 'W', job: 'Writer' },
        { id: 2, name: 'D', job: 'Director', profilePath: '/d.jpg' },
        { id: 3, name: 'C', job: 'Creator' },
      ],
      cast: [
        { id: 4, name: 'A', character: 'Hero' },
        { id: 5, name: 'B' },
      ],
    })
    const people = peopleOf(titleMetaOf(node(1, { metadata: m })), p =>
      p ? `ph:${p}` : null
    )
    expect(people).toEqual([
      { key: 'crew-2-Director', name: 'D', role: '导演', photo: 'ph:/d.jpg' },
      { key: 'crew-3-Creator', name: 'C', role: '主创', photo: null },
      { key: 'cast-4', name: 'A', role: 'Hero', photo: null },
      { key: 'cast-5', name: 'B', role: '', photo: null },
    ])
    expect(peopleOf(null, () => null)).toEqual([])
  })

  it('信息表', () => {
    const n = node(1, {
      title: 'T',
      originalTitle: 'O',
      matchState: 'locked',
      providerIds: { tmdb: '9', imdb: 'tt1' },
      metadata: meta({
        releaseDate: '2020-01-01',
        crew: [
          { id: 1, name: 'W1', job: 'Writer' },
          { id: 2, name: 'W2', job: 'Screenplay' },
        ],
        countries: ['US', 'CN'],
        companies: ['a', 'b', 'c', 'd'],
        status: 'Released',
      }),
    })
    expect(infoRowsOf(n)).toEqual([
      { label: '原名', value: 'O' },
      { label: '上映', value: '2020-01-01' },
      { label: '编剧', value: 'W1、W2' },
      { label: '国家 / 地区', value: 'US、CN' },
      { label: '出品', value: 'a、b、c' },
      { label: '状态', value: 'Released' },
      { label: '匹配', value: '已锁定' },
      { label: 'TMDB', value: '9' },
      { label: 'IMDb', value: 'tt1' },
    ])
    expect(infoRowsOf(node(2, { originalTitle: 'T2' }))).toEqual([
      { label: '匹配', value: '已匹配' },
    ])
    // 未知匹配状态没有文案：不出空值行
    const unknown = node(3, {
      matchState: 'matched' as unknown as LibraryItemNode['matchState'],
    })
    expect(infoRowsOf(unknown).some(r => r.label === '匹配')).toBe(false)
  })

  it('文件：递归收集视频，路径自然排序；播放按钮文字', () => {
    const n = node(1, {
      files: [file(1, '/a/ep10.mkv'), file(2, '/a/x.nfo', 'nfo')],
      children: [node(2, { files: [file(3, '/a/ep2.mkv')] })],
    })
    expect(allVideoFiles(n).map(f => f.id)).toEqual([3, 1])
    expect(allVideoFiles(null)).toEqual([])
    expect(playLabelOf('movie', 'x')).toBe('播放')
    expect(playLabelOf('series', null)).toBe('播放')
    expect(playLabelOf('series', 'S01E01')).toBe('播放 S01E01')
    expect(playLabelOf('series', undefined)).toBe('播放 ')
  })
})

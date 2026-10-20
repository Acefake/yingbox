import { describe, expect, it } from 'vitest'
import type { AmaneFile, AmaneFilm } from '@/features/amane/api/amane'
import {
  clipList,
  cycleIndex,
  detailCover,
  filmCoverSource,
  filmFacts,
  filmStills,
  filmSubtitle,
  hoverImages,
  hoverPosition,
  nextUserTags,
  runtimeText,
  sourceLinks,
} from '@/features/amane/utils/film'
import {
  type ListFilters,
  PAGE_SIZE,
  hasMore,
  listQuery,
  nearBottom,
  nextSort,
  organizeFilesConfirm,
  playTitle,
  searchPlaceholder,
  sortByScore,
  sortLabel,
} from '@/features/amane/utils/library-query'

const film = (over: Partial<AmaneFilm> = {}): AmaneFilm => ({
  id: 1,
  number: 'ABC-001',
  title: '标题',
  actors: [],
  tags: [],
  studio: null,
  release: null,
  runtime: null,
  plot: null,
  poster_url: null,
  thumb_url: null,
  poster_urls: [],
  thumb_urls: [],
  score: null,
  file_count: 0,
  ...over,
})
/** 模拟 amaneImage：只有 /api/resources/ 开头的才能加载 */
const toImage = (s?: string | null): string =>
  s && s.startsWith('/api/resources/') ? `img:${s}` : ''

describe('影片卡片', () => {
  it('封面优先竖版海报，再退到缩略图', () => {
    expect(filmCoverSource(film({ poster_url: 'p', thumb_url: 't' }))).toBe('p')
    expect(filmCoverSource(film({ poster_urls: ['p2'], thumb_url: 't' }))).toBe(
      'p2'
    )
    expect(filmCoverSource(film({ thumb_url: 't' }))).toBe('t')
  })
  it('副标题：有标题才带番号；有演员取前两位，否则发行年份', () => {
    expect(filmSubtitle(film({ actors: ['a', 'b', 'c'] }))).toBe(
      'ABC-001 · a / b'
    )
    expect(filmSubtitle(film({ title: null, release: '2020-05-01' }))).toBe(
      '2020'
    )
    expect(filmSubtitle(film({ title: null }))).toBe('')
  })
  it('片长与名单截断', () => {
    expect(runtimeText(125)).toBe('2h 5m')
    expect(clipList(['a', 'b', 'c'], 2, ' / ')).toBe('a / b …')
    expect(clipList(['a'], 2, ' / ')).toBe('a')
  })
})

describe('影片详情', () => {
  it('海报跳过加载失败的', () => {
    const f = film({ poster_url: 'a', poster_urls: ['b', 'c'] })
    expect(detailCover(f, ['a'])).toBe('b')
    expect(detailCover(f, ['a', 'b', 'c'])).toBeNull()
  })
  it('信息行去掉空值，系列有才显示', () => {
    expect(filmFacts(film({ studio: 'S' })).map(f => f.field)).toEqual([
      'studio',
    ])
    expect(
      filmFacts(film({ publisher: 'P', series: 'X' })).map(f => f.label)
    ).toEqual(['发行商', '系列'])
  })
  it('来源链接只留 http(s)', () => {
    expect(
      sourceLinks(
        film({
          source_urls: {
            a: 'https://x.com/1',
            b: 'javascript:alert(1)',
            c: 3,
            d: 'not a url',
          },
        })
      )
    ).toEqual([{ name: 'a', url: 'https://x.com/1' }])
  })
  it('剧照：本地优先、去重、去掉不能加载的；没有本地时用远程', () => {
    expect(
      filmStills(
        film({ extrafanart: ['/api/resources/a', '/api/resources/a', 'x'] }),
        toImage
      )
    ).toEqual(['/api/resources/a'])
    expect(
      filmStills(
        film({
          extrafanart_urls: {
            s1: ['/api/resources/b'],
            s2: ['/api/resources/c'],
          },
        }),
        toImage
      )
    ).toEqual(['/api/resources/b', '/api/resources/c'])
  })
  it('预览循环翻页', () => {
    expect(cycleIndex(0, -1, 3)).toBe(2)
    expect(cycleIndex(2, 1, 3)).toBe(0)
  })
  it('用户标签：移除按 id；添加已存在不重复', () => {
    const tags = [{ id: 1, name: 'a' }]
    expect(nextUserTags(tags, 'detach', 1)).toEqual([])
    expect(nextUserTags(tags, 'attach', 1, { id: 1, name: 'a' })).toBe(tags)
    expect(nextUserTags(tags, 'attach', 2, { id: 2, name: 'b' })).toEqual([
      ...tags,
      { id: 2, name: 'b' },
    ])
  })
})

describe('悬停预览', () => {
  it('轮播图：剧照去重，没有剧照用封面，去掉失败的', () => {
    const f = film({
      extrafanart: [
        '/api/resources/a',
        '',
        '/api/resources/a',
        '/api/resources/b',
      ],
    })
    expect(hoverImages(f, ['img:/api/resources/b'], toImage)).toEqual([
      'img:/api/resources/a',
    ])
    expect(
      hoverImages(film({ poster_url: '/api/resources/p' }), [], toImage)
    ).toEqual(['img:/api/resources/p'])
    expect(hoverImages(film(), [], toImage)).toEqual([])
  })
  it('右侧放得下放右侧，否则左侧，再不行压在卡片上并夹在视口内', () => {
    const vp = { width: 1600, height: 900 }
    expect(hoverPosition({ left: 100, right: 300, top: 200 }, vp)).toEqual({
      left: 310,
      top: 190,
    })
    expect(hoverPosition({ left: 1100, right: 1300, top: 200 }, vp)).toEqual({
      left: 690,
      top: 190,
    })
    expect(
      hoverPosition(
        { left: 200, right: 400, top: 5 },
        { width: 700, height: 900 }
      )
    ).toEqual({ left: 200, top: 10 })
    expect(hoverPosition({ left: 100, right: 300, top: 800 }, vp).top).toBe(350)
  })
})

describe('片库列表查询', () => {
  const base: ListFilters = {
    tab: 'films',
    page: 2,
    search: ' 关键字 ',
    sortField: 'release',
    sortOrder: 'asc',
    advanced: { genre: ['a', 'b'] },
    actorId: 5,
    tagId: null,
    libraryId: 9,
    taskStatus: 'failed',
  }
  it('影片：分页、搜索去空白、排序、高级筛选、演员', () => {
    expect(listQuery(base).toString()).toBe(
      `offset=${2 * PAGE_SIZE}&limit=${PAGE_SIZE}&search=%E5%85%B3%E9%94%AE%E5%AD%97&sort_by=release&order=asc&genre=a&genre=b&actor_id=5`
    )
  })
  it('评分排序时后台按更新时间降序', () => {
    const q = listQuery({ ...base, sortField: 'score' })
    expect([q.get('sort_by'), q.get('order')]).toEqual(['updated_at', 'desc'])
  })
  it('文件按媒体库、任务按状态；媒体库与任务不带搜索', () => {
    expect(listQuery({ ...base, tab: 'files' }).get('library_id')).toBe('9')
    const tasks = listQuery({ ...base, tab: 'tasks' })
    expect([
      tasks.get('status'),
      tasks.get('search'),
      tasks.get('sort_by'),
    ]).toEqual(['failed', null, null])
    expect(listQuery({ ...base, tab: 'libraries' }).get('search')).toBeNull()
  })
  it('评分排序：去重、无评分垫底、同分按发行日期新→旧再按 id', () => {
    const items = [
      film({ id: 1, score: 7 }),
      film({ id: 2, score: null }),
      film({ id: 3, score: 9 }),
      film({ id: 4, score: 7, release: '2021' }),
      film({ id: 1, score: 7 }),
      film({ id: 5, score: 7 }),
    ]
    expect(sortByScore(items, 'desc').map(f => f.id)).toEqual([3, 4, 1, 5, 2])
    expect(sortByScore(items, 'asc').map(f => f.id)).toEqual([4, 1, 5, 3, 2])
  })
  it('排序切换：同字段翻转，换字段默认降序', () => {
    expect(nextSort({ field: 'title', order: 'desc' }, 'title')).toEqual({
      field: 'title',
      order: 'asc',
    })
    expect(nextSort({ field: 'title', order: 'asc' }, 'score')).toEqual({
      field: 'score',
      order: 'desc',
    })
    expect(sortLabel('score')).toBe('评分')
  })
  it('无限滚动：还有下一页且离底部 480px 内', () => {
    expect(hasMore(0, PAGE_SIZE + 1)).toBe(true)
    expect(hasMore(0, PAGE_SIZE)).toBe(false)
    expect(
      nearBottom({ scrollTop: 520, clientHeight: 500, scrollHeight: 1500 })
    ).toBe(true)
    expect(
      nearBottom({ scrollTop: 519, clientHeight: 500, scrollHeight: 1500 })
    ).toBe(false)
  })
  it('占位文字与播放标题', () => {
    expect(searchPlaceholder('actors')).toBe('搜索演员')
    expect(searchPlaceholder('files')).toBe('搜索文件或番号')
    expect(searchPlaceholder('films')).toBe('搜索片名、番号')
    expect(playTitle('D:\\v\\a.mp4')).toBe('a.mp4')
    expect(playTitle('')).toBe('正在播放')
  })
  it('整理确认：单条列三件事，多条报数量，都附路径', () => {
    const f = (path: string): AmaneFile => ({
      id: 1,
      path,
      number: null,
      status: '',
      library_id: 1,
      metadata_id: 1,
    })
    expect(organizeFilesConfirm([f('/a.mp4')])).toMatch(
      /^整理这一条会做三件事[\s\S]*\/a\.mp4\n\n确定继续？$/
    )
    expect(organizeFilesConfirm([f('/a'), f('/b')])).toMatch(
      /^整理这 2 条[\s\S]*\/a\n\/b/
    )
  })
})

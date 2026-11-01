/**
 * 番号库独立成页：分区归属、视图与空状态文案、跨分区链接换页、成人页面路由守卫。
 */
import { describe, expect, it } from 'vitest'

import {
  SECTIONS,
  baseSectionOf,
  librariesIn,
  newLibraryShape,
  pageOf,
  recordSectionsOf,
  sectionOf,
} from '../../../src/renderer/src/features/library/state/library-section'
import {
  noFolderCopy,
  toolbarActions,
  viewOptionsFor,
} from '../../../src/renderer/src/features/library/page/page-rules'
import { localNavPages } from '../../../src/renderer/src/features/library/state/use-local-nav-pages'
import { guardStep } from '../../../src/renderer/src/features/library/page/use-section-guard'
import { adultRedirect } from '../../../src/renderer/src/router/adult-guard'
import { routes } from '../../../src/renderer/src/router/routers'

interface Lib {
  id: number
  kind: 'movie' | 'tv'
  source?: 'tmdb' | 'jav'
}
const lib = (id: number, kind: Lib['kind'], source?: Lib['source']): Lib => ({
  id,
  kind,
  source,
})

describe('片库分区', () => {
  it('粗分区：番号库归番号，其余按条目类型分电影 / 剧集', () => {
    const mixed = { ...lib(1, 'movie', 'tmdb'), mixed: true }
    expect(sectionOf(mixed, 'movie')).toBe('movie')
    expect(sectionOf(mixed, 'series')).toBe('tv')
    expect(sectionOf(lib(1, 'movie', 'jav'))).toBe('jav')
    expect(sectionOf(lib(3, 'movie'))).toBe('movie')
    expect(sectionOf(lib(4, 'tv', 'tmdb'))).toBe('tv')
    expect(SECTIONS.jav).toMatchObject({ types: ['movie'], source: 'jav' })
  })

  it('条目所在页面：先看内容类别，普通类再按类型；番号库不看类别', () => {
    const tmdb = lib(1, 'movie', 'tmdb')
    const page = (type: 'movie' | 'series', genres: string[]): string =>
      pageOf(tmdb, { type, genres })
    // 与追更的剧分类同一优先级：纪录片 > 综艺 > 动漫
    expect(page('series', ['动画', '真人秀'])).toBe('variety')
    expect(page('series', ['动画', '纪录'])).toBe('documentary')
    expect(page('movie', ['Animation'])).toBe('anime')
    expect(page('series', ['真人秀'])).toBe('variety')
    expect(page('movie', ['纪录'])).toBe('documentary')
    expect(page('series', ['剧情'])).toBe('tv')
    expect(page('movie', [])).toBe('movie')
    // 类型名认不出（日文元数据）时按 TMDB 类型 id
    expect(
      pageOf(tmdb, {
        type: 'series',
        genres: ['アニメーション'],
        metadata: { level: 'title', genreIds: [16] } as never,
      })
    ).toBe('anime')
    expect(
      pageOf(lib(2, 'movie', 'jav'), { type: 'movie', genres: ['动画'] })
    ).toBe('jav')
  })

  it('番号页只含番号库；其他页面是全部普通片库（文件夹共用）', () => {
    const all = [lib(1, 'movie', 'tmdb'), lib(2, 'movie', 'jav'), lib(3, 'tv')]
    expect(librariesIn(all, 'jav').map(l => l.id)).toEqual([2])
    for (const section of ['movie', 'tv', 'anime'] as const)
      expect(librariesIn(all, section).map(l => l.id)).toEqual([1, 3])
  })

  it('继续播放 / 想看：电影、剧集、番号页各看自己的；动漫等页面没有横排，看过的记录电影剧集都算', () => {
    expect(baseSectionOf('tv')).toBe('tv')
    expect(baseSectionOf('anime')).toBeNull()
    expect(recordSectionsOf('jav')).toEqual(['jav'])
    expect(recordSectionsOf('documentary')).toEqual(['movie', 'tv'])
  })

  it('新加的文件夹：番号页加番号库，其他页面一律加自动识别的混合库', () => {
    expect(newLibraryShape('tv')).toEqual({
      kind: 'movie',
      source: 'tmdb',
      mixed: true,
    })
    expect(newLibraryShape('jav')).toEqual({
      kind: 'movie',
      source: 'jav',
      mixed: false,
    })
  })
})

describe('侧栏本地媒体', () => {
  type Counts = NonNullable<Parameters<typeof localNavPages>[0]['counts']>
  const counts = (patch: Partial<Counts> = {}): Counts => ({
    movie: 0,
    tv: 0,
    anime: 0,
    variety: 0,
    documentary: 0,
    ...patch,
  })
  const paths = (state: Parameters<typeof localNavPages>[0]): string[] =>
    localNavPages(state).map(p => p.path)

  it('有条目的页面才显示，电影、剧集与动漫等同一规则', () => {
    expect(
      paths({ counts: counts({ tv: 3, anime: 1 }), hasLibraries: true })
    ).toEqual(['/tv', '/anime'])
  })

  it('一个都没有时只留一个入口：没文件夹是「添加媒体库」，有文件夹（还在扫描）是「媒体库」', () => {
    expect(localNavPages({ counts: counts(), hasLibraries: false })).toEqual([
      expect.objectContaining({ label: '添加媒体库', path: '/movie' }),
    ])
    const [entry] = localNavPages({ counts: counts(), hasLibraries: true })
    expect(entry.label).toBe('媒体库')
    // 只剩一个入口时它代表全部片库页面：停在剧集、动漫等页面时也高亮
    expect(entry.routeNames).toEqual([
      'Movie',
      'TV',
      'Anime',
      'Variety',
      'Documentary',
    ])
  })

  it('数量还没查回来时先显示电影、剧集，启动时入口不闪', () => {
    expect(paths({ counts: null, hasLibraries: false })).toEqual([
      '/movie',
      '/tv',
    ])
  })
})

describe('页面规则', () => {
  it('页头切换只有资料库 / 演员，演员只在番号页；待确认不是切换项', () => {
    expect(viewOptionsFor('movie').map(o => o.value)).toEqual(['wall'])
    expect(viewOptionsFor('jav').map(o => o.label)).toEqual(['资料库', '演员'])
  })

  it('页头按钮：扫描、识别，海报墙上再有按画面搜（番号页）与视频墙；没有设置', () => {
    const ctx = { view: 'wall' as const, hasLibraries: true, count: 5 }
    expect(toolbarActions({ ...ctx, facets: true })).toEqual([
      'scan',
      'identify',
      'visual',
      'video-wall',
    ])
    expect(toolbarActions({ ...ctx, facets: false })).toEqual([
      'scan',
      'identify',
      'video-wall',
    ])
    expect(
      toolbarActions({ ...ctx, hasLibraries: false, facets: false })
    ).toEqual([])
    expect(toolbarActions({ ...ctx, view: 'review', facets: true })).toEqual([
      'scan',
      'identify',
    ])
  })

  it('番号页空状态引导添加番号文件夹', () => {
    expect(noFolderCopy('jav').title).toBe('添加你的番号文件夹')
    expect(noFolderCopy('jav').text).toContain('番号')
    expect(noFolderCopy('movie').title).toBe('添加你的影片文件夹')
    expect(noFolderCopy('anime').title).toBe('添加你的影片文件夹')
  })
})

describe('跨分区链接', () => {
  it('条目属于本页才显示；旧链接里的番号条目换到番号页', () => {
    expect(guardStep('movie', 'movie')).toEqual({ kind: 'stay' })
    expect(guardStep('movie', 'jav')).toEqual({ kind: 'move', to: 'jav' })
    expect(guardStep('jav', 'movie')).toEqual({ kind: 'move', to: 'movie' })
    // 首页 / 继续播放只知道电影 / 剧集：动漫条目从剧集页换到动漫页
    expect(guardStep('tv', 'anime')).toEqual({ kind: 'move', to: 'anime' })
    // 条目不存在：留在本页由详情显示“找不到”；查不到归属：不显示
    expect(guardStep('movie', 'missing')).toEqual({ kind: 'stay' })
    expect(guardStep('movie', 'unknown')).toEqual({ kind: 'hide' })
  })
})

describe('成人页面路由守卫', () => {
  const route = (name: string): (typeof routes)[number] =>
    routes.find(r => r.name === name)!

  it('/jav 与 /av 标记为成人页面，电影 / 剧集不是', () => {
    expect(route('Jav')).toMatchObject({ path: '/jav' })
    expect(route('Jav').meta?.adultOnly).toBe(true)
    expect(route('AV').meta?.adultOnly).toBe(true)
    expect(route('Movie').meta).not.toHaveProperty('adultOnly')
    for (const [name, path] of [
      ['Anime', '/anime'],
      ['Variety', '/variety'],
      ['Documentary', '/documentary'],
    ]) {
      expect(route(name)).toMatchObject({ path })
      expect(route(name).meta).not.toHaveProperty('adultOnly')
    }
  })

  it('成人模式关闭时成人页面回首页，开启时放行', () => {
    expect(adultRedirect(route('Jav'), false)).toBe('/')
    expect(adultRedirect(route('Jav'), true)).toBeNull()
    expect(adultRedirect(route('Movie'), false)).toBeNull()
  })
})

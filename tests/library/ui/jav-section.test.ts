/**
 * 番号库独立成页：分区归属、视图与空状态文案、跨分区链接换页、成人页面路由守卫。
 */
import { describe, expect, it } from 'vitest'

import {
  SECTIONS,
  librariesIn,
  sectionOf,
} from '../../../src/renderer/src/features/library/state/library-section'
import {
  noFolderCopy,
  toolbarActions,
  viewOptionsFor,
} from '../../../src/renderer/src/features/library/page/page-rules'
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
  it('混合库属于电影和剧集页面，具体条目按类型跳转', () => {
    const mixed = { ...lib(1, 'movie', 'tmdb'), mixed: true }
    expect(librariesIn([mixed], 'movie')).toEqual([mixed])
    expect(librariesIn([mixed], 'tv')).toEqual([mixed])
    expect(librariesIn([mixed], 'jav')).toEqual([])
    expect(sectionOf(mixed, 'movie')).toBe('movie')
    expect(sectionOf(mixed, 'series')).toBe('tv')
  })
  it('番号库 = movie + jav；电影 = movie + tmdb；剧集 = tv', () => {
    expect(sectionOf(lib(1, 'movie', 'jav'))).toBe('jav')
    expect(sectionOf(lib(2, 'movie', 'tmdb'))).toBe('movie')
    expect(sectionOf(lib(3, 'movie'))).toBe('movie')
    expect(sectionOf(lib(4, 'tv', 'tmdb'))).toBe('tv')
    expect(SECTIONS.jav).toMatchObject({ kind: 'movie', source: 'jav' })
  })

  it('电影页的库列表不含番号库，番号页只含番号库', () => {
    const all = [lib(1, 'movie', 'tmdb'), lib(2, 'movie', 'jav'), lib(3, 'tv')]
    expect(librariesIn(all, 'movie').map(l => l.id)).toEqual([1])
    expect(librariesIn(all, 'jav').map(l => l.id)).toEqual([2])
    expect(librariesIn(all, 'tv').map(l => l.id)).toEqual([3])
  })
})

describe('页面规则', () => {
  it('页头切换只有资料库 / 演员，演员只在番号页；待确认不是切换项', () => {
    expect(viewOptionsFor('movie').map(o => o.value)).toEqual(['wall'])
    expect(viewOptionsFor('jav').map(o => o.label)).toEqual(['资料库', '演员'])
  })

  it('工具栏：页头只留排序 / 筛选，扫描、识别、按画面、视频墙、设置收进「⋯」', () => {
    const jav = toolbarActions({
      view: 'wall',
      hasLibraries: true,
      count: 5,
      facets: true,
    })
    expect(jav.inline).toEqual(['sort', 'facets'])
    expect(jav.more).toEqual([
      'scan',
      'identify',
      'visual',
      'video-wall',
      'settings',
    ])
    const movie = toolbarActions({
      view: 'wall',
      hasLibraries: true,
      count: 5,
      facets: false,
    })
    expect(movie.inline).toEqual(['sort'])
    expect(movie.more).toEqual(['scan', 'identify', 'video-wall', 'settings'])
    const empty = toolbarActions({
      view: 'wall',
      hasLibraries: false,
      count: null,
      facets: false,
    })
    expect(empty).toEqual({ inline: [], more: ['settings'] })
    const review = toolbarActions({
      view: 'review',
      hasLibraries: true,
      count: 5,
      facets: true,
    })
    expect(review.inline).toEqual([])
    expect(review.more).toEqual(['scan', 'identify', 'settings'])
  })

  it('番号页空状态引导添加番号文件夹', () => {
    expect(noFolderCopy('jav').title).toBe('添加你的番号文件夹')
    expect(noFolderCopy('jav').text).toContain('番号')
    expect(noFolderCopy('movie').title).toBe('添加你的电影文件夹')
  })
})

describe('跨分区链接', () => {
  it('条目属于本页才显示；旧链接里的番号条目换到番号页', () => {
    expect(guardStep('movie', 'movie')).toEqual({ kind: 'stay' })
    expect(guardStep('movie', 'jav')).toEqual({ kind: 'move', to: 'jav' })
    expect(guardStep('jav', 'movie')).toEqual({ kind: 'move', to: 'movie' })
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
  })

  it('成人模式关闭时成人页面回首页，开启时放行', () => {
    expect(adultRedirect(route('Jav'), false)).toBe('/')
    expect(adultRedirect(route('Jav'), true)).toBeNull()
    expect(adultRedirect(route('Movie'), false)).toBeNull()
  })
})

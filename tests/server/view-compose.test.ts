import { describe, expect, it } from 'vitest'

import { composeHome } from '../../src/server/view/compose'
import { resumeView } from '../../src/server/view/resume'
import type { ContinueRecord } from '../../src/shared/playback/continue-rules'
import type { HomeFeed, ViewCard } from '../../src/shared/view/home'

const card = (id: string, backdrop: string | null): ViewCard => ({
  id,
  title: `片${id}`,
  searchTitle: `片${id}`,
  year: '2026',
  rate: '7.5',
  kind: 'movie',
  poster: `/media/thumb?w=480&src=p${id}`,
  backdrop,
  overview: '简介',
  doubanUrl: `https://movie.douban.com/subject/${id}/`,
})

const feed = (items: ViewCard[]): HomeFeed => ({
  hotMovies: { title: '热门电影', kind: 'movie', items },
  hotTv: null,
  chart: null,
  genres: [],
  collections: [],
})

const record = (over: Partial<ContinueRecord> = {}): ContinueRecord => ({
  section: 'online',
  key: 'site:1',
  id: 'online:site:1',
  title: '在看的剧',
  cover: 'https://img.example.com/still.jpg',
  replay: { url: 'https://v.example.com/1.m3u8' },
  episode: '第 14 集',
  progress: 600,
  duration: 1500,
  updatedAt: 0,
  ...over,
})

describe('首页的轮播与继续观看（ADR-0031）', () => {
  it('有继续观看时轮播第一张是它，文案与桌面相同，后面接热门', () => {
    const home = composeHome(
      feed([card('1', '/b1'), card('2', null)]),
      [record()],
      [],
      60_000
    )
    expect(home.hero.map(s => s.kind)).toEqual(['resume', 'douban', 'douban'])
    expect(home.hero[0]).toMatchObject({
      kicker: '在线 · 第 14 集 · 看到 40%',
      playLabel: '继续播放 · 剩 15 分钟',
      continueId: 'online:site:1',
    })
    expect(home.hero[2]).toMatchObject({
      image: '/media/thumb?w=480&src=p2',
      imageIsPoster: true,
      meta: '2026 年 · 电影',
      cardId: '2',
    })
  })

  it('继续观看行给出副标题、进度和封面缩略图', () => {
    const home = composeHome(feed([]), [record()], [], 60_000)
    expect(home.continueRow).toEqual([
      {
        id: 'online:site:1',
        section: 'online',
        title: '在看的剧',
        subtitle: '第 14 集',
        foot: '剩余 15 分钟',
        image: `/media/thumb?w=780&src=${encodeURIComponent('https://img.example.com/still.jpg')}`,
        poster: null,
        progress: 0.4,
      },
    ])
  })

  it('没有播放记录时只有热门轮播，继续观看行为空', () => {
    const home = composeHome(feed([card('1', '/b1')]), [], [], 0)
    expect(home.hero.map(s => s.kind)).toEqual(['douban'])
    expect(home.continueRow).toEqual([])
  })

  it('不在首页板块里的记录（AV）不进首页', () => {
    const home = composeHome(
      feed([]),
      [record({ section: 'av', id: 'av:x', key: 'x' })],
      [],
      0
    )
    expect(home.continueRow).toEqual([])
    expect(home.hero).toEqual([])
  })

  it('最新那条封面做不了缩略图时，轮播用更早、有图的那条', () => {
    const home = composeHome(
      feed([]),
      [
        record({
          id: 'online:new',
          key: 'new',
          cover: 'data:image/png;base64,AA',
          updatedAt: 2,
        }),
        record({ id: 'online:old', key: 'old', updatedAt: 1 }),
      ],
      [],
      0
    )
    expect(home.hero[0]?.continueId).toBe('online:old')
  })
})

describe('续播信息（view.resume）', () => {
  it('记录里的播放列表换成剧集，带上下标、起始秒数和豆瓣身份', () => {
    const r = resumeView(
      record({
        replay: {
          playlist: [
            { url: 'u1', name: '第 1 集' },
            { url: 'u2', name: '第 2 集', siteName: '插件甲', ext: { id: 7 } },
          ],
          index: 1,
        },
        progress: 300,
        detail: { doubanId: '123', kind: 'tv' },
      })
    )
    expect(r).toMatchObject({
      continueId: 'online:site:1',
      index: 1,
      startAt: 300,
      doubanId: '123',
      kind: 'tv',
    })
    expect(r?.episodes[1]).toEqual({
      name: '第 2 集',
      url: 'u2',
      siteName: '插件甲',
      ext: '{"id":7}',
    })
  })

  it('「下一集」从头播；只有单个地址的记录也能续播；什么都没有为 null', () => {
    expect(resumeView(record({ nextUp: true }))?.startAt).toBe(0)
    expect(resumeView(record())?.episodes).toEqual([
      {
        name: '第 14 集',
        url: 'https://v.example.com/1.m3u8',
        siteName: null,
        ext: null,
      },
    ])
    expect(resumeView(record({ replay: {} }))).toBeNull()
  })

  it('播放列表里没有地址的条目也保留，下标不错位', () => {
    const r = resumeView(
      record({
        replay: {
          playlist: [{ name: '预告' }, { url: 'u2', name: '第 1 集' }],
          index: 1,
        },
      })
    )
    expect(r?.episodes[r.index]).toMatchObject({ url: 'u2', name: '第 1 集' })
    expect(r?.episodes[0].url).toBe('')
  })
})

describe('首页的收藏行', () => {
  it('收藏的豆瓣卡换成视图卡，海报走缩略图', () => {
    const home = composeHome(
      feed([]),
      [],
      [
        {
          title: '收藏的片',
          searchTitle: '收藏的片',
          original_title: '',
          cover: 'https://img1.doubanio.com/f.jpg',
          coverSrc: 'https://img1.doubanio.com/f.jpg',
          rate: '8.2',
          url: 'https://movie.douban.com/subject/42/',
          year: '2025',
          type: '剧集',
          overview: '',
          kind: 'tv',
        },
      ],
      0
    )
    expect(home.favorites).toEqual([
      expect.objectContaining({ id: '42', kind: 'tv', rate: '8.2' }),
    ])
    expect(home.favorites[0].poster).toMatch(/^\/media\/thumb\?w=480&src=/)
  })
})

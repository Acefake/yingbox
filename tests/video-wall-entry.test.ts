import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it, vi } from 'vitest'

import type {
  LibraryItemNode,
  LibraryItemSummary,
  LibraryQuery,
} from '../src/shared/library/ipc'
import {
  WALL_POOL_LIMIT,
  wallPool,
} from '../src/renderer/src/features/library/video-wall/wall-pool'
import { primaryPlayRequest } from '../src/renderer/src/features/library/detail/playback'

// 播放入口（播放器窗口 / 页内播放器）与这里的纯规则无关
vi.mock('../src/renderer/src/features/player', () => ({
  openMediaPlayer: vi.fn(),
}))
vi.mock('../src/renderer/src/features/library/detail/web-player', () => ({
  openWebPlayer: vi.fn(),
}))

/**
 * 视频墙的入口：影片从哪来（有选中项用选中项，否则当前筛选结果的前 WALL_POOL_LIMIT 部）、
 * 工具栏按钮、「播放」用的主播放请求（与详情页的「播放」同一条规则）。
 */

const summary = (id: number): LibraryItemSummary =>
  ({ id, title: `t${id}` }) as LibraryItemSummary

describe('wallPool', () => {
  const list = {
    at: (i: number) => (i < 50 ? summary(i + 100) : undefined),
    indexOfId: (id: number) => (id >= 100 && id < 150 ? id - 100 : -1),
  }
  const query: LibraryQuery = { source: 'tmdb', sort: 'title', search: 'x' }

  it('有选中项：只用选中的（按选中顺序，跳过没加载的）', async () => {
    const fetch = vi.fn()
    const items = await wallPool({
      selection: new Set([103, 999, 101]),
      list,
      query,
      fetch,
    })
    expect(items.map(i => i.id)).toEqual([103, 101])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('没有选中项：按当前筛选条件取前 WALL_POOL_LIMIT 部', async () => {
    const fetch = vi.fn(async (q: LibraryQuery) => ({
      items: [summary(1), summary(2)],
      total: 2,
      offset: q.offset ?? 0,
      limit: q.limit ?? 0,
    }))
    const items = await wallPool({ selection: new Set(), list, query, fetch })
    expect(fetch).toHaveBeenCalledWith({
      ...query,
      offset: 0,
      limit: WALL_POOL_LIMIT,
    })
    expect(items.map(i => i.id)).toEqual([1, 2])
  })
})

describe('primaryPlayRequest', () => {
  const file = (id: number, path: string): object => ({
    id,
    path,
    kind: 'video',
  })
  const node = (over: Partial<LibraryItemNode>): LibraryItemNode =>
    ({
      id: 1,
      type: 'movie',
      title: '电影',
      files: [],
      children: [],
      seasonNumber: null,
      episodeNumber: null,
      ...over,
    }) as LibraryItemNode

  it('电影：全部视频文件连播', () => {
    const r = primaryPlayRequest(
      node({ files: [file(2, '/b.mkv'), file(1, '/a.mkv')] as never })
    )
    expect(r?.playlist.map(p => p.filePath)).toEqual(['/a.mkv', '/b.mkv'])
  })

  it('剧集：第一个有文件的季的第一集（特别篇排最后）', () => {
    const ep = (id: number, s: number, e: number): LibraryItemNode =>
      node({
        id,
        type: 'episode',
        title: `e${e}`,
        seasonNumber: s,
        episodeNumber: e,
        files: [file(id, `/s${s}e${e}.mkv`)] as never,
      })
    const season = (s: number, eps: LibraryItemNode[]): LibraryItemNode =>
      node({ id: 50 + s, type: 'season', seasonNumber: s, children: eps })
    const r = primaryPlayRequest(
      node({
        type: 'series',
        title: '剧',
        children: [
          season(0, [ep(9, 0, 1)]),
          season(1, [ep(11, 1, 2), ep(10, 1, 1)]),
        ],
      })
    )
    expect(r?.playlist[r.index].filePath).toBe('/s1e1.mkv')
  })

  it('没有文件：null', () => {
    expect(primaryPlayRequest(node({}))).toBeNull()
  })
})

describe('工具栏入口', () => {
  async function render(props: Record<string, unknown>): Promise<string> {
    const { default: LibraryToolbar } =
      await import('../src/renderer/src/features/library/page/LibraryToolbar.vue')
    return renderToString(
      createSSRApp({
        render: () =>
          h(LibraryToolbar, {
            kindLabel: '电影',
            count: 12,
            hasLibraries: true,
            viewOptions: [],
            libraryOptions: [],
            sort: 'title',
            order: 'asc',
            view: 'wall',
            search: '',
            filter: 'all',
            library: 0,
            ...props,
          }),
      })
    )
  }

  it('海报墙有条目时显示「视频墙」', async () => {
    expect(await render({})).toContain('aria-label="视频墙"')
  })

  it('没有条目或不在海报墙视图时不显示', async () => {
    expect(await render({ count: 0 })).not.toContain('视频墙')
    expect(await render({ view: 'review' })).not.toContain('视频墙')
  })
})

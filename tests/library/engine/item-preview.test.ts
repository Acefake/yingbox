import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildItemPreview,
  createItemPreviews,
  isNetworkPath,
} from '../../../src/main/library/catalog/item-preview'
import { handleRpc } from '../../../src/main/library/engine/rpc'
import { LibraryService } from '../../../src/main/library/engine/service'
import {
  LIBRARY_METHODS,
  type LibraryItemNode,
  parseRpcParams,
} from '../../../src/shared/library/ipc'
import { serveLocalMedia } from '../../../src/main/local-media'
import { toLocalUrl } from '../../../src/renderer/src/utils/local-url'
import { tempTree } from './helpers'

/**
 * 海报墙悬停预览的数据：本机可靠磁盘上给第一个视频文件（渲染层从片中 10% 处播几秒），
 * 网盘 / 网络路径（UNC，或 fs-type 判定为事件不可靠的 nfs / cifs / fuse …）只给已缓存的图片，不拉视频。
 */

const img = (n: number): string =>
  `yingbox-media://image/${n.toString(16).padStart(32, '0')}`

function node(over: Partial<LibraryItemNode>): LibraryItemNode {
  return {
    id: 1,
    libraryId: 1,
    type: 'movie',
    title: 't',
    originalTitle: null,
    year: null,
    matchState: 'auto',
    providerIds: {},
    poster: null,
    backdrop: null,
    rating: null,
    addedAt: 0,
    updatedAt: 0,
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
    ...over,
  }
}

const file = (
  id: number,
  path: string,
  kind: 'video' | 'nfo' = 'video'
): LibraryItemNode['files'][number] => ({
  id,
  path,
  kind,
  size: 1,
  mtime: 0,
})

describe('isNetworkPath', () => {
  it.each([
    ['\\\\nas\\movies\\a.mkv', true],
    ['//nas/movies/a.mkv', true],
    ['D:\\Movies\\a.mkv', false],
    ['/mnt/media/a.mkv', false],
  ])('%s → %s', (path, expected) => {
    expect(isNetworkPath(path)).toBe(expected)
  })
})

describe('buildItemPreview', () => {
  it('电影：本地给按路径排序的第一个视频文件；图片只取已缓存的、不含海报', () => {
    const movie = node({
      poster: img(1),
      backdrop: img(2),
      files: [
        file(11, '/m/Film/CD2.mkv'),
        file(10, '/m/Film/CD1.mkv'),
        file(12, '/m/Film/movie.nfo', 'nfo'),
      ],
    })
    expect(buildItemPreview(movie, false)).toEqual({
      video: { fileId: 10, path: '/m/Film/CD1.mkv' },
      images: [img(2)],
    })
  })

  it('网络路径：不给视频，只给图片', () => {
    const movie = node({
      backdrop: img(2),
      files: [file(10, '/m/a.mkv')],
    })
    expect(buildItemPreview(movie, true)).toEqual({
      video: null,
      images: [img(2)],
    })
  })

  it('剧集：第一季第一集（特别篇排最后）；图片含季 / 集的缓存图，远程地址不算，去重、最多 8 张', () => {
    const ep = (
      id: number,
      s: number,
      e: number,
      still: string | null
    ): LibraryItemNode =>
      node({
        id,
        type: 'episode',
        seasonNumber: s,
        episodeNumber: e,
        backdrop: still,
        files: [file(id * 10, `/tv/S${s}E${e}.mkv`)],
      })
    const series = node({
      type: 'series',
      poster: img(1),
      backdrop: img(2),
      children: [
        node({
          id: 100,
          type: 'season',
          seasonNumber: 0,
          // 季海报与剧集海报相同（缓存 key 一样）：仍算海报，不放进轮播
          poster: img(1),
          children: [ep(101, 0, 1, img(31))],
        }),
        node({
          id: 200,
          type: 'season',
          seasonNumber: 1,
          poster: 'https://image.tmdb.org/t/p/w500/x.jpg',
          children: [
            ep(202, 1, 2, img(42)),
            ep(201, 1, 1, img(41)),
            ...Array.from({ length: 10 }, (_, i) =>
              ep(210 + i, 1, 3 + i, img(2))
            ),
          ],
        }),
      ],
    })
    const preview = buildItemPreview(series, false)
    expect(preview.video).toEqual({ fileId: 2010, path: '/tv/S1E1.mkv' })
    expect(preview.images[0]).toBe(img(2))
    expect(preview.images).toContain(img(41))
    expect(preview.images).not.toContain(img(1))
    expect(preview.images.some(u => u.startsWith('https:'))).toBe(false)
    expect(new Set(preview.images).size).toBe(preview.images.length)
    expect(preview.images.length).toBeLessThanOrEqual(8)
  })

  it('没有视频文件：video 为 null', () => {
    expect(buildItemPreview(node({}), false).video).toBeNull()
  })
})

describe('createItemPreviews', () => {
  const movie = node({
    id: 7,
    libraryId: 3,
    backdrop: img(2),
    files: [file(10, '/mnt/nas/a.mkv')],
  })

  it('库根目录在不可靠文件系统上（fs-type）：只给图片；判定按根目录缓存', async () => {
    const detectFs = vi.fn(async () => 'cifs')
    const previews = createItemPreviews({
      getItem: id => (id === 7 ? movie : null),
      libraryRoot: id => (id === 3 ? '/mnt/nas' : undefined),
      detectFs,
    })
    expect(await previews.get(7)).toEqual({ video: null, images: [img(2)] })
    await previews.get(7)
    expect(detectFs).toHaveBeenCalledTimes(1)
    expect(detectFs).toHaveBeenCalledWith('/mnt/nas')
    expect(await previews.get(8)).toBeNull()
  })

  it('UNC 根目录不查 fs-type 也算网络；可靠磁盘给视频', async () => {
    const detectFs = vi.fn(async () => undefined)
    const unc = createItemPreviews({
      getItem: () => movie,
      libraryRoot: () => '\\\\nas\\movies',
      detectFs,
    })
    expect((await unc.get(7))?.video).toBeNull()
    expect(detectFs).not.toHaveBeenCalled()

    const local = createItemPreviews({
      getItem: () => movie,
      libraryRoot: () => '/mnt/local',
      detectFs,
    })
    expect((await local.get(7))?.video).toEqual({
      fileId: 10,
      path: '/mnt/nas/a.mkv',
    })
  })
})

describe('RPC getPreview', () => {
  let tree: ReturnType<typeof tempTree>
  let service: LibraryService
  beforeEach(async () => {
    tree = tempTree()
    service = new LibraryService({ dbPath: ':memory:', watch: false })
    await service.start()
  })
  afterEach(async () => {
    await service.close()
    tree.cleanup()
  })

  it('白名单里有、参数按 itemId 校验；真服务上返回本地视频', async () => {
    expect(LIBRARY_METHODS).toContain('getPreview')
    expect(() => parseRpcParams('getPreview', { itemId: 'x' })).toThrow()
    const path = tree.write('Alien (1979)/Alien (1979).mkv')
    await handleRpc(service, {
      method: 'addLibrary',
      params: { root: tree.root, kind: 'movie' },
    })
    await service.queue.idle()
    const page = await handleRpc(service, { method: 'query', params: {} })
    if (!page.ok) throw new Error('query 失败')
    const [item] = (page.result as { items: Array<{ id: number }> }).items
    const res = await handleRpc(service, {
      method: 'getPreview',
      params: { itemId: item.id },
    })
    expect(res).toMatchObject({
      ok: true,
      result: { video: { path }, images: [] },
    })
    expect(
      await handleRpc(service, {
        method: 'getPreview',
        params: { itemId: 999 },
      })
    ).toEqual({ ok: true, result: null })
  })
})

describe('本地片段的取流', () => {
  it('渲染层用的 local:// 地址（toLocalUrl）能按 Range 从中间读（206），从 10% 处起播不读整个文件', async () => {
    const tree = tempTree()
    try {
      const path = tree.write('Film (2020)/影片 1.mp4', Buffer.alloc(1000, 7))
      const res = await serveLocalMedia(
        new Request(toLocalUrl(path), { headers: { Range: 'bytes=100-199' } })
      )
      expect(res.status).toBe(206)
      expect(res.headers.get('Content-Range')).toBe('bytes 100-199/1000')
      expect(res.headers.get('Content-Type')).toBe('video/mp4')
      expect((await res.arrayBuffer()).byteLength).toBe(100)
    } finally {
      tree.cleanup()
    }
  })
})

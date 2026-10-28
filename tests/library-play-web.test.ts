import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PlayRequest } from '../src/renderer/src/features/library/detail/playback'

/**
 * 媒体库「播放」：桌面与网页走同一个播放入口（openMediaPlayer → 应用内播放弹窗）。
 * 桌面端给本地文件路径，网页端给片库服务的 Range 流地址，连播列表与起始集一一对应。
 */

const openMediaPlayer = vi.fn(async () => true)
let server = false

vi.mock('../src/renderer/src/features/player', () => ({ openMediaPlayer }))
vi.mock('../src/renderer/src/features/library/api/bridge', () => ({
  usesLibraryServer: () => server,
  libraryBridge: () => null,
}))
vi.mock('../src/renderer/src/features/autograb', () => ({
  autograbAvailable: false,
}))
vi.mock('../src/renderer/src/services/library-server', () => ({
  serverFileUrl: (id: number) => `https://nas.local/media/files/${id}`,
}))
vi.mock('../src/renderer/src/features/library/api/images', () => ({
  itemImage: (url: string | null) => url,
}))
vi.mock('../src/renderer/src/features/library/state/use-libraries', () => ({
  findLibrary: () => ({ id: 3, kind: 'tv', source: 'tmdb' }),
}))

/** 记进「继续播放」：剧集分区、按剧的 id、封面优先背景图 */
const continueAs = {
  section: 'tv',
  key: '7',
  title: '剧',
  cover: 'b.jpg',
  detail: { itemId: 7 },
}

const request: PlayRequest = {
  title: '剧 S01E02',
  playlist: [
    { filePath: '/m/e1.mkv', name: 'S01E01' },
    { filePath: '/m/e2.mkv', name: 'S01E02' },
  ],
  fileIds: [11, 12],
  refs: [
    { itemId: 71, fileId: 11 },
    { itemId: 72, fileId: 12 },
  ],
  index: 1,
  item: {
    id: 7,
    libraryId: 3,
    type: 'series',
    title: '剧',
    backdrop: 'b.jpg',
    poster: 'p.jpg',
    files: [],
    children: [],
  } as unknown as PlayRequest['item'],
}

beforeEach(() => openMediaPlayer.mockClear())

describe('媒体库播放入口', () => {
  it('桌面端：本地文件路径交给 openMediaPlayer', async () => {
    server = false
    const { play } =
      await import('../src/renderer/src/features/library/detail/playback')
    expect(await play(request, 'p.jpg')).toBe(true)
    expect(openMediaPlayer).toHaveBeenCalledWith({
      filePath: '/m/e2.mkv',
      title: '剧 S01E02',
      poster: 'p.jpg',
      // 每一项带媒体库标记：进度只记进片库
      playlist: [
        { filePath: '/m/e1.mkv', name: 'S01E01', library: request.refs[0] },
        { filePath: '/m/e2.mkv', name: 'S01E02', library: request.refs[1] },
      ],
      index: 1,
      continueAs,
    })
  })

  it('网页端：同一个入口，地址换成片库服务的流', async () => {
    server = true
    const { play } =
      await import('../src/renderer/src/features/library/detail/playback')
    expect(await play(request)).toBe(true)
    expect(openMediaPlayer).toHaveBeenCalledWith({
      url: 'https://nas.local/media/files/12',
      title: '剧 S01E02',
      poster: undefined,
      playlist: [
        {
          url: 'https://nas.local/media/files/11',
          name: 'S01E01',
          library: request.refs[0],
        },
        {
          url: 'https://nas.local/media/files/12',
          name: 'S01E02',
          library: request.refs[1],
        },
      ],
      index: 1,
      continueAs,
    })
  })
})

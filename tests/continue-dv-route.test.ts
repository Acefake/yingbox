import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakes = vi.hoisted(() => ({
  openMpv: vi.fn(async () => ({ success: true })),
  openPlayer: vi.fn(),
}))

vi.mock('@/components/ui', () => ({
  toast: { info: vi.fn(), warning: vi.fn() },
}))
vi.mock('@/features/settings', () => ({
  getSetting: (key: string) =>
    key === 'player.engine' ? 'built-in' : key === 'player.dvAutoMpv',
}))
vi.mock('../src/renderer/src/features/player/host/player-host', () => ({
  openPlayer: fakes.openPlayer,
}))
vi.mock('../src/renderer/src/features/player/continue/continue-store', () => ({
  startContinue: () => 'movie:1',
}))
vi.mock('../src/renderer/src/features/player/mpv-session/mpv-session', () => ({
  trackMpvSession: vi.fn(),
}))
vi.mock('../src/renderer/src/features/player/anime4k/anime4k-sync', () => ({
  syncAnime4k: vi.fn(),
}))

import { openMediaPlayer } from '../src/renderer/src/features/player/composables/use-media-player'
import {
  type ContinueRecord,
  replayOptions,
} from '../src/renderer/src/features/player/continue/continue-rules'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', { api: { mpv: { open: fakes.openMpv } } })
})

describe('继续播放的杜比视界路由', () => {
  it('按当前文件的信息选择 mpv，保留续播时间和列表位置', async () => {
    const record: ContinueRecord = {
      id: 'movie:1',
      section: 'movie',
      key: '1',
      title: '电影',
      progress: 120,
      duration: 600,
      updatedAt: 1,
      replay: {
        index: 1,
        playlist: [
          {
            filePath: 'first.mkv',
            video: { range: 'sdr', dvProfile: null, dvCompat: null },
          },
          {
            filePath: 'second.mkv',
            video: { range: 'dv', dvProfile: 5, dvCompat: 0 },
          },
        ],
      },
    }

    await openMediaPlayer(replayOptions(record))

    expect(fakes.openMpv).toHaveBeenCalledWith(
      expect.objectContaining({ index: 1, startAt: 120 })
    )
    expect(fakes.openPlayer).not.toHaveBeenCalled()
  })

  it('当前文件不是 P5 时不沿用其他文件的 P5 信息', async () => {
    await openMediaPlayer({
      playlist: [
        {
          filePath: 'first.mkv',
          video: { range: 'dv', dvProfile: 5, dvCompat: 0 },
        },
        {
          filePath: 'second.mkv',
          video: { range: 'sdr', dvProfile: null, dvCompat: null },
        },
      ],
      index: 1,
      video: { range: 'dv', dvProfile: 5, dvCompat: 0 },
    })

    expect(fakes.openMpv).not.toHaveBeenCalled()
    expect(fakes.openPlayer).toHaveBeenCalledOnce()
  })
})

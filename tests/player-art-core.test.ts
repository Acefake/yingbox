/**
 * art-core 的 loadedmetadata：只有网页端解不了画面时才报错；其余照常跳续播位置并转发事件。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (event?: unknown) => void>()
const video = { videoWidth: 1920, videoHeight: 1080, pause: vi.fn() }
let web = false

vi.mock('artplayer', () => {
  class FakeArt {
    static PLAYBACK_RATE: number[] = []
    video = video
    on(name: string, fn: (event?: unknown) => void): void {
      handlers.set(name, fn)
    }
  }
  return { default: FakeArt }
})
vi.mock('@/features/settings', () => ({
  getSetting: () => 1,
  setSetting: async () => {},
}))
vi.mock('@/services/library-server', () => ({ isWebRuntime: () => web }))
vi.mock('@/services/library-server/engine', () => ({
  webPlayableUrl: (url: string) => url,
}))
vi.mock(
  '../src/renderer/src/features/player/playback-info/playback-info',
  () => ({
    installPlaybackInfo: () => {},
  })
)
vi.mock('../src/renderer/src/features/player/sleep/sleep-timer', () => ({
  installSleepTimer: () => {},
}))
vi.mock('../src/renderer/src/features/player/screenshot/screenshot', () => ({
  installScreenshot: () => {},
}))
vi.mock('../src/renderer/src/features/player/utils/art-skin', () => ({
  artSkinControls: () => [],
  installQualityBadge: () => {},
}))
vi.mock('../src/renderer/src/features/player/utils/art-options', () => ({
  applyPlaybackRate: () => {},
  artOptions: (input: object) => input,
  isValidPlaybackRate: () => true,
}))
vi.mock('../src/renderer/src/features/player/utils/hls-session', () => ({
  createHlsSession: () => ({
    customType: () => null,
    instance: () => null,
    destroy: () => {},
  }),
}))

const sinkMock = () => ({
  event: vi.fn(),
  error: vi.fn(),
  started: vi.fn(),
  seek: vi.fn(),
  autoplay: () => true,
  subtitles: () => {},
})

describe('createArtCore loadedmetadata', () => {
  beforeEach(() => {
    handlers.clear()
    video.videoWidth = 1920
    video.videoHeight = 1080
    video.pause.mockClear()
    web = false
    vi.stubGlobal('document', {
      createElement: () => ({ className: '', remove: () => {} }),
    })
  })

  const load = async (url: string) => {
    const { createArtCore } =
      await import('../src/renderer/src/features/player/utils/art-core')
    const sink = sinkMock()
    createArtCore({ url, useHls: false, autoplay: true, controls: true, sink })
    handlers.get('video:loadedmetadata')!({ type: 'loadedmetadata' })
    return sink
  }

  it('桌面端有画面：跳续播位置并转发，不报错', async () => {
    const sink = await load('local://media/a.mkv')
    expect(sink.error).not.toHaveBeenCalled()
    expect(sink.seek).toHaveBeenCalledWith(video)
    expect(sink.event).toHaveBeenCalledWith('loadedmetadata', {
      type: 'loadedmetadata',
    })
  })

  it('网页端只出声音：暂停并报解码不支持', async () => {
    web = true
    video.videoWidth = 0
    video.videoHeight = 0
    const sink = await load('https://nas/media/a.mkv')
    expect(video.pause).toHaveBeenCalled()
    expect(sink.error).toHaveBeenCalledTimes(1)
    expect(sink.seek).not.toHaveBeenCalled()
  })
})

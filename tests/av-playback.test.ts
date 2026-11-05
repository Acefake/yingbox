import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAvPlayback } from '../src/renderer/src/features/av/composables/use-av-playback'
import { toPluginItems } from '../src/renderer/src/features/av/utils/av-catalog'

const { fetchDetail, resolvePlayUrl, openMediaPlayer, error } = vi.hoisted(
  () => ({
    fetchDetail: vi.fn(),
    resolvePlayUrl: vi.fn(),
    openMediaPlayer: vi.fn(),
    error: vi.fn(),
  })
)
vi.mock('@/components/ui', () => ({ toast: { error } }))
vi.mock('@/features/incognito', () => ({ isIncognito: () => true }))
vi.mock('@/features/online', () => ({
  useOnlineSearch: () => ({ fetchDetail, resolvePlayUrl }),
}))
vi.mock('@/features/player', () => ({
  getMediaProgress: () => 0,
  openMediaPlayer,
}))

beforeEach(() => {
  vi.resetAllMocks()
  openMediaPlayer.mockResolvedValue(true)
})

describe('AV 聚合播放', () => {
  it('搜索结果自带线路时直接开播', async () => {
    const [video] = toPluginItems(
      [{ vod_id: '1', vod_play_url: '播放$https://media.test/video.m3u8' }],
      '测试源'
    )
    await useAvPlayback().playVideo(video)
    expect(fetchDetail).not.toHaveBeenCalled()
    expect(openMediaPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://media.test/video.m3u8' })
    )
  })

  it('首个来源解析失败时尝试下一个来源', async () => {
    const [first] = toPluginItems([{ vod_id: '1' }], '首个来源')
    const [second] = toPluginItems([{ vod_id: '2' }], '第二个来源')
    fetchDetail
      .mockResolvedValueOnce([
        { episodes: [{ name: '播放', url: 'track-id' }] },
      ])
      .mockResolvedValueOnce([
        { episodes: [{ name: '播放', url: 'https://media.test/video.mp4' }] },
      ])
    resolvePlayUrl.mockResolvedValue('')
    await useAvPlayback().playSources([first, second])
    expect(openMediaPlayer).toHaveBeenCalledTimes(1)
    expect(openMediaPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://media.test/video.mp4' })
    )
    expect(error).not.toHaveBeenCalled()
  })
})

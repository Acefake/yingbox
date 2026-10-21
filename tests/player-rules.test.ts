import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyPlaybackRate,
  isHlsUrl,
  isValidPlaybackRate,
  shouldResume,
} from '../src/renderer/src/features/player/utils/art-options'
import {
  type PlayerSubtitles,
  usePlayerSubtitles,
} from '../src/renderer/src/features/player/composables/use-player-subtitles'

describe('播放规则', () => {
  it('续播：5 秒以后、离结尾 10 秒以上、视频长于 15 秒才跳', () => {
    expect(shouldResume(60, 600)).toBe(true)
    expect(shouldResume(5, 600)).toBe(false)
    expect(shouldResume(591, 600)).toBe(false)
    expect(shouldResume(589, 600)).toBe(true)
    expect(shouldResume(8, 15)).toBe(false)
    expect(shouldResume(60, Number.NaN)).toBe(false)
  })

  it('倍速：只记 0.25–4 的有限值；应用时两个属性都设，1 倍速不动', () => {
    expect([0.25, 1.5, 4].every(isValidPlaybackRate)).toBe(true)
    expect([0.2, 4.5, Number.POSITIVE_INFINITY].some(isValidPlaybackRate)).toBe(
      false
    )
    const el = { defaultPlaybackRate: 1, playbackRate: 1 } as HTMLVideoElement
    applyPlaybackRate(el, 1.5)
    expect([el.defaultPlaybackRate, el.playbackRate]).toEqual([1.5, 1.5])
    const untouched = {
      defaultPlaybackRate: 2,
      playbackRate: 2,
    } as HTMLVideoElement
    applyPlaybackRate(untouched, 1)
    expect(untouched.playbackRate).toBe(2)
  })

  it('HLS 判定认 .m3u8 结尾或带查询串', () => {
    expect(isHlsUrl('https://a/b/index.m3u8')).toBe(true)
    expect(isHlsUrl('https://a/b/index.M3U8?token=1')).toBe(true)
    expect(isHlsUrl('https://a/b/video.mp4')).toBe(false)
    expect(isHlsUrl('https://a/m3u8/video.mp4')).toBe(false)
  })
})

describe('在线字幕', () => {
  afterEach(() => vi.unstubAllGlobals())

  const subs = (
    search = { title: '默认片名', imdbId: 'tt1', season: 1, episode: 2 }
  ): PlayerSubtitles =>
    usePlayerSubtitles({ player: () => null, search: () => search })

  it('输入框为空时用默认片名搜索，并带上 IMDB 与季集', async () => {
    const searchOnline = vi.fn(async () => ({
      success: true,
      data: [{ fileId: 1, name: 'a' }],
    }))
    vi.stubGlobal('window', { api: { subtitle: { searchOnline } } })
    const s = subs()
    await s.search()
    expect(searchOnline).toHaveBeenCalledWith({
      query: '默认片名',
      imdbId: 'tt1',
      season: 1,
      episode: 2,
    })
    expect(s.hits.value).toHaveLength(1)
    expect(s.searching.value).toBe(false)
    s.query.value = '手输片名'
    await s.search()
    expect(searchOnline).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: '手输片名' })
    )
  })

  it('输入框有词时优先用它；没有可搜的词时提示', async () => {
    const searchOnline = vi.fn(async () => ({ success: true, data: [] }))
    vi.stubGlobal('window', { api: { subtitle: { searchOnline } } })
    const s = subs({
      title: '',
      imdbId: '',
      season: undefined,
      episode: undefined,
    } as never)
    await s.search()
    expect(s.message.value).toBe('请输入影视名称')
    s.query.value = ' 手输 '
    await s.search()
    expect(searchOnline).toHaveBeenCalledWith(
      expect.objectContaining({ query: '手输', imdbId: undefined })
    )
    expect(s.message.value).toBe('无结果')
  })

  it('首次打开面板自动搜索一次，已有结果时再打开不重复搜', async () => {
    const searchOnline = vi.fn(async () => ({
      success: true,
      data: [{ fileId: 1, name: 'a' }],
    }))
    vi.stubGlobal('window', { api: { subtitle: { searchOnline } } })
    const s = subs()
    s.togglePanel()
    await vi.waitFor(() => expect(s.hits.value).toHaveLength(1))
    s.togglePanel()
    s.togglePanel()
    expect(searchOnline).toHaveBeenCalledTimes(1)
  })

  it('未配置 key 时给出配置提示', async () => {
    vi.stubGlobal('window', {
      api: {
        subtitle: {
          searchOnline: async () => ({ success: false, notConfigured: true }),
        },
      },
    })
    const s = subs()
    await s.search()
    expect(s.message.value).toContain('YINGBOX_OPENSUBTITLES_KEY')
  })
})

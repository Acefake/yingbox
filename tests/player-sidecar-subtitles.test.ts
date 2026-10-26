/**
 * 播放器外挂字幕的来源：桌面端走 IPC（local://），网页端走片库服务（/media/files → /media/subtitles）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  findSidecarSubtitles,
  readSidecarSubtitle,
} from '../src/renderer/src/features/player/composables/sidecar-subtitles'
import {
  isServerSubtitleUrl,
  serverFileIdOf,
} from '../src/renderer/src/services/library-server'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('服务地址', () => {
  it('从播放地址认出片库视频文件 id（相对 / 绝对都认）', () => {
    expect(serverFileIdOf('/media/files/12')).toBe(12)
    expect(serverFileIdOf('http://nas:31480/media/files/7?x=1')).toBe(7)
    expect(serverFileIdOf('/media/files/abc')).toBeNull()
    expect(serverFileIdOf('/media/files/0')).toBeNull()
    expect(serverFileIdOf('https://cdn.example/v.m3u8')).toBeNull()
    expect(isServerSubtitleUrl('/media/subtitles/1/a.srt')).toBe(true)
    expect(isServerSubtitleUrl('/home/a.srt')).toBe(false)
  })
})

describe('网页端（没有 window.api）', () => {
  it('列表与读取都经片库服务，候选的 path 是读取地址', async () => {
    const requests: string[] = []
    vi.stubGlobal('window', {})
    vi.stubGlobal('fetch', async (url: string) => {
      requests.push(url)
      if (url === '/media/subtitles/5')
        return Response.json({
          subtitles: [
            { name: 'a.zh', ext: '.srt', url: '/media/subtitles/5/a.zh.srt' },
          ],
        })
      return new Response('WEBVTT\n\n00:00.000 --> 00:01.000\nhi\n')
    })
    expect(await findSidecarSubtitles('/media/files/5')).toEqual([
      { name: 'a.zh', ext: '.srt', path: '/media/subtitles/5/a.zh.srt' },
    ])
    expect(await readSidecarSubtitle('/media/subtitles/5/a.zh.srt')).toMatch(
      /^WEBVTT/
    )
    // 不是服务地址的不发请求
    expect(await findSidecarSubtitles('https://cdn.example/v.m3u8')).toEqual([])
    expect(await readSidecarSubtitle('/etc/passwd')).toBeNull()
    expect(requests).toEqual([
      '/media/subtitles/5',
      '/media/subtitles/5/a.zh.srt',
    ])
  })

  it('服务出错时抛错（调用方当作没有字幕）', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('fetch', async () => new Response('x', { status: 500 }))
    await expect(findSidecarSubtitles('/media/files/5')).rejects.toThrow(/500/)
  })
})

describe('桌面端（有 window.api）', () => {
  it('只对 local:// 走 IPC；本地路径即使以 /media/subtitles 开头也按文件读', async () => {
    const read = vi.fn(async (path: string) => ({
      success: true,
      data: `WEBVTT ${path}`,
    }))
    const find = vi.fn(async () => ({
      success: true,
      data: [{ name: 'a', path: '/m/a.srt', ext: '.srt' }],
    }))
    vi.stubGlobal('window', { api: { subtitle: { find, read } } })
    vi.stubGlobal('fetch', () => {
      throw new Error('桌面端不该 fetch')
    })
    expect(await findSidecarSubtitles('local:///m/a.mkv')).toHaveLength(1)
    expect(await findSidecarSubtitles('/media/files/5')).toEqual([])
    expect(await readSidecarSubtitle('/media/subtitles/a.srt')).toBe(
      'WEBVTT /media/subtitles/a.srt'
    )
    expect(find).toHaveBeenCalledTimes(1)
  })
})

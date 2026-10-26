/**
 * NAS 网页端可用性修复（PR fix/nas-web-playback）的纯规则：CSP、播放失败文案、写出失败提示、
 * 在线简介去标签、网页端只登记的设置分区、网页端豆瓣图改走服务代理。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CODEC_UNSUPPORTED,
  WEB_CODEC_UNSUPPORTED,
  lacksVideoTrack,
  videoErrorReason,
} from '../src/renderer/src/features/player/utils/play-errors'
import {
  fsErrorReason,
  writerFailureText,
} from '../src/renderer/src/features/library/writer/writer-errors'
import { htmlToText } from '../src/renderer/src/utils/html-text'

const root = join(__dirname, '..')
const read = (path: string): string => readFileSync(join(root, path), 'utf8')
const connectSrc = (text: string): string =>
  /connect-src ([^;]+);/.exec(text)?.[1] ?? ''

describe('CSP：外挂字幕 blob 地址', () => {
  it('网页端 meta、播放器页与桌面端响应头的 connect-src 都放行 blob:', () => {
    for (const file of [
      'src/renderer/index.html',
      'src/renderer/player.html',
      'src/main/index.ts',
    ])
      expect(connectSrc(read(file)).split(' '), file).toContain('blob:')
  })
})

describe('播放失败文案', () => {
  it('网页端编码 / 格式不受支持：说明换桌面版或浏览器', () => {
    expect(videoErrorReason(3, true)).toBe(WEB_CODEC_UNSUPPORTED)
    expect(videoErrorReason(4, true)).toBe(WEB_CODEC_UNSUPPORTED)
    expect(WEB_CODEC_UNSUPPORTED).toMatch(/HEVC/)
    expect(WEB_CODEC_UNSUPPORTED).toMatch(/桌面版/)
    expect(WEB_CODEC_UNSUPPORTED).toMatch(/Safari \/ Edge/)
    // 桌面端不变
    expect(videoErrorReason(3)).toBe(CODEC_UNSUPPORTED)
    expect(videoErrorReason(2, true)).toBe('网络错误，连不上服务器')
  })

  it('只有声音、没有画面：直链视频判为解不了，HLS 与纯音频不判', () => {
    const black = { videoWidth: 0, videoHeight: 0 }
    expect(lacksVideoTrack(black, '/media/files/3', false)).toBe(true)
    expect(lacksVideoTrack(black, 'https://a/live.m3u8', true)).toBe(false)
    expect(lacksVideoTrack(black, 'https://radio/x.mp3?a=1', false)).toBe(false)
    expect(
      lacksVideoTrack(
        { videoWidth: 1920, videoHeight: 1080 },
        '/media/files/3',
        false
      )
    ).toBe(false)
  })
})

describe('写出 / 整理失败提示', () => {
  const event = {
    type: 'writer-progress' as const,
    jobId: 1,
    total: 3,
    done: 3,
    written: 0,
    skipped: 0,
    finished: true,
  }
  it('只读挂载与没有权限译成人话', () => {
    expect(
      fsErrorReason("EROFS: read-only file system, open '/media/movies/a.nfo'")
    ).toMatch(/^挂载是只读的/)
    expect(
      fsErrorReason("EACCES: permission denied, mkdir '/media/x'")
    ).toMatch(/^没有写权限/)
    expect(fsErrorReason('EPERM: operation not permitted')).toMatch(
      /^没有写权限/
    )
    expect(fsErrorReason('别的错')).toBe('别的错')
  })
  it('任务结束且有失败时才给提示', () => {
    expect(
      writerFailureText({
        ...event,
        mode: 'write',
        failed: 3,
        error:
          "/media/a.nfo：EROFS: read-only file system, open '/media/a.nfo'",
      })
    ).toBe(
      '写出 NFO 与图片失败 3 个：挂载是只读的（Docker 里媒体目录要去掉 :ro 才能写）'
    )
    expect(
      writerFailureText({
        ...event,
        mode: 'organize',
        failed: 0,
        error: 'EACCES: x',
      })
    ).toMatch(/^整理文件失败：没有写权限/)
    expect(writerFailureText({ ...event, mode: 'write', failed: 0 })).toBeNull()
    expect(
      writerFailureText({ ...event, mode: 'write', failed: 1, finished: false })
    ).toBeNull()
  })
})

describe('在线简介去 HTML', () => {
  it('段落 / 换行 / 实体', () => {
    expect(htmlToText('<p>第一段&nbsp;内容</p><p>第二段 &amp; 更多</p>')).toBe(
      '第一段 内容\n第二段 & 更多'
    )
    expect(htmlToText('a<br/>b<br>c')).toBe('a\nb\nc')
    expect(htmlToText('&#20013;&#x6587; &lt;tag&gt;')).toBe('中文 <tag>')
    expect(htmlToText('<script>alert(1)</script>正文')).toBe('正文')
    expect(htmlToText('纯文本')).toBe('纯文本')
    expect(htmlToText('')).toBe('')
  })
})

describe('网页端运行时', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('只在桌面端有意义的设置分区（AI / 软件更新 / AI 助手）网页端不登记', async () => {
    vi.resetModules()
    vi.stubGlobal('window', {})
    const { settingsSections, registerSettingsSection } =
      await import('../src/renderer/src/features/settings/registry')
    const ids = (): string[] => settingsSections.map(s => s.id)
    expect(ids()).not.toContain('ai')
    expect(ids()).not.toContain('update')
    expect(ids()).toContain('player')
    registerSettingsSection({
      id: 'assistant',
      title: 'AI 助手',
      icon: 'sparkle',
      keywords: '',
      load: async () => ({ default: {} }),
      desktopOnly: true,
    })
    expect(ids()).not.toContain('assistant')
  })

  it('桌面端照常登记', async () => {
    vi.resetModules()
    vi.stubGlobal('window', { api: {} })
    const { settingsSections } =
      await import('../src/renderer/src/features/settings/registry')
    expect(settingsSections.map(s => s.id)).toEqual(
      expect.arrayContaining(['ai', 'update'])
    )
  })

  it('网页端豆瓣图改走 /media/thumb，其它来源与桌面端原样', async () => {
    vi.resetModules()
    vi.stubGlobal('window', {})
    const { webImageSrc } =
      await import('../src/renderer/src/services/thumbnails')
    const douban =
      'https://img9.doubanio.com/view/photo/s_ratio_poster/public/p1.jpg'
    expect(webImageSrc(douban, 300)).toBe(
      `/media/thumb?w=300&src=${encodeURIComponent(douban)}`
    )
    expect(webImageSrc('https://image.tmdb.org/t/p/w342/a.jpg')).toBe(
      'https://image.tmdb.org/t/p/w342/a.jpg'
    )
    // 只认 doubanio.com 本域与子域
    expect(webImageSrc('https://doubanio.com.evil.example/a.jpg')).toBe(
      'https://doubanio.com.evil.example/a.jpg'
    )
    expect(webImageSrc('http://img1.doubanio.com/a.jpg')).toBe(
      'http://img1.doubanio.com/a.jpg'
    )
    vi.resetModules()
    vi.stubGlobal('window', { api: {} })
    const desktop = await import('../src/renderer/src/services/thumbnails')
    expect(desktop.webImageSrc(douban)).toBe(douban)
  })
})

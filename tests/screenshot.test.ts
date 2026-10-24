import { describe, expect, it } from 'vitest'

import {
  captureFileName,
  ffmpegError,
  frameArgs,
  gifArgs,
  gifWindow,
  isInsideDir,
  isPng,
  numberedName,
  positionLabel,
  sanitizeName,
} from '../src/main/capture/rules'
import {
  frameFailure,
  frameFailureText,
  gifSupport,
  isLocalUrl,
  nameHint,
} from '../src/renderer/src/features/player/screenshot/screenshot-rules'
import { capture } from '../src/shared/contract/capture'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])

describe('截图 / GIF：主进程规则', () => {
  it('只收 PNG 文件头', () => {
    expect(isPng(PNG)).toBe(true)
    expect(isPng(new Uint8Array([1, 2, 3]))).toBe(false)
    expect(isPng(new Uint8Array(16))).toBe(false)
  })

  it('文件名清洗：去掉非法字符、首尾点，限长', () => {
    expect(sanitizeName(' a<b>:c/d\\e|f?g*h "i" ')).toBe('a b c d e f g h i')
    expect(sanitizeName('..隐藏.')).toBe('隐藏')
    expect(sanitizeName('x'.repeat(100))).toHaveLength(60)
  })

  it('播放位置标签不含冒号', () => {
    expect(positionLabel(123)).toBe('02-03')
    expect(positionLabel(3723.9)).toBe('01-02-03')
    expect(positionLabel(Number.NaN)).toBe('00-00')
  })

  it('截图文件名：片名 + 位置 + 时间戳，缺省片名「影盒截图」', () => {
    const now = new Date(2026, 9, 24, 12, 30, 5)
    expect(captureFileName('星际穿越', 123, now, 'png')).toBe(
      '星际穿越 02-03 20261024-123005.png'
    )
    expect(captureFileName('', 0, now, 'gif')).toBe(
      '影盒截图 00-00 20261024-123005.gif'
    )
    expect(numberedName('a b.png', 2)).toBe('a b (2).png')
    expect(numberedName('noext', 3)).toBe('noext (3)')
  })

  it('GIF 时间窗：前后各 2.5 秒，开头不足从 0 开始', () => {
    expect(gifWindow(60)).toEqual({ start: 57.5, length: 5 })
    expect(gifWindow(1)).toEqual({ start: 0, length: 5 })
    expect(gifWindow(Number.NaN)).toEqual({ start: 0, length: 5 })
  })

  it('ffmpeg 参数：-ss 在 -i 之前（快速定位），GIF 用调色板，截帧只出一帧', () => {
    const g = gifArgs('/v/a.mkv', 57.5, 5, '/p/a.gif')
    expect(g.indexOf('-ss')).toBeLessThan(g.indexOf('-i'))
    expect(g).toContain('57.5')
    expect(g[g.indexOf('-t') + 1]).toBe('5')
    expect(g[g.indexOf('-vf') + 1]).toContain('palettegen')
    expect(g.at(-1)).toBe('/p/a.gif')
    const f = frameArgs('/v/a.mkv', -3, '/p/a.png')
    expect(f[f.indexOf('-ss') + 1]).toBe('0')
    expect(f[f.indexOf('-frames:v') + 1]).toBe('1')
    expect(f.at(-1)).toBe('/p/a.png')
  })

  it('在文件夹中显示只接受截图目录里的文件', () => {
    expect(isInsideDir('/p/影盒', '/p/影盒/a.png')).toBe(true)
    expect(isInsideDir('/p/影盒', '/p/影盒')).toBe(false)
    expect(isInsideDir('/p/影盒', '/p/影盒/../x.png')).toBe(false)
    expect(isInsideDir('/p/影盒', '/etc/passwd')).toBe(false)
  })

  it('ffmpeg 错误取最后一行', () => {
    expect(ffmpegError('a\n\nInvalid data found\n')).toBe('Invalid data found')
    expect(ffmpegError('')).toBe('ffmpeg 运行失败')
  })

  it('契约：savePng 只收 Uint8Array，名字可为空', () => {
    expect(capture.calls.savePng.parse([PNG, '', 1.5])).toEqual([PNG, '', 1.5])
    expect(() => capture.calls.savePng.parse(['x', '', 0])).toThrow()
    expect(() => capture.calls.gif.parse(['local://a', Number.NaN])).toThrow()
  })
})

describe('截图 / GIF：渲染层规则', () => {
  it('本地文件取文件名做提示，在线流不给', () => {
    expect(isLocalUrl('local://media/C%3A/a.mkv')).toBe(true)
    expect(nameHint('local://media/C%3A/movies/%E6%98%9F%E9%99%85.mkv')).toBe(
      '星际'
    )
    expect(nameHint('local://media/%E0%A4%A.mkv')).toBe('%E0%A4%A')
    expect(nameHint('https://x.com/a.m3u8')).toBe('')
  })

  it('GIF 只在桌面端、本地文件、找到 ffmpeg 时可用', () => {
    expect(gifSupport({ desktop: true, local: true, ffmpeg: true })).toEqual({
      enabled: true,
      reason: '',
    })
    expect(
      gifSupport({ desktop: false, local: true, ffmpeg: true }).reason
    ).toBe('网页版不支持截 GIF')
    expect(
      gifSupport({ desktop: true, local: false, ffmpeg: true }).reason
    ).toBe('在线视频只支持截图')
    expect(
      gifSupport({ desktop: true, local: true, ffmpeg: null }).enabled
    ).toBe(false)
    expect(
      gifSupport({ desktop: true, local: true, ffmpeg: false }).reason
    ).toContain('ffmpeg')
  })

  it('截帧失败分类：跨域污染、未就绪、其他', () => {
    const security = new Error('tainted')
    security.name = 'SecurityError'
    expect(frameFailure(security)).toBe('tainted')
    expect(frameFailure(new Error('not-ready'))).toBe('not-ready')
    expect(frameFailure(new Error('x'))).toBe('unknown')
    expect(frameFailureText('tainted')).toContain('跨域')
  })
})

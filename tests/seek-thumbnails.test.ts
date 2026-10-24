import { describe, expect, it } from 'vitest'

import {
  ffmpegCandidates,
  planSeekEviction,
  seekCacheKey,
  seekDir,
  seekFfmpegArgs,
  seekFilter,
} from '../src/main/seek-thumbnails/rules'
import {
  SEEK_PER_PAGE,
  type SeekManifest,
  parseSeekManifest,
  parseSeekUrl,
  seekFrameAt,
  seekLayout,
  seekPageFile,
  seekSpriteUrl,
  shouldGenerateSeek,
} from '../src/shared/seek-thumbnails'

const manifest: SeekManifest = {
  key: 'a'.repeat(32),
  interval: 10,
  width: 160,
  height: 90,
  columns: 10,
  rows: 10,
  pages: 3,
  frames: 250,
}

describe('帧间隔与分页', () => {
  it('每 10 秒一帧，每页 100 帧', () => {
    expect(SEEK_PER_PAGE).toBe(100)
    expect(seekLayout(5)).toEqual({ frames: 1, pages: 1 })
    expect(seekLayout(1000)).toEqual({ frames: 100, pages: 1 })
    expect(seekLayout(1001)).toEqual({ frames: 101, pages: 2 })
    expect(seekLayout(2 * 3600)).toEqual({ frames: 720, pages: 8 })
    expect(seekLayout(0)).toEqual({ frames: 0, pages: 0 })
    expect(seekLayout(Number.NaN)).toEqual({ frames: 0, pages: 0 })
  })

  it('太短、太长、非有限时长不生成', () => {
    expect(shouldGenerateSeek(30)).toBe(false)
    expect(shouldGenerateSeek(60)).toBe(true)
    expect(shouldGenerateSeek(7200)).toBe(true)
    expect(shouldGenerateSeek(7 * 3600)).toBe(false)
    expect(shouldGenerateSeek(Infinity)).toBe(false)
  })
})

describe('时间 → 雪碧图位置', () => {
  it('页内按行优先排列', () => {
    expect(seekFrameAt(0, manifest)).toEqual({ page: 0, column: 0, row: 0 })
    expect(seekFrameAt(9.9, manifest)).toEqual({ page: 0, column: 0, row: 0 })
    expect(seekFrameAt(10, manifest)).toEqual({ page: 0, column: 1, row: 0 })
    expect(seekFrameAt(95, manifest)).toEqual({ page: 0, column: 9, row: 0 })
    expect(seekFrameAt(100, manifest)).toEqual({ page: 0, column: 0, row: 1 })
    expect(seekFrameAt(999, manifest)).toEqual({ page: 0, column: 9, row: 9 })
  })

  it('跨页', () => {
    expect(seekFrameAt(1000, manifest)).toEqual({ page: 1, column: 0, row: 0 })
    expect(seekFrameAt(2345, manifest)).toEqual({ page: 2, column: 4, row: 3 })
  })

  it('越界夹到首尾帧；没有帧返回 null', () => {
    expect(seekFrameAt(-5, manifest)).toEqual({ page: 0, column: 0, row: 0 })
    expect(seekFrameAt(99999, manifest)).toEqual({
      page: 2,
      column: 9,
      row: 4,
    })
    // 实际页数少于预期时以页数为准
    expect(seekFrameAt(99999, { ...manifest, pages: 1 })).toEqual({
      page: 0,
      column: 9,
      row: 9,
    })
    expect(seekFrameAt(10, { ...manifest, frames: 0 })).toBeNull()
  })
})

describe('地址与文件名', () => {
  it('雪碧图地址可往返解析', () => {
    const url = seekSpriteUrl(manifest.key, 2)
    expect(url).toBe(`yingbox-media://seek/${manifest.key}/2.jpg`)
    expect(parseSeekUrl(url)).toEqual({ key: manifest.key, page: 2 })
  })

  it('不合法的地址不认', () => {
    expect(parseSeekUrl(`yingbox-media://image/${manifest.key}`)).toBeNull()
    expect(parseSeekUrl('yingbox-media://seek/xyz/0.jpg')).toBeNull()
    expect(
      parseSeekUrl(`yingbox-media://seek/${manifest.key}/../0.jpg`)
    ).toBeNull()
    expect(parseSeekUrl(`https://seek/${manifest.key}/0.jpg`)).toBeNull()
  })

  it('页码对应 ffmpeg 输出文件名', () => {
    expect(seekPageFile(0)).toBe('sprite-000.jpg')
    expect(seekPageFile(12)).toBe('sprite-012.jpg')
  })
})

describe('缓存 key 与目录', () => {
  it('同一文件同一 key；大小或修改时间变了 key 就变', () => {
    const a = seekCacheKey('/v/a.mkv', 100, 1700000000000.4)
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(seekCacheKey('/v/a.mkv', 100, 1700000000000.9)).toBe(a)
    expect(seekCacheKey('/v/a.mkv', 101, 1700000000000)).not.toBe(a)
    expect(seekCacheKey('/v/a.mkv', 100, 1700000001000)).not.toBe(a)
    expect(seekCacheKey('/v/b.mkv', 100, 1700000000000)).not.toBe(a)
  })

  it('放在缩略图缓存目录的 seek/ 下按前两位分片', () => {
    const key = `ab${'c'.repeat(30)}`
    expect(seekDir('/m', key).replace(/\\/g, '/')).toBe(
      `/m/thumb/seek/ab/${key}`
    )
  })
})

describe('ffmpeg 参数与定位', () => {
  it('只解关键帧、固定帧尺寸、10×10 拼页', () => {
    expect(seekFilter()).toBe(
      'fps=1/10,scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,setsar=1,tile=10x10'
    )
    const args = seekFfmpegArgs('/v/a.mkv', '/out')
    expect(args.indexOf('-skip_frame')).toBeLessThan(args.indexOf('-i'))
    expect(args[args.indexOf('-i') + 1]).toBe('/v/a.mkv')
    expect(args).toContain('-an')
    expect(args.at(-1)!.replace(/\\/g, '/')).toBe('/out/sprite-%03d.jpg')
  })

  it('环境变量优先，其次 PATH，再常见位置', () => {
    const mac = ffmpegCandidates('darwin', { YINGBOX_FFMPEG: '/x/ffmpeg' })
    expect(mac).toEqual([
      '/x/ffmpeg',
      'ffmpeg',
      '/opt/homebrew/bin/ffmpeg',
      '/usr/local/bin/ffmpeg',
    ])
    const win = ffmpegCandidates('win32', { ProgramFiles: 'C:\\PF' })
    expect(win[0]).toBe('ffmpeg.exe')
    expect(win.length).toBeGreaterThan(1)
  })
})

describe('清单校验与淘汰', () => {
  it('清单字段不全或 key 不合法时不认', () => {
    expect(parseSeekManifest(manifest)).toEqual(manifest)
    expect(parseSeekManifest({ ...manifest, pages: 0 })).toBeNull()
    expect(parseSeekManifest({ ...manifest, key: 'x' })).toBeNull()
    expect(parseSeekManifest(null)).toBeNull()
  })

  it('超过上限删最久未用的，正在用的不删', () => {
    const entries = [
      { key: 'a', usedAt: 1 },
      { key: 'b', usedAt: 2 },
      { key: 'c', usedAt: 3 },
      { key: 'd', usedAt: 4 },
    ]
    expect(planSeekEviction(entries, 4)).toEqual([])
    expect(planSeekEviction(entries, 2)).toEqual(['a', 'b'])
    expect(planSeekEviction(entries, 2, new Set(['a']))).toEqual(['b', 'c'])
  })
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { createVideoProber } from '../src/main/library/scanner/video-probe'
import {
  bestVideoRange,
  needsExternalPlayer,
  parseFfprobeVideo,
  videoProbeTag,
  videoRangeBadge,
} from '../src/shared/video-range'

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(join(__dirname, 'fixtures/ffprobe', `${name}.json`), 'utf8')
  )

describe('ffprobe 输出解析', () => {
  it('杜比视界 Profile 5：无兼容基础层', () => {
    expect(parseFfprobeVideo(fixture('dv-p5'))).toEqual({
      range: 'dv',
      dvProfile: 5,
      dvCompat: 0,
    })
  })

  it('杜比视界 Profile 8.1：带 HDR10 基础层', () => {
    expect(parseFfprobeVideo(fixture('dv-p8'))).toEqual({
      range: 'dv',
      dvProfile: 8,
      dvCompat: 1,
    })
  })

  it('HDR10（smpte2084）', () => {
    expect(parseFfprobeVideo(fixture('hdr10'))).toEqual({
      range: 'hdr10',
      dvProfile: null,
      dvCompat: null,
    })
  })

  it('HLG（arib-std-b67）', () => {
    expect(parseFfprobeVideo(fixture('hlg'))?.range).toBe('hlg')
  })

  it('SDR：跳过封面图流，取第一条正片视频流', () => {
    expect(parseFfprobeVideo(fixture('sdr'))).toEqual({
      range: 'sdr',
      dvProfile: null,
      dvCompat: null,
    })
  })

  it('没有视频流或输出不像样时返回 null', () => {
    expect(parseFfprobeVideo({ streams: [] })).toBeNull()
    expect(parseFfprobeVideo({ streams: [{ codec_type: 'audio' }] })).toBeNull()
    expect(parseFfprobeVideo('oops')).toBeNull()
    expect(parseFfprobeVideo(null)).toBeNull()
  })
})

describe('是否需要外部播放器', () => {
  it('P5 与兼容号为 0 的杜比视界需要；P7 / P8 / HDR10 / HLG / SDR 不需要', () => {
    expect(needsExternalPlayer({ dvProfile: 5, dvCompat: 0 })).toBe(true)
    expect(needsExternalPlayer({ dvProfile: 5, dvCompat: null })).toBe(true)
    expect(needsExternalPlayer({ dvProfile: 10, dvCompat: 0 })).toBe(true)
    expect(needsExternalPlayer({ dvProfile: 7, dvCompat: 6 })).toBe(false)
    expect(needsExternalPlayer({ dvProfile: 8, dvCompat: 1 })).toBe(false)
    expect(needsExternalPlayer({ dvProfile: 8, dvCompat: 4 })).toBe(false)
    expect(needsExternalPlayer({ dvProfile: null, dvCompat: null })).toBe(false)
    expect(needsExternalPlayer(null)).toBe(false)
    expect(needsExternalPlayer(undefined)).toBe(false)
  })
})

describe('标记与汇总', () => {
  it('卡片小标：DV / HDR / HLG，SDR 与未知不显示', () => {
    expect(videoRangeBadge('dv')).toBe('DV')
    expect(videoRangeBadge('hdr10')).toBe('HDR')
    expect(videoRangeBadge('hlg')).toBe('HLG')
    expect(videoRangeBadge('sdr')).toBe('')
    expect(videoRangeBadge(null)).toBe('')
  })

  it('详情小标：杜比视界带 profile', () => {
    expect(videoProbeTag({ range: 'dv', dvProfile: 5, dvCompat: 0 })).toBe(
      'DV P5'
    )
    expect(
      videoProbeTag({ range: 'dv', dvProfile: null, dvCompat: null })
    ).toBe('DV')
    expect(
      videoProbeTag({ range: 'hlg', dvProfile: null, dvCompat: null })
    ).toBe('HLG')
    expect(videoProbeTag(null)).toBe('')
  })

  it('多个文件取最好的一档：DV > HDR10 > HLG > SDR', () => {
    expect(bestVideoRange(['sdr', 'hlg', 'hdr10'])).toBe('hdr10')
    expect(bestVideoRange(['dv', 'hdr10'])).toBe('dv')
    expect(bestVideoRange(['sdr', null])).toBe('sdr')
    expect(bestVideoRange([])).toBeNull()
  })
})

describe('ffprobe 调用', () => {
  it('调用参数只取视频流，输出交给解析', async () => {
    const run = vi.fn(async () => JSON.stringify(fixture('dv-p5')))
    const probe = createVideoProber({ binary: () => '/opt/ffprobe', run })
    expect(await probe('/m/a.mkv')).toEqual({
      range: 'dv',
      dvProfile: 5,
      dvCompat: 0,
    })
    const [binary, args] = run.mock.calls[0] as unknown as [string, string[]]
    expect(binary).toBe('/opt/ffprobe')
    expect(args).toEqual(
      expect.arrayContaining(['-select_streams', 'v', '-show_streams'])
    )
    expect(args.at(-1)).toBe('/m/a.mkv')
  })

  it('没有 ffprobe（找不到程序或路径为空）报告不可用，不抛错', async () => {
    const missing = Object.assign(new Error('spawn ffprobe ENOENT'), {
      code: 'ENOENT',
    })
    const probe = createVideoProber({
      binary: () => 'ffprobe',
      run: async () => {
        throw missing
      },
    })
    expect(await probe('/m/a.mkv')).toBe('unavailable')
    const empty = createVideoProber({ binary: async () => '', run: vi.fn() })
    expect(await empty('/m/a.mkv')).toBe('unavailable')
  })

  it('单个文件探测失败（坏文件、超时）记为 null', async () => {
    const probe = createVideoProber({
      binary: () => 'ffprobe',
      run: async () => {
        throw new Error('Invalid data found when processing input')
      },
    })
    expect(await probe('/m/bad.mkv')).toBeNull()
  })
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  PROBE_MAX_PROCESSES,
  createVideoProber,
} from '../src/main/library/scanner/video-probe'
import {
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

  /** execFile 的失败：数字 code 是退出码，killed / signal 是被杀（超时） */
  const failing = (
    error: Record<string, unknown>
  ): ReturnType<typeof createVideoProber> =>
    createVideoProber({
      binary: () => 'ffprobe',
      run: async () => {
        throw Object.assign(new Error('ffprobe failed'), error)
      },
    })

  it("ffprobe 正常跑完：没有正片视频流、或判定为坏数据，记为 null（写 ''，不再重试）", async () => {
    const noVideo = createVideoProber({
      binary: () => 'ffprobe',
      run: async () => JSON.stringify({ streams: [{ codec_type: 'audio' }] }),
    })
    expect(await noVideo('/m/a.mka')).toBeNull()
    expect(
      await failing({
        code: 1,
        stderr: '/m/bad.mkv: Invalid data found when processing input\n',
      })('/m/bad.mkv')
    ).toBeNull()
  })

  it('瞬时失败（超时被杀、权限 / I/O 错误、读不到文件的非零退出）记为 failed，下一轮再试', async () => {
    expect(
      await failing({ killed: true, signal: 'SIGTERM', code: null })('/m/a.mkv')
    ).toBe('failed')
    expect(await failing({ code: 'EACCES' })('/m/a.mkv')).toBe('failed')
    expect(await failing({ code: 'EPERM' })('/m/a.mkv')).toBe('failed')
    expect(
      await failing({
        code: 1,
        stderr: '/Volumes/NAS/a.mkv: No such file or directory\n',
      })('/Volumes/NAS/a.mkv')
    ).toBe('failed')
    expect(
      await failing({ code: 1, stderr: 'a.mkv: Input/output error\n' })('a.mkv')
    ).toBe('failed')
  })

  it('同一进程里最多同时跑 PROBE_MAX_PROCESSES 个 ffprobe（跨库共用）', async () => {
    let active = 0
    let peak = 0
    const release: Array<() => void> = []
    const run = vi.fn(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise<void>(resolve => release.push(resolve))
      active--
      return JSON.stringify(fixture('sdr'))
    })
    const probe = createVideoProber({ binary: () => 'ffprobe', run })
    const all = Promise.all([1, 2, 3, 4, 5].map(i => probe(`/m/${i}.mkv`)))
    for (let i = 0; i < 20 && run.mock.calls.length < 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 0))
      release.splice(0).forEach(fn => fn())
    }
    const results = await all
    expect(run).toHaveBeenCalledTimes(5)
    expect(peak).toBe(PROBE_MAX_PROCESSES)
    expect(results.every(r => r !== null && typeof r === 'object')).toBe(true)
  })
})

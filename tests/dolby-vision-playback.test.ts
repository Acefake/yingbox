/**
 * 杜比视界播放：滤镜与编码参数（HDR 输出 / SDR 色调映射 / 关闭 apply_dolbyvision / nvenc 恒定质量 /
 * HDR10 元数据 / 每轮 -t）、渲染层规则（要不要重建、退到 mpv 还是直接播、本机流前缀）、
 * HLS 播放列表与分片调度。能力探测见 dolby-vision-capability.test.ts，会话生命周期见 dolby-vision-session.test.ts。
 */
import { posix } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  HDR10_MASTER_DISPLAY,
  HDR10_MAX_CLL,
  RUN_SEGMENTS,
  SEGMENT_SECONDS,
  buildEncoderArgs,
  buildTranscodeArgs,
  buildVideoFilter,
  outputSize,
} from '../src/main/dolby-vision/filters'
import {
  buildVodPlaylist,
  parseRequestName,
  planSegment,
  prunable,
  resumeFrom,
  segmentCount,
} from '../src/main/dolby-vision/playlist'
import type { VideoHdrInfo } from '../src/shared/dolby-vision'
import {
  chooseOutput,
  dvFallback,
  knownNeedsRebuild,
  localStreamPrefix,
  needsRebuild,
  planFromStart,
} from '../src/renderer/src/features/player/dolby-vision/dv-rules'

const P5: VideoHdrInfo = {
  hdr: 'dolby-vision',
  doviLabel: 'Profile 5',
  needsRpuRebuild: true,
  dovi: { profile: 5, level: 6, rpu: true, el: false, bl: true, compatId: 0 },
}
const P81: VideoHdrInfo = {
  hdr: 'dolby-vision',
  doviLabel: 'Profile 8.1',
  needsRpuRebuild: false,
  baseLayer: 'hdr10',
}

describe('libplacebo 滤镜', () => {
  it('HDR 输出：apply_dolbyvision=1，bt2020nc / bt2020 / smpte2084，10bit；硬件编码器再转 p010', () => {
    expect(
      buildVideoFilter({
        output: 'hdr10',
        applyDolbyVision: true,
        encoder: 'hevc_nvenc',
      })
    ).toBe(
      'libplacebo=apply_dolbyvision=1:colorspace=bt2020nc:color_primaries=bt2020:color_trc=smpte2084:range=tv:format=yuv420p10le,format=p010le'
    )
  })

  it('SDR 输出：色调映射到 bt709，8bit', () => {
    const vf = buildVideoFilter({
      output: 'sdr',
      applyDolbyVision: true,
      encoder: 'libx264',
    })
    expect(vf).toBe(
      'libplacebo=apply_dolbyvision=1:colorspace=bt709:color_primaries=bt709:color_trc=bt709:tonemapping=bt.2390:range=tv:format=yuv420p'
    )
  })

  it('设置关闭时 apply_dolbyvision=0', () => {
    expect(
      buildVideoFilter({
        output: 'hdr10',
        applyDolbyVision: false,
        encoder: 'libx265',
      })
    ).toContain('apply_dolbyvision=0')
  })

  it('软件编码器把 4K 压到 1080p（宽取偶数），硬件编码器保持原尺寸', () => {
    expect(
      outputSize({ width: 3840, height: 2160, encoder: 'libx265' })
    ).toEqual({ w: 1920, h: 1080 })
    expect(
      outputSize({ width: 3840, height: 1606, encoder: 'libx264' })
    ).toEqual({ w: 2582, h: 1080 })
    expect(
      outputSize({ width: 3840, height: 2160, encoder: 'hevc_nvenc' })
    ).toBeNull()
    expect(
      outputSize({ width: 1920, height: 1080, encoder: 'libx265' })
    ).toBeNull()
  })

  it('完整参数：从第 n 段起 -ss / -output_ts_offset 对齐，fMP4 HLS，音频转 AAC', () => {
    const args = buildTranscodeArgs({
      input: '/m/p5.mkv',
      output: 'hdr10',
      applyDolbyVision: true,
      encoder: 'hevc_nvenc',
      startIndex: 10,
      dir: '/tmp/dv',
      join: posix.join,
    })
    const after = (flag: string): string | undefined =>
      args[args.indexOf(flag) + 1]
    expect(after('-ss')).toBe((10 * SEGMENT_SECONDS).toFixed(3))
    expect(after('-output_ts_offset')).toBe((10 * SEGMENT_SECONDS).toFixed(3))
    expect(after('-start_number')).toBe('10')
    expect(after('-t')).toBe(String(RUN_SEGMENTS * SEGMENT_SECONDS))
    expect(after('-hls_segment_type')).toBe('fmp4')
    expect(after('-c:a')).toBe('aac')
    expect(after('-vf')).toContain('apply_dolbyvision=1')
    expect(after('-color_trc')).toBe('smpte2084')
    expect(after('-force_key_frames')).toBe(
      `expr:gte(t,n_forced*${SEGMENT_SECONDS})`
    )
    expect(args.at(-1)).toBe('/tmp/dv/ffmpeg.m3u8')
  })

  it('nvenc 用 -cq 时带 -b:v 0（恒定质量，不被默认码率封顶）', () => {
    for (const [output, encoder] of [
      ['hdr10', 'hevc_nvenc'],
      ['sdr', 'h264_nvenc'],
    ] as const) {
      const args = buildEncoderArgs(output, encoder)
      expect(args).toContain('-cq')
      expect(args[args.indexOf('-b:v') + 1]).toBe('0')
    }
  })

  it('HDR10 输出的 x265 参数带母版显示与内容亮度元数据', () => {
    const args = buildEncoderArgs('hdr10', 'libx265')
    const params = args[args.indexOf('-x265-params') + 1]
    expect(params).toContain(`master-display=${HDR10_MASTER_DISPLAY}`)
    expect(params).toContain(`max-cll=${HDR10_MAX_CLL}`)
    expect(params).toContain('hdr10=1')
  })
})

describe('渲染层规则', () => {
  it('开播前识别：P5 要重建，P8.1 / SDR / 读不到直接播', () => {
    expect(needsRebuild(P5)).toBe(true)
    expect(needsRebuild(P81)).toBe(false)
    expect(needsRebuild({ hdr: 'sdr', needsRpuRebuild: false })).toBe(false)
    expect(needsRebuild(null)).toBe(false)
  })

  it('媒体库已存动态范围时直接决定，不知道才识别', () => {
    expect(knownNeedsRebuild({ dvProfile: 5, dvCompat: 0 })).toBe(true)
    expect(knownNeedsRebuild({ dvProfile: 8, dvCompat: 1 })).toBe(false)
    expect(knownNeedsRebuild({ dvProfile: 7, dvCompat: 6 })).toBe(false)
    expect(knownNeedsRebuild({ dvProfile: null, dvCompat: null })).toBe(false)
    expect(knownNeedsRebuild(null)).toBeUndefined()
    expect(knownNeedsRebuild(undefined)).toBeUndefined()
  })

  it('HDR 显示器且能解 HEVC Main10 才出 HDR10，否则 SDR', () => {
    expect(chooseOutput({ hdrDisplay: true, hevcMain10: true })).toBe('hdr10')
    expect(chooseOutput({ hdrDisplay: true, hevcMain10: false })).toBe('sdr')
    expect(chooseOutput({ hdrDisplay: false, hevcMain10: true })).toBe('sdr')
  })

  it('主进程开播结果 → 计划：stream 应用内播，fallback 带原因', () => {
    const url = 'http://127.0.0.1:1/t/index.m3u8'
    expect(planFromStart({ kind: 'stream', id: 'a', url })).toEqual({
      kind: 'stream',
      id: 'a',
      url,
    })
    expect(planFromStart({ kind: 'fallback', reason: '无 Vulkan' })).toEqual({
      kind: 'fallback',
      reason: '无 Vulkan',
    })
  })

  it('重建做不了：设置开着且有 mpv 才转 mpv，否则直接播（并提示色彩）', () => {
    expect(dvFallback({ autoMpv: true, mpvBridge: true })).toBe('mpv')
    expect(dvFallback({ autoMpv: true, mpvBridge: false })).toBe('direct')
    expect(dvFallback({ autoMpv: false, mpvBridge: true })).toBe('direct')
  })

  it('本机流前缀只认 127.0.0.1，取到令牌目录为止', () => {
    expect(localStreamPrefix('http://127.0.0.1:5123/abc/index.m3u8')).toBe(
      'http://127.0.0.1:5123/abc/'
    )
    expect(localStreamPrefix('http://10.0.0.2:5123/abc/index.m3u8')).toBe('')
    expect(localStreamPrefix('https://cdn.example.com/a/index.m3u8')).toBe('')
  })
})

describe('HLS 播放列表与分片调度', () => {
  it('完整 VOD：每段 4 秒，末段取余数，带 init.mp4 与 ENDLIST', () => {
    const text = buildVodPlaylist(10.5)
    expect(segmentCount(10.5)).toBe(3)
    expect(text).toContain('#EXT-X-PLAYLIST-TYPE:VOD')
    expect(text).toContain('#EXT-X-MAP:URI="init.mp4"')
    expect(text.match(/#EXTINF:/g)).toHaveLength(3)
    expect(text).toContain('#EXTINF:2.500,\nseg00002.m4s')
    expect(text.trimEnd().endsWith('#EXT-X-ENDLIST')).toBe(true)
    expect(segmentCount(8)).toBe(2)
  })

  it('只认 index.m3u8 / init.mp4 / segNNNNN.m4s', () => {
    expect(parseRequestName('index.m3u8')).toEqual({ kind: 'playlist' })
    expect(parseRequestName('init.mp4')).toEqual({ kind: 'init' })
    expect(parseRequestName('seg00012.m4s')).toEqual({
      kind: 'segment',
      index: 12,
    })
    expect(parseRequestName('../secret')).toBeNull()
    expect(parseRequestName('seg12.m4s')).toBeNull()
  })

  it('拖动：编好的直接给，前沿附近等，往回拖或拖远了重启', () => {
    const ready = new Set([10, 11, 12])
    const running = { runningFrom: 10, ready }
    expect(planSegment(running, 11)).toBe('serve')
    expect(planSegment(running, 13)).toBe('wait')
    expect(planSegment(running, 16)).toBe('wait')
    expect(planSegment(running, 17)).toBe('restart')
    expect(planSegment(running, 3)).toBe('restart')
    expect(planSegment({ runningFrom: null, ready }, 13)).toBe('restart')
  })

  it('一轮编完后追近了从前沿续编；旧分片按播放位置清理', () => {
    const paused = { runningFrom: null, ready: new Set([20, 21, 22, 23]) }
    expect(resumeFrom(paused, 20, 100)).toBe(24)
    expect(resumeFrom(paused, 20, 24)).toBeNull()
    expect(resumeFrom({ ...paused, runningFrom: 20 }, 20, 100)).toBeNull()
    expect(prunable(new Set([0, 1, 30, 40]), 40)).toEqual([0, 1])
  })
})

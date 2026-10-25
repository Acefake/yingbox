/**
 * 杜比视界开播前识别（src/main/dolby-vision/probe.ts）：动态范围与媒体库共用 shared/video-range 的解析
 * （各 profile 的判定见 video-range.test.ts），这里只测本模块多出的部分——
 * 参数必须带 -show_streams 与 -show_format、片长取 format（mkv 视频流没有 duration）、宽高、
 * JSON 只从 stdout 取、没探测成功返回 undefined（调用方不缓存）、没有视频流返回 null。
 */
import { describe, expect, it } from 'vitest'

import {
  FFPROBE_ARGS,
  parseRebuildProbe,
  probeForRebuild,
} from '../src/main/dolby-vision/probe'
import type { DvToolResult } from '../src/main/dolby-vision/tool'
import { parseFfprobeVideo } from '../src/shared/video-range'

/** 拼一份 ffprobe -show_streams -show_format 的 JSON。 */
function ffprobeJson(
  stream: Record<string, unknown>,
  format: Record<string, unknown> = { duration: '7200.040000' }
): string {
  return JSON.stringify({
    streams: [
      {
        index: 0,
        codec_name: 'hevc',
        codec_type: 'video',
        width: 3840,
        height: 2160,
        ...stream,
      },
    ],
    format,
  })
}

const P5_SIDE_DATA = {
  side_data_list: [
    {
      side_data_type: 'DOVI configuration record',
      dv_profile: 5,
      dv_level: 6,
      rpu_present_flag: 1,
      el_present_flag: 0,
      bl_present_flag: 1,
      dv_bl_signal_compatibility_id: 0,
    },
  ],
}

describe('parseRebuildProbe', () => {
  it('Profile 5：动态范围与媒体库的解析结果一致，另带片长与宽高', () => {
    const text = ffprobeJson(P5_SIDE_DATA)
    expect(parseRebuildProbe(text)).toEqual({
      video: parseFfprobeVideo(JSON.parse(text)),
      duration: 7200.04,
      width: 3840,
      height: 2160,
    })
    expect(parseRebuildProbe(text)?.video).toEqual({
      range: 'dv',
      dvProfile: 5,
      dvCompat: 0,
    })
  })

  it('片长：format 没有时取视频流的 duration；都没有时不带', () => {
    expect(
      parseRebuildProbe(ffprobeJson({ duration: '61.5' }, {}))?.duration
    ).toBe(61.5)
    expect(parseRebuildProbe(ffprobeJson({}, {}))).not.toHaveProperty(
      'duration'
    )
  })

  it('跳过封面图流；没有视频流为 null；JSON 坏了为 undefined', () => {
    const cover = JSON.stringify({
      streams: [
        { codec_type: 'video', disposition: { attached_pic: 1 }, width: 600 },
        { codec_type: 'video', width: 1920, height: 1080 },
      ],
      format: { duration: '10' },
    })
    expect(parseRebuildProbe(cover)).toMatchObject({ width: 1920 })
    expect(parseRebuildProbe('{"streams":[]}')).toBeNull()
    expect(parseRebuildProbe('{"streams":[')).toBeUndefined()
  })
})

describe('probeForRebuild', () => {
  const ok = (stdout: string, stderr = ''): DvToolResult => ({
    code: 0,
    stdout,
    stderr,
  })

  it('参数带 -show_streams（DOVI 记录在 side data 里）与 -show_format（片长），文件路径接在最后', async () => {
    const calls: string[][] = []
    const info = await probeForRebuild(
      '/m/a.mkv',
      'ffprobe',
      async (_, args) => {
        calls.push([...args])
        return ok(ffprobeJson(P5_SIDE_DATA))
      }
    )
    expect(calls[0]).toEqual([...FFPROBE_ARGS, '/m/a.mkv'])
    expect(FFPROBE_ARGS).toContain('-show_streams')
    expect(FFPROBE_ARGS).toContain('-show_format')
    expect(FFPROBE_ARGS).not.toContain('-show_entries')
    expect(info?.video.dvProfile).toBe(5)
  })

  it('stderr 里带花括号的日志不影响解析（只读 stdout）', async () => {
    const info = await probeForRebuild('/m/a.mkv', 'ffprobe', async () =>
      ok(ffprobeJson(P5_SIDE_DATA), '[hevc @ 0x1] Invalid NAL unit {skipped}\n')
    )
    expect(info?.video.range).toBe('dv')
  })

  it('ffprobe 不在 / 超时 / 输出被截断：undefined（没探测成功）；没有视频流：null', async () => {
    expect(
      await probeForRebuild('/m/a.mkv', 'ffprobe', async () => ({
        code: -1,
        stdout: '',
        stderr: '',
        error: 'ENOENT',
      }))
    ).toBeUndefined()
    expect(
      await probeForRebuild('/m/a.mkv', 'ffprobe', async () => ({
        code: -2,
        stdout: '',
        stderr: '',
      }))
    ).toBeUndefined()
    const full = ffprobeJson(P5_SIDE_DATA)
    expect(
      await probeForRebuild('/m/a.mkv', 'ffprobe', async () =>
        ok(full.slice(0, full.length - 10))
      )
    ).toBeUndefined()
    expect(
      await probeForRebuild('/m/a.mkv', 'ffprobe', async () =>
        ok('{"streams":[]}')
      )
    ).toBeNull()
  })
})

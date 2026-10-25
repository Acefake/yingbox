/**
 * 杜比视界识别：ffprobe JSON 解析（P5 / P8.1 / P8.2 / P8.4 / P7 / SDR / HDR10）、限定字段输出的缺失，
 * 以及 probeVideoHdr：参数必须是 -show_streams，JSON 只从 stdout 取，没探测成功返回 undefined（不缓存）。
 */
import { describe, expect, it } from 'vitest'

import { FFPROBE_ARGS, parseFfprobeJson } from '../src/main/dolby-vision/probe'
import { type DvToolResult, probeVideoHdr } from '../src/main/dolby-vision/tool'

/** 拼一份 ffprobe -show_streams -show_format 的 JSON。 */
function ffprobeJson(
  stream: Record<string, unknown>,
  duration = '7200.040000'
): string {
  return JSON.stringify({
    streams: [
      {
        index: 0,
        codec_name: 'hevc',
        codec_type: 'video',
        width: 3840,
        height: 2160,
        pix_fmt: 'yuv420p10le',
        ...stream,
      },
    ],
    format: { duration },
  })
}

const dovi = (
  profile: number,
  compat: number,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  side_data_type: 'DOVI configuration record',
  dv_version_major: 1,
  dv_version_minor: 0,
  dv_profile: profile,
  dv_level: 6,
  rpu_present_flag: 1,
  el_present_flag: 0,
  bl_present_flag: 1,
  dv_bl_signal_compatibility_id: compat,
  ...extra,
})

describe('parseFfprobeJson', () => {
  it('Profile 5（compat id 0）：杜比视界、需要重建 RPU、没有可直接显示的基础层', () => {
    const info = parseFfprobeJson(ffprobeJson({ side_data_list: [dovi(5, 0)] }))
    expect(info).toMatchObject({
      hdr: 'dolby-vision',
      doviLabel: 'Profile 5',
      needsRpuRebuild: true,
      width: 3840,
      height: 2160,
      duration: 7200.04,
    })
    expect(info?.dovi).toEqual({
      profile: 5,
      level: 6,
      rpu: true,
      el: false,
      bl: true,
      compatId: 0,
    })
    expect(info?.baseLayer).toBeUndefined()
  })

  it('Profile 8.1：基础层是 HDR10，不需要重建', () => {
    const info = parseFfprobeJson(
      ffprobeJson({
        color_transfer: 'smpte2084',
        color_primaries: 'bt2020',
        side_data_list: [
          { side_data_type: 'Mastering display metadata' },
          dovi(8, 1),
        ],
      })
    )
    expect(info).toMatchObject({
      hdr: 'dolby-vision',
      doviLabel: 'Profile 8.1',
      needsRpuRebuild: false,
      baseLayer: 'hdr10',
    })
  })

  it('Profile 8.2（compat id 2）：基础层是 SDR；Profile 8.4（compat id 4）：基础层是 HLG', () => {
    expect(
      parseFfprobeJson(
        ffprobeJson({ color_transfer: 'bt709', side_data_list: [dovi(8, 2)] })
      )
    ).toMatchObject({
      hdr: 'dolby-vision',
      doviLabel: 'Profile 8.2',
      needsRpuRebuild: false,
      baseLayer: 'sdr',
    })
    expect(
      parseFfprobeJson(
        ffprobeJson({
          color_transfer: 'arib-std-b67',
          side_data_list: [dovi(8, 4)],
        })
      )
    ).toMatchObject({
      hdr: 'dolby-vision',
      doviLabel: 'Profile 8.4',
      needsRpuRebuild: false,
      baseLayer: 'hlg',
    })
  })

  it('Profile 7 双层（带增强层，compat id 6）：记录 Profile，基础层按 HDR10', () => {
    const info = parseFfprobeJson(
      ffprobeJson({
        color_transfer: 'smpte2084',
        side_data_list: [dovi(7, 6, { el_present_flag: 1 })],
      })
    )
    expect(info).toMatchObject({
      hdr: 'dolby-vision',
      doviLabel: 'Profile 7',
      needsRpuRebuild: false,
      baseLayer: 'hdr10',
    })
    expect(info?.dovi?.el).toBe(true)
  })

  it('没有 side data 的 SDR', () => {
    expect(
      parseFfprobeJson(ffprobeJson({ color_transfer: 'bt709' }))
    ).toMatchObject({ hdr: 'sdr', needsRpuRebuild: false })
  })

  it('HDR10 没有杜比视界；HLG 按传输特性识别', () => {
    expect(
      parseFfprobeJson(
        ffprobeJson({
          color_transfer: 'smpte2084',
          side_data_list: [
            { side_data_type: 'Mastering display metadata' },
            { side_data_type: 'Content light level metadata' },
          ],
        })
      )
    ).toEqual({
      hdr: 'hdr10',
      needsRpuRebuild: false,
      width: 3840,
      height: 2160,
      duration: 7200.04,
    })
    expect(
      parseFfprobeJson(ffprobeJson({ color_transfer: 'arib-std-b67' }))?.hdr
    ).toBe('hlg')
  })

  it('-show_entries 限定字段的输出没有 side_data_list：P5 会被误判成 SDR（所以必须用 -show_streams）', () => {
    // 同一个 P5 文件用 `-show_entries stream=codec_type,width,height` 得到的输出
    const restricted = JSON.stringify({
      programs: [],
      streams: [{ codec_type: 'video', width: 3840, height: 2160 }],
    })
    expect(parseFfprobeJson(restricted)).toMatchObject({
      hdr: 'sdr',
      needsRpuRebuild: false,
    })
    expect(FFPROBE_ARGS).toContain('-show_streams')
    expect(FFPROBE_ARGS).not.toContain('-show_entries')
  })

  it('跳过封面图流；没有视频流或 JSON 坏了返回 null', () => {
    const json = JSON.stringify({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'mjpeg',
          disposition: { attached_pic: 1 },
        },
        {
          codec_type: 'video',
          codec_name: 'hevc',
          side_data_list: [dovi(5, 0)],
        },
      ],
    })
    expect(parseFfprobeJson(json)?.doviLabel).toBe('Profile 5')
    expect(parseFfprobeJson('{"streams":[]}')).toBeNull()
    expect(parseFfprobeJson('not json')).toBeNull()
  })

  it('字段是字符串时也能读（部分 ffprobe 版本）', () => {
    const info = parseFfprobeJson(
      ffprobeJson({ side_data_list: [dovi(5, 0, { dv_profile: '5' })] })
    )
    expect(info?.dovi?.profile).toBe(5)
  })
})

describe('probeVideoHdr', () => {
  const ok = (stdout: string, stderr = ''): DvToolResult => ({
    code: 0,
    stdout,
    stderr,
  })

  it('用 FFPROBE_ARGS + 文件路径调 ffprobe，解析 stdout', async () => {
    const calls: string[][] = []
    const info = await probeVideoHdr('/m/a.mkv', 'ffprobe', async (_, args) => {
      calls.push([...args])
      return ok(ffprobeJson({ side_data_list: [dovi(5, 0)] }))
    })
    expect(calls[0]).toEqual([...FFPROBE_ARGS, '/m/a.mkv'])
    expect(info?.needsRpuRebuild).toBe(true)
  })

  it('stderr 里带花括号的日志不影响解析（只读 stdout）', async () => {
    const info = await probeVideoHdr('/m/a.mkv', 'ffprobe', async () =>
      ok(
        ffprobeJson({ side_data_list: [dovi(5, 0)] }),
        '[hevc @ 0x1] Invalid NAL unit {skipped}\n'
      )
    )
    expect(info?.doviLabel).toBe('Profile 5')
  })

  it('ffprobe 不在 / 超时 / 输出被截断：undefined（没探测成功）；没有视频流：null', async () => {
    expect(
      await probeVideoHdr('/m/a.mkv', 'ffprobe', async () => ({
        code: -1,
        stdout: '',
        stderr: '',
        error: 'ENOENT',
      }))
    ).toBeUndefined()
    expect(
      await probeVideoHdr('/m/a.mkv', 'ffprobe', async () => ({
        code: -2,
        stdout: '',
        stderr: '',
      }))
    ).toBeUndefined()
    const full = ffprobeJson({ side_data_list: [dovi(5, 0)] })
    expect(
      await probeVideoHdr('/m/a.mkv', 'ffprobe', async () =>
        ok(full.slice(0, full.length - 10))
      )
    ).toBeUndefined()
    expect(
      await probeVideoHdr('/m/a.mkv', 'ffprobe', async () =>
        ok('{"streams":[]}')
      )
    ).toBeNull()
  })
})

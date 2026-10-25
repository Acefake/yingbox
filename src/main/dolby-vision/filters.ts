/**
 * 杜比视界重建的 ffmpeg 参数（纯函数）：libplacebo 滤镜、编码器参数、HLS 分片参数。
 *
 * - HDR 输出：libplacebo 按 RPU 重建后输出 HDR10（bt2020nc / bt2020 / smpte2084），HEVC Main10 编码；
 * - SDR 输出：同一滤镜顺带色调映射到 bt709，H.264 8bit 编码（哪台机器都能解）；
 * - apply_dolbyvision 默认开，设置里可关（关了就只按基础层的色彩元数据转换）。
 */
import type { DvOutput } from '../../shared/dolby-vision'

/** 每个 HLS 分片的秒数：越短拖动后首帧越快，越长编码器开销越小 */
export const SEGMENT_SECONDS = 4
/**
 * 每轮编码最多编这么多段（约 3 分钟）就自己退出：暂停、缓冲满或切走窗口后不会一路编到片尾；
 * 播放位置追近已编好的前沿时再续编下一轮（见 playlist.ts 的 resumeFrom）。
 */
export const RUN_SEGMENTS = 45

/** 软件编码器跑不动 4K 实时：输出高度上限 */
const SOFTWARE_MAX_HEIGHT = 1080

/** 每种输出按优先级排列的编码器：硬件优先，最后是软件兜底。 */
export const ENCODER_CANDIDATES: Readonly<Record<DvOutput, readonly string[]>> =
  {
    hdr10: [
      'hevc_nvenc',
      'hevc_qsv',
      'hevc_amf',
      'hevc_videotoolbox',
      'libx265',
    ],
    sdr: ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox', 'libx264'],
  }

/** 是否软件编码器（决定要不要降分辨率、像素格式怎么给）。 */
export const isSoftwareEncoder = (encoder: string): boolean =>
  encoder.startsWith('lib')

/** 滤镜构造的输入。 */
export interface FilterOptions {
  output: DvOutput
  applyDolbyVision: boolean
  /** 片源尺寸；软件编码时据此把高度压到 1080 */
  width?: number
  height?: number
  encoder: string
}

/** 输出尺寸：硬件编码保持原尺寸；软件编码高度超过 1080 时等比缩小（宽取偶数）。 */
export function outputSize(
  options: Pick<FilterOptions, 'width' | 'height' | 'encoder'>
): { w: number; h: number } | null {
  const { width, height, encoder } = options
  if (!isSoftwareEncoder(encoder) || !width || !height) return null
  if (height <= SOFTWARE_MAX_HEIGHT) return null
  const w = Math.round((width * SOFTWARE_MAX_HEIGHT) / height / 2) * 2
  return { w, h: SOFTWARE_MAX_HEIGHT }
}

/**
 * libplacebo 滤镜链（-vf 的值）。
 * HDR 输出 10bit，SDR 输出 8bit；硬件编码器再接一个 format 转成它们吃的半平面格式（p010 / nv12）。
 */
export function buildVideoFilter(options: FilterOptions): string {
  const hdr = options.output === 'hdr10'
  const params = [
    `apply_dolbyvision=${options.applyDolbyVision ? 1 : 0}`,
    ...(hdr
      ? ['colorspace=bt2020nc', 'color_primaries=bt2020', 'color_trc=smpte2084']
      : [
          'colorspace=bt709',
          'color_primaries=bt709',
          'color_trc=bt709',
          'tonemapping=bt.2390',
        ]),
    'range=tv',
    `format=${hdr ? 'yuv420p10le' : 'yuv420p'}`,
  ]
  const size = outputSize(options)
  if (size) params.push(`w=${size.w}`, `h=${size.h}`)
  const chain = [`libplacebo=${params.join(':')}`]
  if (!isSoftwareEncoder(options.encoder))
    chain.push(`format=${hdr ? 'p010le' : 'nv12'}`)
  return chain.join(',')
}

/**
 * HDR10 输出的静态元数据（SMPTE ST 2086 母版显示 + 内容亮度）：按流媒体杜比视界最常见的
 * P3-D65 / 1000 尼特母版写进 x265 的 SEI，电视据此切 HDR10、映射高光（片源母版不同时以这组值为准）。
 * 写法为 x265 的 master-display（色度坐标 ×50000，亮度 ×10000）与 max-cll（MaxCLL,MaxFALL）。
 * 硬件编码器没有对应参数，靠 libplacebo 挂在输出帧上的 HDR 元数据（新版 ffmpeg 的硬件编码器会写进 SEI）。
 */
export const HDR10_MASTER_DISPLAY =
  'G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1)'
/** HDR10 输出的 MaxCLL,MaxFALL（尼特） */
export const HDR10_MAX_CLL = '1000,400'

/** 各编码器的速度 / 质量参数（实时优先）。 */
const ENCODER_TUNING: Readonly<Record<string, readonly string[]>> = {
  // -cq 要配 -b:v 0 才是恒定质量；不给时 nvenc 按默认码率封顶，4K 画质会糊
  hevc_nvenc: [
    '-preset',
    'p4',
    '-rc',
    'vbr',
    '-cq',
    '23',
    '-b:v',
    '0',
    '-profile:v',
    'main10',
  ],
  hevc_qsv: [
    '-preset',
    'faster',
    '-global_quality',
    '23',
    '-profile:v',
    'main10',
  ],
  hevc_amf: ['-quality', 'speed', '-profile:v', 'main10'],
  hevc_videotoolbox: ['-q:v', '65', '-profile:v', 'main10'],
  libx265: [
    '-preset',
    'ultrafast',
    '-crf',
    '22',
    '-x265-params',
    `hdr10=1:repeat-headers=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:master-display=${HDR10_MASTER_DISPLAY}:max-cll=${HDR10_MAX_CLL}`,
  ],
  h264_nvenc: [
    '-preset',
    'p4',
    '-rc',
    'vbr',
    '-cq',
    '21',
    '-b:v',
    '0',
    '-profile:v',
    'high',
  ],
  h264_qsv: [
    '-preset',
    'faster',
    '-global_quality',
    '21',
    '-profile:v',
    'high',
  ],
  h264_amf: ['-quality', 'speed', '-profile:v', 'high'],
  h264_videotoolbox: ['-q:v', '65', '-profile:v', 'high'],
  libx264: ['-preset', 'veryfast', '-crf', '20', '-profile:v', 'high'],
}

/** 编码参数：编码器 + 调速 + 色彩标记 + 每段开头强制关键帧（分片边界与播放列表严格对齐）。 */
export function buildEncoderArgs(output: DvOutput, encoder: string): string[] {
  const hdr = output === 'hdr10'
  return [
    '-c:v',
    encoder,
    ...(ENCODER_TUNING[encoder] ?? []),
    ...(hdr ? ['-tag:v', 'hvc1'] : []),
    '-color_primaries',
    hdr ? 'bt2020' : 'bt709',
    '-color_trc',
    hdr ? 'smpte2084' : 'bt709',
    '-colorspace',
    hdr ? 'bt2020nc' : 'bt709',
    '-force_key_frames',
    `expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
  ]
}

/** 一次编码的输入。 */
export interface TranscodeArgsInput extends FilterOptions {
  input: string
  /** 从第几个分片开始编（拖动后重启时 > 0） */
  startIndex: number
  /** 分片目录（init.mp4、seg00000.m4s、ffmpeg 自己的播放列表都写在这里） */
  dir: string
  /** 路径拼接（主进程传 node:path 的 join，测试传 posix 拼接） */
  join: (...parts: string[]) => string
}

/** 分片文件名：seg + 5 位序号 + .m4s。 */
export const segmentFile = (index: number): string =>
  `seg${String(index).padStart(5, '0')}.m4s`

/**
 * 完整的 ffmpeg 参数：从 startIndex 段的起点开始，最多编 RUN_SEGMENTS 段，输出 fMP4 HLS 分片。
 * 时间戳按 -output_ts_offset 平移到片内绝对时间，播放器拿到的是同一条完整时间轴。
 * 音频统一转 AAC 双声道（Chromium 不解 AC3 / E-AC3 / TrueHD）。
 */
export function buildTranscodeArgs(input: TranscodeArgsInput): string[] {
  const offset = (input.startIndex * SEGMENT_SECONDS).toFixed(3)
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-ss',
    offset,
    '-i',
    input.input,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-vf',
    buildVideoFilter(input),
    ...buildEncoderArgs(input.output, input.encoder),
    '-c:a',
    'aac',
    '-ac',
    '2',
    '-b:a',
    '192k',
    '-t',
    String(RUN_SEGMENTS * SEGMENT_SECONDS),
    '-output_ts_offset',
    offset,
    '-f',
    'hls',
    '-hls_time',
    String(SEGMENT_SECONDS),
    '-hls_segment_type',
    'fmp4',
    '-hls_fmp4_init_filename',
    'init.mp4',
    '-hls_flags',
    'temp_file+independent_segments',
    '-hls_list_size',
    '0',
    '-start_number',
    String(input.startIndex),
    '-hls_segment_filename',
    input.join(input.dir, 'seg%05d.m4s'),
    input.join(input.dir, 'ffmpeg.m3u8'),
  ]
}

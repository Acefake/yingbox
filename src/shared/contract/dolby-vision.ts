import type {
  DvStartRequest,
  DvStartResult,
  VideoHdrInfo,
} from '../dolby-vision'
import {
  bool,
  call,
  defineDomain,
  num,
  oneOf,
  optStr,
  record,
  str,
} from './define'

/** 开播请求的边界校验：路径字符串、输出 hdr10 / sdr、开关布尔、起播位置可选数字。 */
function parseStart(value: unknown): [DvStartRequest] {
  const raw = record<Partial<DvStartRequest>>(value, 'request')
  return [
    {
      filePath: str(raw.filePath, 'request.filePath'),
      output: oneOf(raw.output, 'request.output', ['hdr10', 'sdr'] as const),
      applyDolbyVision: bool(raw.applyDolbyVision, 'request.applyDolbyVision'),
      ...(raw.startAt == null
        ? {}
        : { startAt: Math.max(0, num(raw.startAt, 'request.startAt')) }),
    },
  ]
}

/**
 * 杜比视界应用内播放：识别本地文件的 HDR / DV Profile，P5 经 libplacebo 重建成 HLS 交给内置播放器。
 * 本机做不了（没有 Vulkan、ffmpeg 不含 libplacebo 等，能力探测在 start 里按需进行）时 start 返回 fallback，
 * 渲染层按设置改用 mpv 或直接播放并提示。
 */
export const dolbyVision = defineDomain('dolbyVision', {
  /** 识别本地文件的 HDR 类型与杜比视界 Profile（ffprobe 读文件头，成功的结果按文件缓存）；读不到为 null */
  probe: call<[filePath: string], VideoHdrInfo | null>(a => [
    str(a[0], 'filePath'),
  ]),
  /** 开一路重建播放（同一时间只有一路，开新的会停旧的） */
  start: call<[request: DvStartRequest], DvStartResult>(a => parseStart(a[0])),
  /** 停止播放会话；不给 id 停当前的 */
  stop: call<[id?: string], boolean>(a => [optStr(a[0], 'id')]),
})

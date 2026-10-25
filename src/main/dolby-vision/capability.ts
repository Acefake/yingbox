/**
 * 本机能不能在应用内重建杜比视界：ffmpeg 在不在、带不带 libplacebo、Vulkan 能不能初始化、有没有能用的编码器。
 *
 * 全部异步（不卡主进程）。`-filters` 与 `-encoders` 并行列出，候选编码器先按 `-encoders` 过滤，
 * 再并行各试编 1 帧，按优先级取第一个成功的；最坏约 LIST + VULKAN + TRIAL 三段超时之和（二十来秒）。
 * 只探测这次要的输出（想要 HDR10 时连同兜底的 SDR 一起探）。
 *
 * 结果按 ffmpeg 路径 + 输出缓存：确定的结论（没有 ffmpeg、不含 libplacebo、Vulkan 不可用、没有编码器）
 * 整次运行只探一次，用户在设置里改了工具路径时作废（见 index.ts）；
 * 超时、ffmpeg 跑不起来这类可能是一时的失败，以及探测本身抛错，都不缓存，下次开播重探。
 */
import type { DvOutput } from '../../shared/dolby-vision'

import { ENCODER_CANDIDATES } from './filters'
import { TOOL_SPAWN_FAILED, TOOL_TIMED_OUT, type ToolRunner } from './tool'

/** `-filters` / `-encoders` 列表的时限 */
const LIST_TIMEOUT_MS = 10_000
/** 1 帧 Vulkan 试跑的时限（坏驱动可能卡在初始化） */
const VULKAN_TIMEOUT_MS = 8_000
/** 1 帧编码器试跑的时限（各候选并行跑） */
const TRIAL_TIMEOUT_MS = 5_000

/** 探测失败的原因。 */
export type DvCapabilityFailure =
  | 'no-ffmpeg'
  | 'no-libplacebo'
  | 'no-vulkan'
  | 'no-encoder'
  | 'timeout'
  | 'ffmpeg-error'

/** 本机能力：能重建时给出每种输出可用的编码器。 */
export type DvCapability =
  | { ok: true; ffmpeg: string; encoders: Partial<Record<DvOutput, string>> }
  | { ok: false; reason: DvCapabilityFailure; message: string }

/** 可能是一时的失败：不缓存，下次重探。 */
const TRANSIENT: ReadonlySet<DvCapabilityFailure> = new Set([
  'timeout',
  'ffmpeg-error',
])

/** ffmpeg 列表输出（`-filters` / `-encoders`）里第二列的名字集合（行形如 ` ..C libplacebo  N->V  …`）。 */
export function listedNames(listOutput: string): Set<string> {
  return new Set(
    listOutput
      .split('\n')
      .map(line => line.trim().split(/\s+/)[1])
      .filter((name): name is string => Boolean(name))
  )
}

/** `ffmpeg -hide_banner -filters` 的输出里有没有 libplacebo 滤镜。 */
export const hasLibplaceboFilter = (filtersOutput: string): boolean =>
  listedNames(filtersOutput).has('libplacebo')

/** 1 帧 Vulkan 初始化探测：libplacebo 处理一帧黑场，不输出文件；退出码 0 才算 Vulkan 可用。 */
export const VULKAN_TRIAL_ARGS: readonly string[] = [
  '-hide_banner',
  '-nostdin',
  '-loglevel',
  'error',
  '-f',
  'lavfi',
  '-i',
  'color=c=black:s=64x64:d=0.1',
  '-frames:v',
  '1',
  '-vf',
  'libplacebo=w=64:h=64:apply_dolbyvision=1:format=yuv420p',
  '-f',
  'null',
  '-',
]

/** 试跑用的像素格式：软件编码器吃平面格式，硬件编码器吃半平面格式（与 filters.ts 的滤镜链一致）。 */
const TRIAL_PIX_FMT: Readonly<Record<string, string>> = {
  'sw-hdr10': 'yuv420p10le',
  'sw-sdr': 'yuv420p',
  'hw-hdr10': 'p010le',
  'hw-sdr': 'nv12',
}

/** 1 帧编码器试跑：HDR 用 10bit 输入，SDR 用 8bit；硬件编码器缺卡 / 缺驱动时在这里失败。 */
export function encoderTrialArgs(output: DvOutput, encoder: string): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=black:s=256x256:d=0.1',
    '-frames:v',
    '1',
    '-pix_fmt',
    TRIAL_PIX_FMT[`${encoder.startsWith('lib') ? 'sw' : 'hw'}-${output}`],
    '-c:v',
    encoder,
    '-f',
    'null',
    '-',
  ]
}

/** 失败原因 → 给人看的一句话（回退时的提示）。 */
export const CAPABILITY_MESSAGES: Readonly<
  Record<DvCapabilityFailure, string>
> = {
  'no-ffmpeg': '没有找到 ffmpeg，无法在应用内重建杜比视界',
  'no-libplacebo': '当前 ffmpeg 不含 libplacebo，无法在应用内重建杜比视界',
  'no-vulkan': '本机 Vulkan 不可用，无法在应用内重建杜比视界',
  'no-encoder': '没有可用的视频编码器，无法在应用内重建杜比视界',
  timeout: 'ffmpeg 探测超时，这次无法在应用内重建杜比视界',
  'ffmpeg-error': 'ffmpeg 运行失败，这次无法在应用内重建杜比视界',
}

const fail = (reason: DvCapabilityFailure): DvCapability => ({
  ok: false,
  reason,
  message: CAPABILITY_MESSAGES[reason],
})

/** 列表命令的结果 → 失败原因；正常返回 null。 */
function listFailure(r: {
  code: number
  error?: string
}): DvCapabilityFailure | null {
  if (r.code === 0) return null
  if (r.code === TOOL_SPAWN_FAILED && r.error === 'ENOENT') return 'no-ffmpeg'
  if (r.code === TOOL_TIMED_OUT) return 'timeout'
  return 'ffmpeg-error'
}

/** 想要某种输出时要探测哪些输出：HDR10 带上兜底的 SDR。 */
export const outputsFor = (wanted: DvOutput): DvOutput[] =>
  wanted === 'hdr10' ? ['hdr10', 'sdr'] : ['sdr']

/** 并行试跑 ffmpeg 列出的候选编码器，按优先级取第一个成功的；都不行返回 undefined。 */
async function firstWorkingEncoder(
  run: ToolRunner,
  ffmpeg: string,
  output: DvOutput,
  available: ReadonlySet<string>
): Promise<string | undefined> {
  const candidates = ENCODER_CANDIDATES[output].filter(e => available.has(e))
  const codes = await Promise.all(
    candidates.map(async encoder => {
      const r = await run(
        ffmpeg,
        encoderTrialArgs(output, encoder),
        TRIAL_TIMEOUT_MS
      )
      return r.code
    })
  )
  return candidates.find((_, i) => codes[i] === 0)
}

/**
 * 探测：ffmpeg 列表（libplacebo 滤镜 + 编码器）→ Vulkan 1 帧试跑 → 各输出第一个能用的编码器。
 * 任何一步失败就给出对应原因；要探的输出都没有编码器才算 no-encoder。
 * @param outputs 要探测的输出（见 outputsFor）
 */
export async function detectCapability(
  ffmpeg: string,
  run: ToolRunner,
  outputs: readonly DvOutput[] = ['hdr10', 'sdr']
): Promise<DvCapability> {
  if (!ffmpeg) return fail('no-ffmpeg')
  const [filters, encoderList] = await Promise.all([
    run(ffmpeg, ['-hide_banner', '-filters'], LIST_TIMEOUT_MS),
    run(ffmpeg, ['-hide_banner', '-encoders'], LIST_TIMEOUT_MS),
  ])
  const listed = listFailure(filters) ?? listFailure(encoderList)
  if (listed) return fail(listed)
  if (!hasLibplaceboFilter(filters.stdout)) return fail('no-libplacebo')
  const vulkan = await run(ffmpeg, VULKAN_TRIAL_ARGS, VULKAN_TIMEOUT_MS)
  if (vulkan.code === TOOL_TIMED_OUT) return fail('timeout')
  if (vulkan.code !== 0) return fail('no-vulkan')
  const available = listedNames(encoderList.stdout)
  const found = await Promise.all(
    outputs.map(output => firstWorkingEncoder(run, ffmpeg, output, available))
  )
  const encoders: Partial<Record<DvOutput, string>> = {}
  outputs.forEach((output, i) => {
    if (found[i]) encoders[output] = found[i]
  })
  if (!Object.keys(encoders).length) return fail('no-encoder')
  return { ok: true, ffmpeg, encoders }
}

/**
 * 实际用哪种输出：想要 HDR10 但没有 10bit HEVC 编码器时退到 SDR（仍是正确色彩，只是色调映射过）。
 * @returns 输出与编码器；一个都没有返回 null
 */
export function pickOutput(
  capability: Extract<DvCapability, { ok: true }>,
  wanted: DvOutput
): { output: DvOutput; encoder: string } | null {
  for (const output of outputsFor(wanted)) {
    const encoder = capability.encoders[output]
    if (encoder) return { output, encoder }
  }
  return null
}

/** 能力缓存：同一个 ffmpeg + 输出只探测一次，并发调用共用同一次探测。 */
export interface CapabilityCache {
  get(ffmpeg: string, wanted: DvOutput): Promise<DvCapability>
  invalidate(): void
}

/** 建能力缓存（确定的结论才留下，见文件头）。 */
export function createCapabilityCache(run: ToolRunner): CapabilityCache {
  const cache = new Map<string, Promise<DvCapability>>()
  return {
    get(ffmpeg, wanted) {
      const outputs = outputsFor(wanted)
      const key = `${ffmpeg}\n${outputs.join(',')}`
      const cached = cache.get(key)
      if (cached) return cached
      const forget = (): void => {
        if (cache.get(key) === pending) cache.delete(key)
      }
      const pending: Promise<DvCapability> = detectCapability(
        ffmpeg,
        run,
        outputs
      ).then(
        result => {
          if (!result.ok && TRANSIENT.has(result.reason)) forget()
          return result
        },
        error => {
          forget()
          console.error('[dolby-vision] 能力探测出错：', error)
          return fail('ffmpeg-error')
        }
      )
      cache.set(key, pending)
      return pending
    },
    invalidate() {
      cache.clear()
    },
  }
}

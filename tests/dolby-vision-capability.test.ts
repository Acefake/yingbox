/**
 * 杜比视界能力探测：各失败原因（没有 ffmpeg / 超时 / 不含 libplacebo / Vulkan / 没有编码器）、
 * 候选编码器按 -encoders 过滤后并行试跑、只探这次要的输出、缓存哪些结论（超时与抛错不缓存）、选输出。
 */
import { describe, expect, it } from 'vitest'

import {
  CAPABILITY_MESSAGES,
  type DvCapability,
  VULKAN_TRIAL_ARGS,
  createCapabilityCache,
  detectCapability,
  hasLibplaceboFilter,
  pickOutput,
} from '../src/main/dolby-vision/capability'
import {
  type DvToolResult,
  TOOL_SPAWN_FAILED,
  TOOL_TIMED_OUT,
  type ToolRunner,
} from '../src/main/dolby-vision/tool'

const FILTERS_WITH = ' ..C libplacebo        N->V       Apply GPU filters\n'
const FILTERS_WITHOUT = ' ... scale             V->V       Scale\n'
/** `ffmpeg -encoders` 的输出：列出全部候选 */
const ALL_ENCODERS = [
  'hevc_nvenc',
  'hevc_qsv',
  'hevc_amf',
  'hevc_videotoolbox',
  'libx265',
  'h264_nvenc',
  'h264_qsv',
  'h264_amf',
  'h264_videotoolbox',
  'libx264',
]
  .map(name => ` V....D ${name}   encoder`)
  .join('\n')

const result = (code: number, stdout = '', error?: string): DvToolResult => ({
  code,
  stdout,
  stderr: '',
  ...(error ? { error } : {}),
})

/** 假的命令行：按参数特征回答，记下每次调用。 */
function fakeRunner(options: {
  filters?: string
  listCode?: number
  listError?: string
  encoderList?: string
  vulkan?: number
  encoders?: string[]
  throws?: boolean
}): ToolRunner & { calls: string[][] } {
  const calls: string[][] = []
  const run: ToolRunner = async (_bin, args) => {
    calls.push([...args])
    if (options.throws) throw new Error('boom')
    if (args.includes('-filters'))
      return options.listCode !== undefined
        ? result(options.listCode, '', options.listError)
        : result(0, options.filters ?? '')
    if (args.includes('-encoders'))
      return result(0, options.encoderList ?? ALL_ENCODERS)
    if (args.join(' ') === VULKAN_TRIAL_ARGS.join(' '))
      return result(options.vulkan ?? 0)
    const encoder = args[args.indexOf('-c:v') + 1]
    return result(options.encoders?.includes(encoder) ? 0 : 1)
  }
  return Object.assign(run, { calls })
}

/** 试跑过哪些编码器 */
const trialled = (calls: string[][]): string[] =>
  calls.filter(a => a.includes('-c:v')).map(a => a[a.indexOf('-c:v') + 1])

describe('能力探测', () => {
  it('ffmpeg -filters 的输出里认出 libplacebo', () => {
    expect(hasLibplaceboFilter(FILTERS_WITH)).toBe(true)
    expect(hasLibplaceboFilter(FILTERS_WITHOUT)).toBe(false)
  })

  it('没有 ffmpeg / 不含 libplacebo / Vulkan 试跑失败 / 没有编码器：各自的原因', async () => {
    expect(await detectCapability('', fakeRunner({}))).toMatchObject({
      ok: false,
      reason: 'no-ffmpeg',
    })
    expect(
      await detectCapability(
        'ffmpeg',
        fakeRunner({ listCode: TOOL_SPAWN_FAILED, listError: 'ENOENT' })
      )
    ).toMatchObject({ reason: 'no-ffmpeg' })
    expect(
      await detectCapability('ffmpeg', fakeRunner({ filters: FILTERS_WITHOUT }))
    ).toMatchObject({ reason: 'no-libplacebo' })
    expect(
      await detectCapability(
        'ffmpeg',
        fakeRunner({ filters: FILTERS_WITH, vulkan: 187 })
      )
    ).toMatchObject({
      reason: 'no-vulkan',
      message: CAPABILITY_MESSAGES['no-vulkan'],
    })
    expect(
      await detectCapability(
        'ffmpeg',
        fakeRunner({ filters: FILTERS_WITH, encoders: [] })
      )
    ).toMatchObject({ reason: 'no-encoder' })
  })

  it('列表超时报 timeout、起不来（非 ENOENT）报 ffmpeg-error，不误报没有 ffmpeg', async () => {
    const timedOut = await detectCapability(
      'ffmpeg',
      fakeRunner({ listCode: TOOL_TIMED_OUT })
    )
    expect(timedOut).toMatchObject({ reason: 'timeout' })
    expect(timedOut.ok ? '' : timedOut.message).toContain('超时')
    expect(
      await detectCapability(
        'ffmpeg',
        fakeRunner({ listCode: TOOL_SPAWN_FAILED, listError: 'EACCES' })
      )
    ).toMatchObject({ reason: 'ffmpeg-error' })
    expect(
      await detectCapability(
        'ffmpeg',
        fakeRunner({ filters: FILTERS_WITH, vulkan: TOOL_TIMED_OUT })
      )
    ).toMatchObject({ reason: 'timeout' })
  })

  it('都满足：每种输出取优先级最高的能用编码器（硬件优先，软件兜底）', async () => {
    const cap = await detectCapability(
      'ffmpeg',
      fakeRunner({ filters: FILTERS_WITH, encoders: ['libx265', 'h264_qsv'] })
    )
    expect(cap).toEqual({
      ok: true,
      ffmpeg: 'ffmpeg',
      encoders: { hdr10: 'libx265', sdr: 'h264_qsv' },
    })
  })

  it('只试跑 ffmpeg -encoders 列出的候选；只要 SDR 时不探 HEVC', async () => {
    const run = fakeRunner({
      filters: FILTERS_WITH,
      encoderList: ' V....D libx264   H.264\n V....D h264_nvenc  NVENC',
      encoders: ['libx264'],
    })
    const cap = await detectCapability('ffmpeg', run, ['sdr'])
    expect(cap).toMatchObject({ ok: true, encoders: { sdr: 'libx264' } })
    expect(trialled(run.calls).sort()).toEqual(['h264_nvenc', 'libx264'])
  })
})

describe('能力缓存', () => {
  it('同一个 ffmpeg + 输出只探测一次，作废后重探', async () => {
    const run = fakeRunner({ filters: FILTERS_WITH, encoders: ['libx264'] })
    const cache = createCapabilityCache(run)
    await Promise.all([cache.get('ffmpeg', 'sdr'), cache.get('ffmpeg', 'sdr')])
    const once = run.calls.length
    await cache.get('ffmpeg', 'sdr')
    expect(run.calls.length).toBe(once)
    cache.invalidate()
    await cache.get('ffmpeg', 'sdr')
    expect(run.calls.length).toBe(once * 2)
  })

  it('超时的结论不缓存，下次重探', async () => {
    const run = fakeRunner({ listCode: TOOL_TIMED_OUT })
    const cache = createCapabilityCache(run)
    await cache.get('ffmpeg', 'sdr')
    const once = run.calls.length
    await cache.get('ffmpeg', 'sdr')
    expect(run.calls.length).toBe(once * 2)
  })

  it('探测抛错时返回 ffmpeg-error，且不把失败留在缓存里', async () => {
    const run = fakeRunner({ throws: true })
    const cache = createCapabilityCache(run)
    expect(await cache.get('ffmpeg', 'sdr')).toMatchObject({
      ok: false,
      reason: 'ffmpeg-error',
    })
    const once = run.calls.length
    await cache.get('ffmpeg', 'sdr')
    expect(run.calls.length).toBeGreaterThan(once)
  })
})

describe('选输出', () => {
  const OK: Extract<DvCapability, { ok: true }> = {
    ok: true,
    ffmpeg: 'ffmpeg',
    encoders: { hdr10: 'hevc_nvenc', sdr: 'h264_nvenc' },
  }

  it('想要 HDR10 但只有 SDR 编码器时退到 SDR', () => {
    expect(
      pickOutput({ ...OK, encoders: { sdr: 'libx264' } }, 'hdr10')
    ).toEqual({ output: 'sdr', encoder: 'libx264' })
    expect(pickOutput(OK, 'sdr')).toEqual({
      output: 'sdr',
      encoder: 'h264_nvenc',
    })
    expect(pickOutput({ ...OK, encoders: { hdr10: 'libx265' } }, 'sdr')).toBe(
      null
    )
  })
})

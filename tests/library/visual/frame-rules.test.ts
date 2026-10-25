/**
 * 视频关键帧的纯规则：抽帧计划、相近帧去重、设置解析、ffmpeg 时长解析与取帧参数。
 */
import { describe, expect, it } from 'vitest'
import { CLIP_DIM } from '../../../src/main/library/visual/clip-encoder'
import { parseRpcParams } from '../../../src/shared/library/ipc'
import { frameArgs } from '../../../src/main/library/visual/frames/frame-ffmpeg'
import {
  DEFAULT_FRAME_SETTINGS,
  dedupeFrames,
  frameSignature,
  frameThumbKey,
  parseFfmpegDuration,
  parseFrameSettings,
  planFrames,
} from '../../../src/main/library/visual/frames/frame-rules'

/** 第 k 维为 a、第 k+1 维为 b 的向量（归一化前），用来造出相似度可控的帧。 */
function vec(k: number, a = 1, b = 0): Float32Array {
  const v = new Float32Array(CLIP_DIM)
  const n = Math.hypot(a, b)
  v[k] = a / n
  v[k + 1] = b / n
  return v
}

describe('抽帧计划', () => {
  it('每 30 秒一帧，从半个间隔处开始', () => {
    expect(planFrames(100)).toEqual([15_000, 45_000, 75_000])
    expect(planFrames(90)).toEqual([15_000, 45_000, 75_000])
  })

  it('超过上限时整片均匀铺开，每帧取区间中点', () => {
    const plan = planFrames(2 * 3600)
    expect(plan).toHaveLength(60)
    expect(plan[0]).toBe(60_000)
    expect(plan.at(-1)).toBe(7_140_000)
    expect(plan.every((t, i) => i === 0 || t > plan[i - 1]!)).toBe(true)
  })

  it('不到一个间隔的短片取中点一帧；时长未知不抽', () => {
    expect(planFrames(20)).toEqual([10_000])
    expect(planFrames(null)).toEqual([])
    expect(planFrames(0)).toEqual([])
    expect(planFrames(Number.NaN)).toEqual([])
  })

  it('间隔与上限可调', () => {
    expect(planFrames(60, 10, 3)).toEqual([10_000, 30_000, 50_000])
  })
})

describe('相近帧去重', () => {
  it('镜头不动的连续帧只留第一张，换镜头再留', () => {
    const frames = [vec(0), vec(0, 1, 0.1), vec(5), vec(5), vec(0)]
    expect(dedupeFrames(frames, null)).toEqual([0, 2, 4])
  })

  it('续跑时和上一批最后保留的帧比', () => {
    expect(dedupeFrames([vec(3), vec(4)], vec(3))).toEqual([1])
  })

  it('阈值以下都保留', () => {
    // 夹角约 45°，相似度 0.707
    expect(dedupeFrames([vec(0), vec(0, 1, 1)], null)).toEqual([0, 1])
    expect(dedupeFrames([vec(0), vec(0, 1, 1)], null, 0.7)).toEqual([0])
  })
})

describe('签名与缩略图 key', () => {
  it('模型、文件大小、修改时间任一变化签名都变', () => {
    const base = frameSignature('m', 100, 1000.4)
    expect(frameSignature('m', 100, 1000.9)).toBe(base)
    expect(frameSignature('m2', 100, 1000)).not.toBe(base)
    expect(frameSignature('m', 101, 1000)).not.toBe(base)
    expect(frameSignature('m', 100, 2000)).not.toBe(base)
  })

  it('缩略图 key 是 32 位十六进制，按文件、签名、时间点区分', () => {
    const key = frameThumbKey(1, 'sig', 15_000)
    expect(key).toMatch(/^[0-9a-f]{32}$/)
    expect(frameThumbKey(1, 'sig', 45_000)).not.toBe(key)
    expect(frameThumbKey(2, 'sig', 15_000)).not.toBe(key)
    expect(frameThumbKey(1, 'sig2', 15_000)).not.toBe(key)
  })
})

describe('设置与 ffmpeg 输出', () => {
  it('缺字段、坏 JSON 按缺省值补', () => {
    expect(parseFrameSettings(undefined)).toEqual(DEFAULT_FRAME_SETTINGS)
    expect(parseFrameSettings('{bad')).toEqual(DEFAULT_FRAME_SETTINGS)
    expect(parseFrameSettings('{"enabled":true,"paused":"x"}')).toEqual({
      enabled: true,
      paused: false,
      includeCloud: false,
    })
  })

  it('从 stderr 读时长', () => {
    expect(
      parseFfmpegDuration('  Duration: 01:02:03.50, start: 0.000000, bitrate')
    ).toBe(3723.5)
    expect(parseFfmpegDuration('Duration: N/A')).toBeNull()
    expect(parseFfmpegDuration('')).toBeNull()
  })

  it('取帧参数：输入端跳转、单线程、两路输出（原始像素到标准输出，小图到文件）', () => {
    const args = frameArgs('/v/a.mp4', 75, '/t/x.jpg')
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    expect(args[args.indexOf('-ss') + 1]).toBe('75.000')
    expect(args[args.indexOf('-threads') + 1]).toBe('1')
    expect(args).toContain('pipe:1')
    expect(args.at(-1)).toBe('/t/x.jpg')
    const graph = args[args.indexOf('-filter_complex') + 1]!
    expect(graph).toContain('scale=224:224')
    expect(graph).toContain('scale=240:-2')
  })
})

describe('visual.setFrames 参数', () => {
  it('只收布尔开关，忽略未知字段', () => {
    expect(
      parseRpcParams('visual.setFrames', { enabled: true, other: 1 })
    ).toEqual({ enabled: true })
    expect(parseRpcParams('visual.setFrames', undefined)).toEqual({})
    expect(() => parseRpcParams('visual.setFrames', { paused: 'yes' })).toThrow(
      /paused/
    )
  })
})

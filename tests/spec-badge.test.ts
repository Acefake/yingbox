/**
 * 规格标签的取值规则：动态范围 → 标签样式与文字，详情文件行的杜比视界 profile。
 */
import { describe, expect, it } from 'vitest'

import {
  videoProbeSpec,
  videoRangeSpec,
} from '../src/renderer/src/components/ui/spec-badge'

describe('规格标签', () => {
  it('杜比视界用 DOLBY VISION 字标，HDR10 / HLG 用实心小方块，SDR 与未知不显示', () => {
    expect(videoRangeSpec('dv')).toEqual({ variant: 'dolby', text: 'VISION' })
    expect(videoRangeSpec('hdr10')).toEqual({ variant: 'solid', text: 'HDR10' })
    expect(videoRangeSpec('hlg')).toEqual({ variant: 'solid', text: 'HLG' })
    expect(videoRangeSpec('sdr')).toBeNull()
    expect(videoRangeSpec(undefined)).toBeNull()
  })

  it('详情文件行：杜比视界另带 profile，profile 未知时只有字标', () => {
    expect(videoProbeSpec({ range: 'dv', dvProfile: 5, dvCompat: 0 })).toEqual({
      spec: { variant: 'dolby', text: 'VISION' },
      profile: 'P5',
    })
    expect(
      videoProbeSpec({ range: 'dv', dvProfile: null, dvCompat: null })
    ).toEqual({ spec: { variant: 'dolby', text: 'VISION' }, profile: '' })
    expect(
      videoProbeSpec({ range: 'hdr10', dvProfile: null, dvCompat: null })
    ).toEqual({ spec: { variant: 'solid', text: 'HDR10' }, profile: '' })
    expect(
      videoProbeSpec({ range: 'sdr', dvProfile: null, dvCompat: null })
    ).toBeNull()
    expect(videoProbeSpec(null)).toBeNull()
  })
})

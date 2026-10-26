/**
 * 规格标签的取值规则：动态范围 → 标签样式与文字，详情文件行的杜比视界 profile，
 * 发布名 / 文件名里的写法，片库条目（探测优先、文件名补充）。
 */
import { describe, expect, it } from 'vitest'

import {
  mediaSpecs,
  releaseSpecs,
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

  it('releaseSpecs：从分享标题 / 文件名认出分辨率、动态范围、音轨与中字', () => {
    const texts = (title: string): string[] =>
      releaseSpecs([title]).map(s => `${s.variant}:${s.text}`)
    expect(texts('三体 (2023) 4K 杜比视界 全30集 国语中字 腾讯版')).toEqual([
      'solid:4K',
      'dolby:VISION',
      'outline:中字',
    ])
    expect(
      texts('三体 3 Body Problem S01 2160p WEB-DL DDP5.1 Atmos 中英双字')
    ).toEqual(['solid:4K', 'dolby:ATMOS', 'outline:中字'])
    expect(texts('漫长的季节 (2023) 1080P 全12集')).toEqual(['outline:1080P'])
    expect(texts('繁花 2160p HDR DV 内封简繁')).toEqual([
      'solid:4K',
      'dolby:VISION',
      'outline:中字',
    ])
    expect(texts('封神第一部 HDR10 IMAX')).toEqual(['solid:HDR'])
    // DV 只认独立的词，不误认 DVD
    expect(texts('老电影 DVDRip')).toEqual([])
    // 点分隔的 Dolby.Vision 也认，且和 HDR 同时出现时只留杜比视界
    expect(texts('Dune.Part.Two.2024.2160p.Dolby.Vision.HDR.mkv')).toEqual([
      'solid:4K',
      'dolby:VISION',
    ])
    // HDRip 是片源标签，不是动态范围
    expect(texts('某电影.2019.1080p.HDRip.x264')).toEqual(['outline:1080P'])
    expect(texts('封神第一部 HDR10+')).toEqual(['solid:HDR'])
  })

  it('releaseSpecs：几段文字一起看；在线源备注的 4K / 1080P 也认；大小写不敏感', () => {
    const texts = (list: string[]): string[] =>
      releaseSpecs(list).map(s => `${s.variant}:${s.text}`)
    expect(texts(['星际穿越', '4K'])).toEqual(['solid:4K'])
    expect(texts(['HD中字'])).toEqual(['outline:中字'])
    expect(texts(['更新至 12 集', 'BD1080P'])).toEqual([])
    expect(texts(['更新至 12 集', '1080p'])).toEqual(['outline:1080P'])
    // 文件大小里的 GB 不算中文字幕
    expect(texts(['三体 4K 30GB'])).toEqual(['solid:4K'])
    expect(texts([])).toEqual([])
  })

  it('mediaSpecs：探测到的动态范围优先，没探测过看文件名；目录名不算；不出 1080P', () => {
    const texts = (input: Parameters<typeof mediaSpecs>[0]): string[] =>
      mediaSpecs(input).map(s => `${s.variant}:${s.text}`)
    const dune = 'D:\\Movies\\Dune.Part.Two.2024.2160p.DV.Atmos.中字.mkv'
    expect(texts({ videoRange: 'dv', fileNames: [dune] })).toEqual([
      'solid:4K',
      'dolby:VISION',
      'dolby:ATMOS',
      'outline:中字',
    ])
    // 探测说是 HDR10：文件名里的 DV 不算
    expect(texts({ videoRange: 'hdr10', fileNames: [dune] })).toEqual([
      'solid:4K',
      'solid:HDR10',
      'dolby:ATMOS',
      'outline:中字',
    ])
    // 探测说是 SDR：不出动态范围
    expect(
      texts({ videoRange: 'sdr', fileNames: ['/m/a.2160p.HDR.mkv'] })
    ).toEqual(['solid:4K'])
    // 没探测过：看文件名
    expect(texts({ fileNames: ['/m/a.2160p.HDR.mkv'] })).toEqual([
      'solid:4K',
      'solid:HDR',
    ])
    expect(texts({ videoRange: 'dv', fileNames: [] })).toEqual(['dolby:VISION'])
    expect(texts({ fileNames: ['/media/4K/movie.1080p.mkv'] })).toEqual([])
  })
})

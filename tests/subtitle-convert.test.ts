import { describe, expect, it } from 'vitest'

import { convertSubtitleText, srtToVtt } from '../src/main/subtitle'

const SRT = [
  '1',
  '00:00:01,000 --> 00:00:03,500',
  '你好，世界',
  '',
  '2',
  '00:01:02,250 --> 00:01:05,000',
  '第二行字幕',
  '第二行',
  '',
].join('\n')

describe('convertSubtitleText（在线字幕与本地共用链路）', () => {
  it('srt 文本带显式格式转换', () => {
    const result = convertSubtitleText(SRT, 'srt')
    expect(result.success).toBe(true)
    expect(result.format).toBe('srt')
    expect(result.data).toContain('WEBVTT')
    expect(result.data).toContain('00:00:01.000 --> 00:00:03.500')
    expect(result.data).toContain('你好，世界')
  })

  it('带点前缀的格式名（.srt）也能识别', () => {
    const result = convertSubtitleText(SRT, '.srt')
    expect(result.success).toBe(true)
    expect(result.format).toBe('srt')
  })

  it('vtt 文本原样通过', () => {
    const vtt = 'WEBVTT\n\n00:00.000 --> 00:02.000\nHello'
    const result = convertSubtitleText(vtt, 'vtt')
    expect(result.success).toBe(true)
    expect(result.format).toBe('vtt')
    expect(result.data).toContain('Hello')
  })

  it('ass 覆盖标签被剥离', () => {
    const ass = [
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:05.00,0:00:08.00,Default,,0,0,0,,{\\pos(190,240)}带标签,含逗号',
    ].join('\n')
    const result = convertSubtitleText(ass, 'ass')
    expect(result.success).toBe(true)
    expect(result.format).toBe('ass')
    expect(result.data).toContain('00:00:05.000 --> 00:00:08.000')
    expect(result.data).toContain('带标签,含逗号')
    expect(result.data).not.toContain('{\\pos')
  })

  it('未知格式按 srt 兜底解析', () => {
    const result = convertSubtitleText(SRT, 'weird')
    expect(result.success).toBe(true)
    expect(result.data).toContain('-->')
  })

  it('srtToVtt 基本行为回归（多行 cue）', () => {
    const vtt = srtToVtt(SRT)
    expect(vtt).toContain('第二行字幕\n第二行')
  })
})

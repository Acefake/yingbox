import { describe, expect, it } from 'vitest'
import { assToVtt, decodeSubtitleText, srtToVtt } from '../src/main/subtitle'

describe('srtToVtt', () => {
  it('converts a basic cue', () => {
    const vtt = srtToVtt('1\n00:00:01,000 --> 00:00:02,500\nHello\n\n')
    expect(vtt).toContain('WEBVTT')
    expect(vtt).toContain('00:00:01.000 --> 00:00:02.500')
    expect(vtt).toContain('Hello')
  })

  it('keeps multi-line bodies and drops malformed blocks', () => {
    const vtt = srtToVtt('1\n00:00:01,000 --> 00:00:02,000\nLine A\nLine B\n\nNot a cue\n')
    expect(vtt).toContain('Line A\nLine B')
    expect(vtt).not.toContain('Not a cue')
  })

  it('supports dot-separated timecodes without hours', () => {
    const vtt = srtToVtt('1\n00:01.000 --> 00:02.000\nX\n')
    expect(vtt).toContain('00:00:01.000 --> 00:00:02.000')
  })
})

describe('assToVtt', () => {
  it('converts dialogue events and strips override tags', () => {
    const ass = [
      '[Script Info]',
      'Title: demo',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\pos(1,2)}Hello, world',
    ].join('\n')
    const vtt = assToVtt(ass)
    expect(vtt).toContain('00:00:01.000 --> 00:00:02.500')
    expect(vtt).toContain('Hello, world')
    expect(vtt).not.toContain('pos')
  })
})

describe('decodeSubtitleText', () => {
  it('strips a UTF-8 BOM', () => {
    const buffer = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('你好', 'utf-8'),
    ])
    expect(decodeSubtitleText(buffer)).toBe('你好')
  })

  it('decodes UTF-16LE with BOM', () => {
    const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('你好', 'utf-16le')])
    expect(decodeSubtitleText(buffer)).toBe('你好')
  })

  it('falls back to GB18030 when the bytes are not valid UTF-8', () => {
    // GBK 编码的「你好」
    const buffer = Buffer.from([0xc4, 0xe3, 0xba, 0xc3])
    expect(decodeSubtitleText(buffer)).toBe('你好')
  })
})

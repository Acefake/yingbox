import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  assToVtt,
  decodeSubtitleText,
  readSubtitleAsVtt,
  srtToVtt,
} from '../src/main/subtitle'

describe('srtToVtt', () => {
  it('converts a basic cue', () => {
    const vtt = srtToVtt('1\n00:00:01,000 --> 00:00:02,500\nHello\n\n')
    expect(vtt).toContain('WEBVTT')
    expect(vtt).toContain('00:00:01.000 --> 00:00:02.500')
    expect(vtt).toContain('Hello')
  })

  it('keeps multi-line bodies and drops malformed blocks', () => {
    const vtt = srtToVtt(
      '1\n00:00:01,000 --> 00:00:02,000\nLine A\nLine B\n\nNot a cue\n'
    )
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
    const buffer = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('你好', 'utf-16le'),
    ])
    expect(decodeSubtitleText(buffer)).toBe('你好')
  })

  it('falls back to GB18030 when the bytes are not valid UTF-8', () => {
    // GBK 编码的「你好」
    const buffer = Buffer.from([0xc4, 0xe3, 0xba, 0xc3])
    expect(decodeSubtitleText(buffer)).toBe('你好')
  })
})

describe('decodeSubtitleText Big5', () => {
  it('繁体 Big5 字幕不按 GB18030 解成乱码', () => {
    // Big5 编码的「這是一個測試字幕，我們在這裡說話。」
    const text = '這是一個測試字幕，我們在這裡說話。'
    const buffer = Buffer.from(
      'b36fac4fa440add3b4fab8d5a672b9f5a141a7daadcca662b36fb8ccbba1b8dca143',
      'hex'
    )
    expect(decodeSubtitleText(buffer)).toBe(text)
  })

  it('简体 GBK 字幕仍按 GB18030 解', () => {
    // GBK 编码的「这是一个测试字幕，我们在这里说话。」
    const buffer = Buffer.from(
      'd5e2cac7d2bbb8f6b2e2cad4d7d6c4bba3acced2c3c7d4dad5e2c0efcbb5bbb0a1a3',
      'hex'
    )
    expect(decodeSubtitleText(buffer)).toBe(
      '这是一个测试字幕，我们在这里说话。'
    )
  })
})

describe('readSubtitleAsVtt', () => {
  it('只读字幕扩展名的文件', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'yb-sub-'))
    const secret = join(dir, 'id_rsa')
    await writeFile(secret, 'PRIVATE KEY')
    const srt = join(dir, 'a.srt')
    await writeFile(srt, '1\n00:00:01,000 --> 00:00:02,000\n你好\n')
    expect(await readSubtitleAsVtt(secret)).toMatchObject({ success: false })
    expect(await readSubtitleAsVtt(srt)).toMatchObject({ success: true })
    await rm(dir, { recursive: true, force: true })
  })
})

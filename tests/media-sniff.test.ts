/**
 * 测速媒体校验（src/engine/online/media-sniff.ts）：Content-Type 排除与首字节嗅探。
 */
import { describe, expect, it } from 'vitest'

import {
  isNonMediaType,
  mediaError,
  sniffMedia,
} from '../src/engine/online/media-sniff'

const bytes = (...parts: (string | number[])[]): Uint8Array =>
  Uint8Array.from(
    parts.flatMap(part =>
      typeof part === 'string' ? [...part].map(c => c.charCodeAt(0)) : part
    )
  )

describe('媒体校验', () => {
  it('网页 / JSON / 脚本类 Content-Type 不是媒体', () => {
    for (const type of [
      'text/html; charset=UTF-8',
      'TEXT/HTML',
      'application/json',
      'application/problem+json',
      'application/xhtml+xml',
      'text/javascript',
    ])
      expect(isNonMediaType(type)).toBe(true)
    for (const type of [
      '',
      'video/mp4',
      'application/vnd.apple.mpegurl',
      'application/octet-stream',
      'text/plain',
    ])
      expect(isNonMediaType(type)).toBe(false)
  })

  it('按首字节认出常见媒体格式', () => {
    const ts = new Uint8Array(376)
    ts[0] = 0x47
    ts[188] = 0x47
    expect(sniffMedia(bytes('#EXTM3U\n'))).toBe('m3u8')
    expect(sniffMedia(bytes([0xef, 0xbb, 0xbf], '\n #EXTM3U'))).toBe('m3u8')
    expect(sniffMedia(bytes([0, 0, 0, 0x18], 'ftypisom'))).toBe('mp4')
    expect(sniffMedia(bytes([0, 0, 0, 0x18], 'moof'))).toBe('mp4')
    expect(sniffMedia(ts)).toBe('ts')
    expect(sniffMedia(bytes('FLV', [1, 5]))).toBe('flv')
    expect(sniffMedia(bytes([0x1a, 0x45, 0xdf, 0xa3]))).toBe('mkv')
    expect(sniffMedia(bytes('ID3', [4, 0]))).toBe('id3')
    expect(sniffMedia(bytes([0xff, 0xf1, 0x50]))).toBe('adts')
    expect(sniffMedia(bytes([0, 0, 1, 0xba]))).toBe('mpeg-ps')
  })

  it('网页、JSON、假 TS、空正文都不是媒体', () => {
    const fakeTs = new Uint8Array(376)
    fakeTs[0] = 0x47
    expect(sniffMedia(bytes('<!DOCTYPE html><html>'))).toBeUndefined()
    expect(sniffMedia(bytes('{"code":404}'))).toBeUndefined()
    expect(sniffMedia(fakeTs)).toBeUndefined()
    expect(sniffMedia(new Uint8Array())).toBeUndefined()
  })

  it('mediaError：先看 Content-Type，再看首字节', () => {
    const mp4 = bytes([0, 0, 0, 0x18], 'ftypmp42')
    expect(mediaError('video/mp4', mp4)).toBeUndefined()
    expect(mediaError('', mp4)).toBeUndefined()
    expect(mediaError('text/html', mp4)).toBe('不是媒体（text/html）')
    expect(mediaError('video/mp4', bytes('<html>'))).toBe('不是媒体数据')
  })
})

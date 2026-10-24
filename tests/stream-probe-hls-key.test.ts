/**
 * 测速对加密 HLS 的处理（src/engine/online/hls-key.ts 与 stream-probe.ts）：
 * EXT-X-KEY 解析、AES-128 解密首分片再校验魔数、拿不到密钥 / SAMPLE-AES 时只排除错误页。
 */
import { createCipheriv } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  decryptHead,
  keyIv,
  looksLikeErrorPage,
  parseKeyTag,
} from '../src/engine/online/hls-key'
import { parseM3u8, probeStream } from '../src/engine/online/stream-probe'
import type { NetClient } from '../src/shared/net/client'

/** 每 188 字节一个 0x47 同步字节的 TS 数据 */
const tsBytes = (size: number): Uint8Array<ArrayBuffer> =>
  Uint8Array.from({ length: size }, (_, i) => (i % 188 === 0 ? 0x47 : i % 251))

const KEY = Uint8Array.from({ length: 16 }, (_, i) => i + 1)
const IV = Uint8Array.from({ length: 16 }, (_, i) => 0xa0 + i)
const HTML = '<!DOCTYPE html><html><body>403 Forbidden 请登录</body></html>'

/** AES-128-CBC 加密（带 PKCS7 填充，与真实分片一致）。 */
const encrypt = (
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array
): Uint8Array<ArrayBuffer> => {
  const cipher = createCipheriv('aes-128-cbc', key, iv)
  return Uint8Array.from(Buffer.concat([cipher.update(data), cipher.final()]))
}

type Route = {
  status?: number
  body: string | Uint8Array<ArrayBuffer>
  type?: string
}

/** 按地址返回固定内容的假网络客户端 */
const fakeNet = (
  routes: Record<string, Route>
): { net: NetClient; calls: string[] } => {
  const calls: string[] = []
  const net = {
    open: async (url: string) => {
      calls.push(url)
      const route = routes[url]
      if (!route) throw new Error('连接失败')
      return {
        url,
        response: new Response(route.body, {
          status: route.status ?? 200,
          headers: route.type ? { 'content-type': route.type } : {},
        }),
      }
    },
  } as unknown as NetClient
  return { net, calls }
}

const playlist = (keyTag?: string, sequence?: number): string =>
  [
    '#EXTM3U',
    ...(sequence !== undefined ? [`#EXT-X-MEDIA-SEQUENCE:${sequence}`] : []),
    ...(keyTag ? [keyTag] : []),
    '#EXTINF:4,',
    'seg0.ts',
  ].join('\n')

const probe = (net: NetClient): Promise<{ ok: boolean; error?: string }> =>
  probeStream(net, 'https://cdn.test/v/index.m3u8', { sampleMs: 50 })

describe('EXT-X-KEY 解析', () => {
  it('读 METHOD / URI / IV，NONE 取消加密', () => {
    const key = parseKeyTag(
      '#EXT-X-KEY:METHOD=AES-128,URI="key.php?a=1,b=2",IV=0x000102030405060708090A0B0C0D0E0F'
    )
    expect(key?.method).toBe('AES-128')
    expect(key?.uri).toBe('key.php?a=1,b=2')
    expect([...(key?.iv || [])]).toEqual([...Array(16).keys()])
    expect(parseKeyTag('#EXT-X-KEY:METHOD=NONE')).toBeUndefined()
    expect(parseKeyTag('#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x"')).toEqual({
      method: 'SAMPLE-AES',
      uri: 'skd://x',
    })
  })

  it('缺省 IV 按首个分片的媒体序号；只取首个分片前的 KEY', () => {
    const parsed = parseM3u8(
      [
        '#EXTM3U',
        '#EXT-X-MEDIA-SEQUENCE:7',
        '#EXT-X-KEY:METHOD=AES-128,URI="k1"',
        '#EXTINF:4,',
        'a.ts',
        '#EXT-X-KEY:METHOD=AES-128,URI="k2"',
        '#EXTINF:4,',
        'b.ts',
      ].join('\n')
    )
    expect(parsed).toMatchObject({ firstSegment: 'a.ts', sequence: 7 })
    expect(parsed.key?.uri).toBe('k1')
    const iv = keyIv(parsed.key!, parsed.sequence!)
    expect([...iv]).toEqual([...Array(15).fill(0), 7])
    expect(parseM3u8(playlist()).key).toBeUndefined()
  })

  it('解密开头整块；错误页识别不误伤密文', () => {
    const plain = tsBytes(400)
    const head = encrypt(plain, KEY, IV).subarray(0, 192)
    expect(decryptHead(head, KEY, IV)).toEqual(plain.subarray(0, 192))
    expect(decryptHead(head.subarray(0, 10), KEY, IV)).toBeUndefined()
    expect(decryptHead(head, KEY.subarray(0, 8), IV)).toBeUndefined()
    const text = (s: string): Uint8Array => new TextEncoder().encode(s)
    expect(looksLikeErrorPage(text(HTML))).toBe(true)
    expect(looksLikeErrorPage(text('\uFEFF  {"code":403}'))).toBe(true)
    expect(looksLikeErrorPage(head)).toBe(false)
    expect(looksLikeErrorPage(plain)).toBe(false)
  })
})

describe('加密 HLS 测速', () => {
  it('明文分片照常校验魔数', async () => {
    const { net } = fakeNet({
      'https://cdn.test/v/index.m3u8': { body: playlist() },
      'https://cdn.test/v/seg0.ts': { body: tsBytes(4096) },
    })
    expect((await probe(net)).ok).toBe(true)
  })

  it('AES-128 + 合法密钥：解密后是媒体就成功（显式 IV 与按序号的默认 IV）', async () => {
    const explicit = fakeNet({
      'https://cdn.test/v/index.m3u8': {
        body: playlist(
          `#EXT-X-KEY:METHOD=AES-128,URI="/keys/k.bin",IV=0x${Buffer.from(IV).toString('hex')}`
        ),
      },
      'https://cdn.test/keys/k.bin': { body: KEY, type: 'text/html' },
      'https://cdn.test/v/seg0.ts': {
        body: encrypt(tsBytes(4096), KEY, IV),
        type: 'video/mp2t',
      },
    })
    expect((await probe(explicit.net)).ok).toBe(true)
    expect(explicit.calls).toContain('https://cdn.test/keys/k.bin')

    const seqIv = keyIv({ method: 'AES-128' }, 3)
    const byIndex = fakeNet({
      'https://cdn.test/v/index.m3u8': {
        body: playlist('#EXT-X-KEY:METHOD=AES-128,URI="k.key"', 3),
      },
      'https://cdn.test/v/k.key': { body: KEY },
      'https://cdn.test/v/seg0.ts': {
        body: encrypt(tsBytes(4096), KEY, seqIv),
      },
    })
    expect((await probe(byIndex.net)).ok).toBe(true)
  })

  it('加密分片实为 HTML 错误页、或解密后不是媒体，仍算失败', async () => {
    const tag = '#EXT-X-KEY:METHOD=AES-128,URI="k.key"'
    const html = fakeNet({
      'https://cdn.test/v/index.m3u8': { body: playlist(tag) },
      'https://cdn.test/v/k.key': { body: KEY },
      'https://cdn.test/v/seg0.ts': { body: HTML, type: 'video/mp2t' },
    })
    expect(await probe(html.net)).toMatchObject({
      ok: false,
      error: '分片是错误页面',
    })
    const typed = fakeNet({
      'https://cdn.test/v/index.m3u8': { body: playlist(tag) },
      'https://cdn.test/v/seg0.ts': { body: HTML, type: 'text/html' },
    })
    expect(await probe(typed.net)).toMatchObject({
      ok: false,
      error: '不是媒体（text/html）',
    })
    const garbage = fakeNet({
      'https://cdn.test/v/index.m3u8': { body: playlist(tag) },
      'https://cdn.test/v/k.key': { body: KEY },
      'https://cdn.test/v/seg0.ts': {
        body: encrypt(
          new Uint8Array(4096).fill(0x33),
          KEY,
          keyIv({ method: 'AES-128' }, 0)
        ),
      },
    })
    expect(await probe(garbage.net)).toMatchObject({
      ok: false,
      error: '不是媒体数据',
    })
  })

  it('密钥拉取失败 / SAMPLE-AES：不要求魔数，只排除错误页', async () => {
    const cipherText = encrypt(tsBytes(4096), KEY, IV)
    for (const keyRoute of [
      undefined,
      { status: 403, body: KEY },
      { body: 'short' },
    ]) {
      const { net, calls } = fakeNet({
        'https://cdn.test/v/index.m3u8': {
          body: playlist('#EXT-X-KEY:METHOD=AES-128,URI="k.key"'),
        },
        ...(keyRoute ? { 'https://cdn.test/v/k.key': keyRoute } : {}),
        'https://cdn.test/v/seg0.ts': { body: cipherText },
      })
      expect((await probe(net)).ok).toBe(true)
      expect(calls).toContain('https://cdn.test/v/k.key')
    }
    const sampleAes = '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://asset"'
    const fallback = fakeNet({
      'https://cdn.test/v/index.m3u8': { body: playlist(sampleAes) },
      'https://cdn.test/v/seg0.ts': { body: cipherText },
    })
    expect((await probe(fallback.net)).ok).toBe(true)
    expect(fallback.calls).toHaveLength(2)
    const errorPage = fakeNet({
      'https://cdn.test/v/index.m3u8': { body: playlist(sampleAes) },
      'https://cdn.test/v/seg0.ts': { body: '{"code":404,"msg":"not found"}' },
    })
    expect(await probe(errorPage.net)).toMatchObject({
      ok: false,
      error: '分片是错误页面',
    })
  })
})

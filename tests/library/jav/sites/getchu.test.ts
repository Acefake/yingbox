/**
 * Getchu：检索 → 逐个核对品番的流程与商品页解析（页面为手写结构，未用真实页面验证），
 * 以及 HTTP 层按页面字符集解码 EUC-JP（Getchu 的页面编码）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ProviderHttp,
  sniffCharset,
} from '../../../../src/main/library/providers/http/provider-http'
import {
  getchu,
  getchuCandidates,
  getchuSearchUrl,
  parseGetchuDetail,
} from '../../../../src/main/library/providers/jav/sites/getchu'
import type { SiteContext } from '../../../../src/main/library/providers/jav/types'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '../../../fixtures/jav', name), 'utf8')

const soft = (id: number): string =>
  `https://www.getchu.com/soft.phtml?id=${id}`

describe('Getchu', () => {
  it('检索结果：商品地址去重保序', () => {
    expect(getchuCandidates(fixture('getchu-search.html'))).toEqual([
      soft(1100001),
      soft(1100002),
      soft(1100003),
    ])
  })

  it('商品页：字段与图片', () => {
    const r = parseGetchuDetail(fixture('getchu-1100002.html'), soft(1100002))!
    expect(r).toMatchObject({
      site: 'getchu',
      code: 'ACRN-123',
      title: 'OVA 姉妹の秘密 ＃1',
      releaseDate: '2023-01-27',
      director: '山田太郎',
      studio: 'ピンクパイナップル',
      tags: ['アダルトアニメ', 'OVA'],
      overview: '姉妹が隠していた秘密とは――。',
      cover: 'https://www.getchu.com/brandnew/1100002/c1100002package.jpg',
      stills: [
        'https://www.getchu.com/brandnew/1100002/c1100002sample1.jpg',
        'https://www.getchu.com/brandnew/1100002/c1100002sample2.jpg',
      ],
    })
  })

  it('流程：第一条品番不对，第二条对上', async () => {
    const seen: string[] = []
    const map: Record<string, string> = {
      [getchuSearchUrl('ACRN-123')]: fixture('getchu-search.html'),
      [soft(1100001)]: fixture('getchu-1100001.html'),
      [soft(1100002)]: fixture('getchu-1100002.html'),
    }
    const ctx: SiteContext = {
      page: async (url, options) => {
        expect(options?.cookie).toContain('getchu_adalt_flag=getchu.com')
        seen.push(url)
        return map[url] ?? null
      },
    }
    const target = {
      code: 'ACRN-123',
      kind: 'censored' as const,
      subtitle: false,
    }
    expect((await getchu.fetch(target, ctx))?.title).toBe('OVA 姉妹の秘密 ＃1')
    expect(seen).toHaveLength(3)
  })

  it('品番都对不上：最多核对两条后返回 null', async () => {
    let calls = 0
    const ctx: SiteContext = {
      page: async url => {
        calls++
        return url.includes('nsearch')
          ? fixture('getchu-search.html')
          : fixture('getchu-1100001.html')
      },
    }
    const target = {
      code: 'ACRN-555',
      kind: 'censored' as const,
      subtitle: false,
    }
    expect(await getchu.fetch(target, ctx)).toBeNull()
    expect(calls).toBe(3)
  })
})

describe('HTTP 层：字符集与 POST', () => {
  it('字符集：响应头优先，其次 meta，认不出按 UTF-8', () => {
    const meta = new TextEncoder().encode(
      '<meta http-equiv="Content-Type" content="text/html; charset=EUC-JP">'
    )
    expect(sniffCharset('text/html; charset=Shift_JIS', meta)).toBe('shift_jis')
    expect(sniffCharset('text/html', meta)).toBe('euc-jp')
    expect(sniffCharset(null, new Uint8Array())).toBe('utf-8')
    expect(sniffCharset('text/html; charset=nonsense', new Uint8Array())).toBe(
      'utf-8'
    )
  })

  it('getText 按 EUC-JP 解码，带 body 时发 POST', async () => {
    // 「発売日」的 EUC-JP 字节
    const euc = Uint8Array.from([0xc8, 0xaf, 0xc7, 0xe4, 0xc6, 0xfc])
    const calls: Array<{ method?: string; body?: string }> = []
    const http = new ProviderHttp({
      fetch: async (_url, init) => {
        calls.push({ method: init.method, body: init.body })
        return {
          status: 200,
          headers: {
            get: name =>
              name === 'content-type' ? 'text/html; charset=EUC-JP' : null,
          },
          text: async () => 'wrong',
          arrayBuffer: async () => euc.buffer.slice(0),
        }
      },
    })
    expect(await http.getText({ url: 'https://x/' })).toBe('発売日')
    await http.getText({ url: 'https://x/', body: '{}' })
    expect(calls).toEqual([
      { method: undefined, body: undefined },
      { method: 'POST', body: '{}' },
    ])
  })
})

/**
 * CatSpider 宿主接口与 XPTV 对齐：JSEncrypt 公钥加密（瓜子）、$fetch 返回 status / respHeaders
 * （河馬、壹影視、anime1、哔滴、路漫漫、茶杯狐），以及河馬的搜索类型 patch。
 */
import {
  constants,
  generateKeyPairSync,
  privateDecrypt,
  publicEncrypt,
} from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createNetClient } from '../src/shared/net/client'
import { applyPatch, runCatSpider } from '../src/engine/online/catspider'
import { SITES } from '../src/engine/online'

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 1024,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

const net = (
  routes: Record<string, () => Response>
): ReturnType<typeof createNetClient> =>
  createNetClient({
    lookup: async () => [{ address: '93.184.216.34' }],
    fetch: async url => routes[url]?.() ?? new Response('nf', { status: 404 }),
  })

const run = (
  plugin: string,
  routes: Record<string, () => Response> = {},
  browserFetch = vi.fn(async () => '')
): Promise<unknown> =>
  runCatSpider(
    { net: net(routes), browserFetch, loadPlugin: async () => plugin },
    'p.js',
    'search',
    { text: 'x', pub: publicKey, pri: privateKey }
  )

describe('JSEncrypt 兼容', () => {
  it('setPublicKey + encrypt 得到 PKCS#1 v1.5 base64 密文，私钥能解开', async () => {
    const result = (await run(`
      const JSEncrypt = loadJSEncrypt()
      async function search(ext) {
        const e = new JSEncrypt(); e.setPublicKey(argsify(ext).pub)
        return { c: e.encrypt('瓜子 key') }
      }`)) as { c: string }
    const plain = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(result.c, 'base64')
    ).toString('utf8')
    expect(plain).toBe('瓜子 key')
  })

  it('setKey 与 setPrivateKey 同样可用；没设钥匙时 encrypt 返回 false、decrypt 返回 null', async () => {
    const cipher = publicEncrypt(
      { key: publicKey, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from('ok')
    ).toString('base64')
    const result = await run(`
      const JSEncrypt = loadJSEncrypt()
      async function search(ext) {
        const { pri } = argsify(ext)
        const a = new JSEncrypt(); a.setPrivateKey(pri)
        const b = new JSEncrypt(); b.setKey(pri)
        const none = new JSEncrypt()
        return { a: a.decrypt('${cipher}'), b: b.decrypt(b.encrypt('self')), bad: none.decrypt('${cipher}'), none: none.encrypt('x') }
      }`)
    expect(result).toEqual({ a: 'ok', b: 'self', bad: null, none: false })
  })
})

describe('$fetch 返回值形状', () => {
  const PLUGIN = `async function search() {
    const r = await $fetch.get('https://site.test/a')
    return { status: r.status, data: r.data, resp: r.respHeaders, headers: r.headers }
  }`

  it('带 status；respHeaders 有首字母大写与小写两套键，Set-Cookie 连成串、set-cookie 是数组', async () => {
    const headers = new Headers({
      'content-type': 'text/html',
      'x-token': 't1',
    })
    headers.append('set-cookie', 'a=1; Path=/')
    headers.append('set-cookie', 'PHPSESSID=abc; HttpOnly')
    const result = (await run(PLUGIN, {
      'https://site.test/a': () =>
        new Response('body', { status: 400, headers }),
    })) as Record<string, Record<string, unknown>>
    expect(result.status).toBe(400)
    expect(result.data).toBe('body')
    expect(result.resp['Content-Type']).toBe('text/html')
    expect(result.resp['content-type']).toBe('text/html')
    expect(result.resp['X-Token']).toBe('t1')
    expect(result.resp['Set-Cookie']).toBe(
      'a=1; Path=/, PHPSESSID=abc; HttpOnly'
    )
    expect(result.resp['set-cookie']).toEqual([
      'a=1; Path=/',
      'PHPSESSID=abc; HttpOnly',
    ])
    expect(result.headers['content-type']).toBe('text/html')
  })

  it('没有 Set-Cookie 时不出现该键；浏览器代抓的结果 status 为 200、respHeaders 为空', async () => {
    const plain = (await run(PLUGIN, {
      'https://site.test/a': () => new Response('ok'),
    })) as Record<string, Record<string, unknown>>
    expect(plain.status).toBe(200)
    expect('set-cookie' in plain.resp).toBe(false)
    expect('Set-Cookie' in plain.resp).toBe(false)

    const viaBrowser = (await run(
      PLUGIN,
      {
        'https://site.test/a': () =>
          new Response('<title>Just a moment...</title>', { status: 403 }),
      },
      vi.fn(async () => '<html>real</html>')
    )) as Record<string, unknown>
    expect(viaBrowser).toMatchObject({
      status: 200,
      data: '<html>real</html>',
      resp: {},
    })
  })
})

describe('河馬短劇 patch', () => {
  it('搜索接口改用站点自己的搜索类型（搜索页=1，原插件用的聚合页=2 不看关键词）', () => {
    const site = SITES.find(s => s.api === 'csp_kuaikaw')
    const code = `const payload = JSON.stringify({\n  sourceType: 2,\n  keyword: text })`
    expect(applyPatch(code, site?.patch)).toContain('sourceType: 1,')
    expect(applyPatch(code, site?.patch)).not.toContain('sourceType: 2')
  })
})

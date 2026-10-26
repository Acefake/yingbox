/**
 * 115 云下载：m115 编码往返（自己生成的密钥对模拟 115 服务端）、添加任务 / 任务列表的解析（构造响应，
 * 字段形状按公开实现整理，真实接口未验证）、主机退回、传输层保留客户端 UA。
 */
import {
  constants,
  generateKeyPairSync,
  privateDecrypt,
  privateEncrypt,
} from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { USER_AGENT } from '../../src/main/pan115/http'
import {
  type M115Key,
  deriveKey,
  m115Decode,
  m115Encode,
  xorInPlace,
} from '../../src/main/pan115/m115'
import {
  CLIENT_USER_AGENT,
  addOfflineUrls,
  listOfflineTasks,
  parseAddResult,
  parseTaskList,
} from '../../src/main/pan115/offline'
import { with115Headers } from '../../src/main/pan115/transport'
import { type SentRequest, fakeFetch } from './fixtures'

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 1024,
})
const jwk = publicKey.export({ format: 'jwk' })
const big = (b64: string): bigint =>
  BigInt(`0x${Buffer.from(b64, 'base64url').toString('hex')}`)
const KEY: M115Key = { n: big(jwk.n as string), e: big(jwk.e as string) }
const BLOCK = 128
/** 115 客户端里的公开常量（与 m115.ts 相同） */
const CLIENT_KEY = Buffer.from('7806ad4c33865d184c013f46', 'hex')

/** 模拟服务端：私钥解开请求，还原出 16 字节种子与 JSON */
function serverRead(data: string): { seed: Buffer; json: string } {
  const raw = Buffer.from(data, 'base64')
  const parts: Buffer[] = []
  for (let i = 0; i < raw.length; i += BLOCK)
    parts.push(
      privateDecrypt(
        { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
        raw.subarray(i, i + BLOCK)
      )
    )
  const plain = Buffer.concat(parts)
  const seed = plain.subarray(0, 16)
  const body = Buffer.from(plain.subarray(16))
  xorInPlace(body, CLIENT_KEY)
  body.reverse()
  xorInPlace(body, deriveKey(seed, 4))
  return { seed: Buffer.from(seed), json: body.toString('utf8') }
}

/** 模拟服务端：用请求的种子编码响应（私钥加密，PKCS#1 类型 1 填充） */
function serverWrite(json: string, clientSeed: Buffer): string {
  const serverSeed = Buffer.from('00112233445566778899aabbccddeeff', 'hex')
  const body = Buffer.from(json, 'utf8')
  xorInPlace(body, deriveKey(clientSeed, 4))
  body.reverse()
  xorInPlace(body, deriveKey(serverSeed, 12))
  const plain = Buffer.concat([serverSeed, body])
  const parts: Buffer[] = []
  for (let i = 0; i < plain.length; i += BLOCK - 11)
    parts.push(
      privateEncrypt(
        { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
        plain.subarray(i, i + BLOCK - 11)
      )
    )
  return Buffer.concat(parts).toString('base64')
}

const HASH = 'a'.repeat(40)
const LINK = `magnet:?xt=urn:btih:${HASH}&dn=Some.Movie.2024`

describe('m115 编码', () => {
  it('请求往返：服务端用私钥能还原出种子与 JSON（多块，中文）', () => {
    const json = JSON.stringify({
      ac: 'add_task_urls',
      name: '示例'.repeat(80),
    })
    const { data, seed } = m115Encode(json, KEY)
    expect(seed).toHaveLength(16)
    const read = serverRead(data)
    expect(read.json).toBe(json)
    expect(read.seed.equals(seed)).toBe(true)
  })

  it('响应往返：服务端私钥编码的 data 用同一种子解回原文', () => {
    const { seed } = m115Encode('{}', KEY)
    const json = JSON.stringify({ state: true, result: [{ info_hash: HASH }] })
    expect(m115Decode(serverWrite(json, seed), seed, KEY)).toBe(json)
  })

  it('响应太短时抛错', () => {
    const tiny = privateEncrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
      Buffer.alloc(4)
    ).toString('base64')
    expect(() => m115Decode(tiny, Buffer.alloc(16), KEY)).toThrow('太短')
  })
})

describe('115 云下载解析', () => {
  it('parseAddResult：逐条结果，10008 已存在算成功，别的错误转人话', () => {
    const items = parseAddResult(
      {
        result: [
          { state: true, info_hash: HASH, name: 'Some.Movie.2024' },
          { state: false, errcode: 10008, info_hash: 'b'.repeat(40) },
          { state: false, errcode: 10004 },
          { state: false, errcode: 99, error_msg: '配额不足' },
        ],
      },
      ['l1', 'l2', 'l3', 'l4', 'l5']
    )
    expect(items.map(i => [i.ok, i.existed, i.error])).toEqual([
      [true, false, undefined],
      [true, true, undefined],
      [false, false, '链接不合法或 115 不支持'],
      [false, false, '配额不足'],
      [false, false, '115 没有返回结果'],
    ])
    expect(items[0]).toMatchObject({ hash: HASH, name: 'Some.Movie.2024' })
  })

  it('parseTaskList：状态码映射、进度夹在 0–100、失败原因、配额', () => {
    const page = parseTaskList({
      state: true,
      page_count: 2,
      quota: 1480,
      total: 1500,
      tasks: [
        {
          info_hash: HASH.toUpperCase(),
          name: 'A',
          size: '1024',
          percentDone: 63.4,
          status: 1,
          add_time: 1700000000,
          wp_path_id: '123',
          file_id: '9',
        },
        { info_hash: 'b'.repeat(40), name: 'B', percentDone: 100, status: 2 },
        {
          info_hash: 'c'.repeat(40),
          name: 'C',
          status: -1,
          err_msg: '资源暂时没有可用的种子',
        },
        { info_hash: 'd'.repeat(40), name: 'D', status: -1 },
        { info_hash: 'e'.repeat(40), name: 'E', status: 7, percentDone: 150 },
      ],
    })
    expect(page).toMatchObject({ pageCount: 2, quota: 1480, total: 1500 })
    expect(page.tasks[0]).toEqual({
      hash: HASH,
      name: 'A',
      size: 1024,
      percent: 63.4,
      status: 'running',
      addedAt: 1700000000000,
      folderCid: '123',
      fileId: '9',
      error: undefined,
    })
    expect(page.tasks.slice(1).map(t => [t.status, t.error])).toEqual([
      ['done', undefined],
      ['failed', '资源暂时没有可用的种子'],
      ['failed', '115 没给失败原因'],
      ['waiting', undefined],
    ])
    expect(page.tasks[4].percent).toBe(100)
  })

  it('parseTaskList：state 为 false 时抛出 115 的说明', () => {
    expect(() =>
      parseTaskList({ state: false, error_msg: '请先登录' })
    ).toThrow('请先登录')
  })
})

describe('115 云下载请求', () => {
  it('添加：表单 data 是 m115 编码（uid、版本、保存目录、url[i]），带客户端 UA，响应解码后逐条给结果', async () => {
    let request: { seed: Buffer; json: string } | null = null
    const { fetch, sent } = fakeFetch({
      'https://clouddownload.115.com/lixianssp/': (req: SentRequest) => {
        request = serverRead(new URLSearchParams(req.body).get('data') ?? '')
        const reply = JSON.stringify({
          result: [{ state: true, info_hash: HASH, name: 'Some.Movie.2024' }],
        })
        return { state: true, data: serverWrite(reply, request.seed) }
      },
    })
    const items = await addOfflineUrls(fetch, '42', [LINK], '777', KEY)
    expect(items).toEqual([
      {
        link: LINK,
        ok: true,
        existed: false,
        hash: HASH,
        name: 'Some.Movie.2024',
        error: undefined,
      },
    ])
    expect(sent[0].method).toBe('POST')
    expect(sent[0].url).toBe(
      'https://clouddownload.115.com/lixianssp/?ac=add_task_urls'
    )
    expect(sent[0].headers['user-agent']).toBe(CLIENT_USER_AGENT)
    expect(JSON.parse(request!.json)).toEqual({
      ac: 'add_task_urls',
      app_ver: '36.2.28',
      uid: '42',
      wp_path_id: '777',
      'url[0]': LINK,
    })
  })

  it('添加：保存目录不是数字时落到根目录；超过 15 个链接直接拒绝', async () => {
    let json = ''
    const { fetch } = fakeFetch({
      'https://clouddownload.115.com/lixianssp/': (req: SentRequest) => {
        const read = serverRead(new URLSearchParams(req.body).get('data') ?? '')
        json = read.json
        return { state: true, data: serverWrite('{"result":[]}', read.seed) }
      },
    })
    await addOfflineUrls(fetch, '1', [LINK], '', KEY)
    expect(JSON.parse(json).wp_path_id).toBe('0')
    await expect(
      addOfflineUrls(fetch, '1', Array(16).fill(LINK), '0', KEY)
    ).rejects.toThrow('最多')
  })

  it('添加：外层 state=false 抛 115 的错误；data 解不开时提示接口可能已变', async () => {
    const failing = fakeFetch({
      'https://clouddownload.115.com/lixianssp/': {
        state: false,
        errcode: 12345,
        error_msg: '离线任务数已达上限',
      },
    })
    await expect(
      addOfflineUrls(failing.fetch, '1', [LINK], '0', KEY)
    ).rejects.toThrow('离线任务数已达上限')
    const garbled = fakeFetch({
      'https://clouddownload.115.com/lixianssp/': { state: true, data: 'AAAA' },
    })
    await expect(
      addOfflineUrls(garbled.fetch, '1', [LINK], '0', KEY)
    ).rejects.toThrow('解不开')
  })

  it('列表：新域名 404 时退回 lixian.115.com；别的错误不退回', async () => {
    const { fetch, sent } = fakeFetch({
      'https://lixian.115.com/lixian/': {
        state: true,
        page_count: 1,
        tasks: [{ info_hash: HASH, name: 'A', status: 2 }],
      },
    })
    const page = await listOfflineTasks(fetch, 1)
    expect(page.tasks[0].status).toBe('done')
    expect(sent.map(s => new URL(s.url).host)).toEqual([
      'clouddownload.115.com',
      'lixian.115.com',
    ])
    const denied = fakeFetch({
      'https://clouddownload.115.com/web/': { state: false, errno: 990001 },
    })
    await expect(listOfflineTasks(denied.fetch, 1)).rejects.toThrow()
    expect(denied.sent).toHaveLength(1)
  })
})

describe('传输层 UA', () => {
  it('115 客户端 UA（含 115Browser）保留，别的 UA 仍换成桌面 UA', () => {
    const url = 'https://clouddownload.115.com/lixianssp/?ac=add_task_urls'
    expect(
      with115Headers(url, { 'user-agent': CLIENT_USER_AGENT })['User-Agent']
    ).toBe(CLIENT_USER_AGENT)
    expect(with115Headers(url, { 'User-Agent': 'curl/8' })['User-Agent']).toBe(
      USER_AGENT
    )
    expect(with115Headers(url, {})['User-Agent']).toBe(USER_AGENT)
  })
})

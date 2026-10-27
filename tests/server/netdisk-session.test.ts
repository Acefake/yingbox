/**
 * 服务端 115 会话：扫码登录后会话进 secrets.json、Cookie 进罐子；115 报登录失效（99）时两处一起清掉；
 * 重启后（新罐子 + 新服务）会话恢复，请求照常带 Cookie。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createPan115Service } from '../../src/main/pan115/service'
import {
  parseSession,
  serializeSession,
} from '../../src/main/pan115/session-codec'
import { CookieJar } from '../../src/server/netdisk/cookie-jar'
import { createNodeTransport } from '../../src/server/netdisk/node-transport'
import { FileSecretStore } from '../../src/server/secrets'
import { fakeFetch } from '../pan115/fixtures'

let dir: string
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'yingbox-pan-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** 服务端同样的组装（与 src/server/netdisk/index.ts 一致） */
function build(fetch: (url: string, init?: RequestInit) => Promise<Response>): {
  secrets: FileSecretStore
  jar: CookieJar
  service: ReturnType<typeof createPan115Service>
} {
  const secrets = new FileSecretStore(join(dir, 'secrets.json'))
  const jar = CookieJar.open(join(dir, 'pan115-cookies.json'))
  const service = createPan115Service({
    transport: createNodeTransport({ jar, fetch }),
    lanFetch: fetch,
    settings: { pansouUrl: () => '', targetCid: () => '0' },
    session: {
      read: () => parseSession(secrets.get('pan115.session') ?? ''),
      write: async value =>
        secrets.set('pan115.session', serializeSession(value) || null),
    },
    torznab: { read: () => null, write: async () => {} },
  })
  return { secrets, jar, service }
}

const LIST = {
  state: true,
  path: [{ cid: '0', name: '根目录' }],
  data: [],
  count: 0,
}

describe('服务端 115 会话', () => {
  it('会话失效（99）时清掉 secrets 里的会话和罐子里的 Cookie', async () => {
    const session = { cookie: 'UID=1; SEID=s', userId: '1', userName: '小明' }
    const first = build(fakeFetch({}).fetch)
    first.secrets.set('pan115.session', serializeSession(session))

    const { fetch, sent } = fakeFetch({
      'https://webapi.115.com/files': {
        state: false,
        errno: 99,
        error: '请重新登录',
      },
    })
    const { service, jar, secrets } = build(fetch)
    expect(await service.account()).toMatchObject({
      loggedIn: true,
      userName: '小明',
    })
    const result = await service.dirs('0')
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining('重新扫码'),
    })
    expect(sent[0].headers.cookie).toBe('UID=1; SEID=s')
    expect(await service.account()).toEqual({ loggedIn: false })
    expect(secrets.get('pan115.session')).toBeUndefined()
    expect(jar.baseCookie()).toBeNull()
    expect(
      JSON.parse(readFileSync(join(dir, 'pan115-cookies.json'), 'utf8'))
    ).toMatchObject({
      base: null,
      cookies: [],
    })
  })

  it('重启后恢复会话，请求带上罐子里的 Cookie', async () => {
    const session = { cookie: 'UID=9; SEID=z', userId: '9', userName: 'u' }
    const first = build(fakeFetch({}).fetch)
    await first.service.restore()
    first.secrets.set('pan115.session', serializeSession(session))

    const { fetch, sent } = fakeFetch({ 'https://webapi.115.com/files': LIST })
    const restarted = build(fetch)
    await restarted.service.restore()
    expect(restarted.jar.baseCookie()).toBe('UID=9; SEID=z')
    const result = await restarted.service.dirs('0')
    expect(result.ok).toBe(true)
    expect(sent[0].headers.cookie).toBe('UID=9; SEID=z')
  })

  it('未登录时不发请求', async () => {
    const { fetch, sent } = fakeFetch({})
    const { service } = build(fetch)
    expect(await service.dirs('0')).toEqual({
      ok: false,
      error: expect.stringContaining('扫码登录'),
    })
    expect(sent).toHaveLength(0)
  })
})

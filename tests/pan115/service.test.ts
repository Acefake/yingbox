/**
 * 网盘服务组合：扫码状态机（瞬时异常、finish 重试、换码、并发）、会话与分区 Cookie 同步、
 * 登录失效只清当前会话、未登录不发请求、搜索。全部用假传输层，不访问外网。
 */
import { describe, expect, it } from 'vitest'

import {
  type Pan115ServiceDeps,
  type Pan115Session,
  createPan115Service,
} from '../../src/main/pan115/service'
import {
  parseSession,
  serializeSession,
} from '../../src/main/pan115/session-codec'
import {
  PANSOU_WRAPPED,
  QR_LOGIN_OK,
  QR_TOKEN,
  SNAP_OK,
  fail,
  fakeFetch,
  fakeTransport,
  qrStatus,
} from './fixtures'

const SESSION: Pan115Session = {
  cookie: 'UID=10086_A1_1; CID=cid-x; SEID=seid-x; KID=kid-x',
  userId: '10086',
  userName: '影盒用户',
}
const OTHER: Pan115Session = { ...SESSION, cookie: 'UID=2; SEID=new-seid' }
const ACCOUNT = { loggedIn: true, userId: '10086', userName: '影盒用户' }
const TOKEN = 'https://qrcodeapi.115.com/api/1.0/web/1.0/token'
const STATUS = 'https://qrcodeapi.115.com/get/status'
const PASSPORT = 'https://passportapi.115.com/'

/** 内存里的会话存放，模拟 safeStorage 密钥 */
function memorySession(
  initial: Pan115Session | null = null
): Pan115ServiceDeps['session'] & {
  value: () => Pan115Session | null
} {
  let current = initial
  return {
    read: () => current,
    write: async s => {
      current = s
    },
    value: () => current,
  }
}

const settings = {
  pansouUrl: () => 'https://so.example.com',
  targetCid: () => '42',
}

/** 组装服务：115 走假传输层，PanSou 走单独的假 fetch */
function setup(
  routes: Parameters<typeof fakeTransport>[0],
  initial: Pan115Session | null = null
): ReturnType<typeof fakeTransport> & {
  service: ReturnType<typeof createPan115Service>
  session: ReturnType<typeof memorySession>
} {
  const fake = fakeTransport(routes)
  const session = memorySession(initial)
  const service = createPan115Service({
    transport: fake.transport,
    pansouFetch: fakeFetch({}).fetch,
    settings,
    session,
  })
  return { ...fake, service, session }
}

/** 可以手动放行的响应 */
function deferred(): {
  promise: Promise<unknown>
  resolve: (v: unknown) => void
} {
  let resolve!: (v: unknown) => void
  const promise = new Promise<unknown>(r => (resolve = r))
  return { promise, resolve }
}

describe('扫码登录状态机', () => {
  it('start → 已扫码 → 确认后保存会话、写入分区 Cookie 并返回账号', async () => {
    let n = 0
    const { service, session, jar } = setup({
      [TOKEN]: QR_TOKEN,
      [STATUS]: () => qrStatus(n++ === 0 ? 1 : 2),
      [PASSPORT]: QR_LOGIN_OK,
    })
    expect((await service.loginStart()).ok).toBe(true)
    expect(await service.loginPoll()).toEqual({ status: 'scanned' })
    expect(await service.loginPoll()).toEqual({
      status: 'done',
      account: ACCOUNT,
    })
    expect(session.value()).toEqual(SESSION)
    expect(jar.cookie).toBe(SESSION.cookie)
    expect(await service.loginPoll()).toEqual({
      status: 'error',
      error: '请先获取二维码',
    })
  })

  it('二维码过期后需要重新获取', async () => {
    const { service } = setup({ [TOKEN]: QR_TOKEN, [STATUS]: qrStatus(-1) })
    await service.loginStart()
    expect(await service.loginPoll()).toEqual({ status: 'expired' })
    expect((await service.loginPoll()).status).toBe('error')
  })

  it('一次未知状态不丢二维码：报上次的状态，继续轮询能登录', async () => {
    const answers = [qrStatus(9), qrStatus(1), { state: 1 }, qrStatus(2)]
    const { service } = setup({
      [TOKEN]: QR_TOKEN,
      [STATUS]: () => answers.shift(),
      [PASSPORT]: QR_LOGIN_OK,
    })
    await service.loginStart()
    expect(await service.loginPoll()).toEqual({ status: 'waiting' })
    expect(await service.loginPoll()).toEqual({ status: 'scanned' })
    expect(await service.loginPoll()).toEqual({ status: 'scanned' })
    expect((await service.loginPoll()).status).toBe('done')
  })

  it('状态接口连续失败才报错，且二维码保留，重试仍可登录', async () => {
    let calls = 0
    const { service } = setup({
      [TOKEN]: QR_TOKEN,
      [STATUS]: () =>
        ++calls <= 3 ? new Response('down', { status: 502 }) : qrStatus(2),
      [PASSPORT]: QR_LOGIN_OK,
    })
    await service.loginStart()
    expect(await service.loginPoll()).toEqual({ status: 'waiting' })
    expect(await service.loginPoll()).toEqual({ status: 'waiting' })
    const third = await service.loginPoll()
    expect(third.status).toBe('error')
    expect((await service.loginPoll()).status).toBe('done')
  })

  it('手机已确认、换 Cookie 失败：二维码保留，再轮询直接重试 finish 并成功', async () => {
    let passport = 0
    let status = 0
    const { service, session } = setup({
      [TOKEN]: QR_TOKEN,
      [STATUS]: () => (++status === 1 ? qrStatus(2) : qrStatus(0)),
      [PASSPORT]: () =>
        ++passport === 1 ? new Response('busy', { status: 503 }) : QR_LOGIN_OK,
    })
    await service.loginStart()
    const failed = await service.loginPoll()
    expect(failed.status).toBe('error')
    expect(session.value()).toBeNull()
    expect(await service.loginPoll()).toEqual({
      status: 'done',
      account: ACCOUNT,
    })
    expect(status).toBe(1)
    expect(session.value()).toEqual(SESSION)
  })

  it('换了新二维码后，旧码的晚到确认不写会话也不换 Cookie', async () => {
    const late = deferred()
    let token = 0
    let passport = 0
    const { service, session } = setup({
      [TOKEN]: () => ({
        ...QR_TOKEN,
        data: { ...QR_TOKEN.data, uid: `qr-${++token}` },
      }),
      [STATUS]: req =>
        req.url.includes('uid=qr-1') ? late.promise : qrStatus(0),
      [PASSPORT]: () => (passport++, QR_LOGIN_OK),
    })
    await service.loginStart()
    const oldPoll = service.loginPoll()
    await service.loginStart()
    late.resolve(qrStatus(2))
    expect((await oldPoll).status).toBe('error')
    expect(passport).toBe(0)
    expect(session.value()).toBeNull()
    expect(await service.loginPoll()).toEqual({ status: 'waiting' })
  })

  it('并发的两次轮询只换一次 Cookie', async () => {
    let passport = 0
    const { service } = setup({
      [TOKEN]: QR_TOKEN,
      [STATUS]: qrStatus(2),
      [PASSPORT]: () => (passport++, QR_LOGIN_OK),
    })
    await service.loginStart()
    const [a, b] = await Promise.all([service.loginPoll(), service.loginPoll()])
    expect([a.status, b.status]).toEqual(['done', 'done'])
    expect(passport).toBe(1)
  })

  it('取二维码失败给人话', async () => {
    const { service } = setup({ [TOKEN]: new Response('x', { status: 500 }) })
    expect(await service.loginStart()).toEqual({
      ok: false,
      error: '115 返回 HTTP 500',
    })
  })
})

describe('会话与分区 Cookie', () => {
  it('启动恢复：把保存的 Cookie 写进分区；没有会话时清空', async () => {
    const a = setup({}, SESSION)
    await a.service.restore()
    expect(a.jar.history).toEqual([SESSION.cookie])
    const b = setup({})
    await b.service.restore()
    expect(b.jar.history).toEqual([null])
  })

  it('请求经分区带上当前会话的 Cookie；会话在别处换了也跟着换', async () => {
    const { service, session, sent } = setup(
      { 'https://webapi.115.com/share/snap': SNAP_OK },
      SESSION
    )
    await service.snap('https://115.com/s/swh3abc12', 'x1y2')
    expect(sent[0].headers.cookie).toBe(SESSION.cookie)
    await session.write(OTHER)
    await service.snap('https://115.com/s/swh3abc12', 'x1y2')
    expect(sent[1].headers.cookie).toBe(OTHER.cookie)
  })

  it('账号状态与退出：不返回 Cookie，退出清会话与分区', async () => {
    const { service, session, jar } = setup({}, SESSION)
    const account = await service.account()
    expect(account).toEqual(ACCOUNT)
    expect(JSON.stringify(account)).not.toContain('SEID')
    await service.logout()
    expect(session.value()).toBeNull()
    expect(jar.cookie).toBeNull()
    expect(await service.account()).toEqual({ loggedIn: false })
  })

  it('登录失效（99）清掉发请求时的那份会话', async () => {
    const { service, session, jar } = setup(
      { 'https://webapi.115.com/files': fail(99) },
      SESSION
    )
    const result = await service.dirs('0')
    expect(result.ok).toBe(false)
    expect(session.value()).toBeNull()
    expect(jar.cookie).toBeNull()
  })

  it('晚到的 99 不会清掉期间重新登录的新会话', async () => {
    const late = deferred()
    const { service, session } = setup(
      { 'https://webapi.115.com/files': () => late.promise },
      SESSION
    )
    const pending = service.dirs('0')
    await new Promise(resolve => setTimeout(resolve, 0))
    await session.write(OTHER)
    late.resolve(fail(990001))
    expect((await pending).ok).toBe(false)
    expect(session.value()).toEqual(OTHER)
  })

  it('未登录时预览 / 转存 / 选目录直接提示登录，不发请求', async () => {
    const { service, sent } = setup({})
    const url = 'https://115.com/s/sw1?password=aaaa'
    expect(await service.snap(url, '')).toEqual({
      ok: false,
      error: '请先在设置 · 网盘里扫码登录 115',
    })
    expect((await service.receive(url, '')).ok).toBe(false)
    expect((await service.dirs('0')).ok).toBe(false)
    expect(sent).toHaveLength(0)
  })

  it('转存到设置里的目标文件夹；链接解析失败给人话', async () => {
    const { service, sent } = setup(
      {
        'https://webapi.115.com/share/snap': SNAP_OK,
        'https://webapi.115.com/share/receive': { state: true, errno: 0 },
      },
      SESSION
    )
    expect(
      await service.receive('https://115.com/s/swh3abc12', 'x1y2')
    ).toEqual({
      ok: true,
    })
    expect(new URLSearchParams(sent[1].body).get('cid')).toBe('42')
    expect(await service.receive('https://pan.quark.cn/s/1', '')).toEqual({
      ok: false,
      error: '不是 115 分享链接',
    })
  })
})

describe('搜索', () => {
  it('走 PanSou 的 fetch：成功返回条目；没填地址时提示去设置', async () => {
    const pansou = fakeFetch({
      'https://so.example.com/api/search': PANSOU_WRAPPED,
    })
    const { transport, sent } = fakeTransport({})
    const deps = {
      transport,
      pansouFetch: pansou.fetch,
      session: memorySession(),
    }
    const result = await createPan115Service({ ...deps, settings }).search(
      '纪录片'
    )
    expect(result.ok && result.items.length).toBe(2)
    expect(sent).toHaveLength(0)
    const none = createPan115Service({
      ...deps,
      settings: { ...settings, pansouUrl: () => '' },
    })
    expect(await none.search('a')).toEqual({
      ok: false,
      error: '请先在设置 · 网盘里填写 PanSou 地址',
    })
  })
})

describe('会话编码（safeStorage 密钥里的 JSON）', () => {
  it('合法、坏 JSON、缺 cookie 三态', () => {
    expect(parseSession(serializeSession(SESSION))).toEqual(SESSION)
    expect(parseSession('{oops')).toBeNull()
    expect(parseSession(JSON.stringify({ userId: '1' }))).toBeNull()
    expect(parseSession('')).toBeNull()
    expect(serializeSession(null)).toBe('')
  })
})

/**
 * 网盘搜索 + 115 转存（MVP）：分享链接解析、PanSou 响应、115 接口与错误码、扫码状态机、服务组合。
 * 全部用假 fetch，不访问外网。
 */
import { describe, expect, it } from 'vitest'

import { create115Client } from '../../src/main/pan115/client'
import { Pan115Error, errnoMessage } from '../../src/main/pan115/errors'
import {
  panSouEndpoint,
  parsePanSouResponse,
  searchPanSou,
} from '../../src/main/pan115/pansou'
import {
  QR_APP,
  createQrLogin,
  qrStatusOf,
} from '../../src/main/pan115/qr-login'
import {
  type Pan115Session,
  createPan115Service,
} from '../../src/main/pan115/service'
import { parseShareLink } from '../../src/main/pan115/share-link'
import {
  FILES_ROOT,
  PANSOU_BARE,
  PANSOU_WRAPPED,
  QR_LOGIN_OK,
  QR_TOKEN,
  SNAP_OK,
  fail,
  fakeFetch,
  qrStatus,
} from './fixtures'

const SESSION: Pan115Session = {
  cookie: 'UID=10086_A1_1; CID=cid-x; SEID=seid-x; KID=kid-x',
  userId: '10086',
  userName: '影盒用户',
}

describe('parseShareLink', () => {
  it('115.com / 115cdn.com / anxia.com，提取码取自 password 参数', () => {
    expect(parseShareLink('https://115.com/s/swh3abc12?password=x1y2')).toEqual(
      { shareCode: 'swh3abc12', receiveCode: 'x1y2' }
    )
    expect(
      parseShareLink('https://115cdn.com/s/swh3abc12?password=x1y2#')
    ).toEqual({ shareCode: 'swh3abc12', receiveCode: 'x1y2' })
    expect(
      parseShareLink('http://anxia.com/s/sw0001?foo=1&password=ab12')
    ).toEqual({
      shareCode: 'sw0001',
      receiveCode: 'ab12',
    })
  })

  it('文字里的「提取码 / 访问码」与单独给的密码', () => {
    expect(parseShareLink('链接：115.com/s/swq1w2e3 提取码：zx98')).toEqual({
      shareCode: 'swq1w2e3',
      receiveCode: 'zx98',
    })
    expect(parseShareLink('https://115.com/s/swq1w2e3#访问码=ab34')).toEqual({
      shareCode: 'swq1w2e3',
      receiveCode: 'ab34',
    })
    expect(parseShareLink('https://115.com/s/swq1w2e3', ' kk11 ')).toEqual({
      shareCode: 'swq1w2e3',
      receiveCode: 'kk11',
    })
  })

  it('链接里的提取码优先于单独给的；没有提取码时为空串', () => {
    expect(
      parseShareLink('https://115.com/s/sw1?password=aaaa', 'bbbb')
    ).toEqual({ shareCode: 'sw1', receiveCode: 'aaaa' })
    expect(parseShareLink('https://115.com/s/sw1')).toEqual({
      shareCode: 'sw1',
      receiveCode: '',
    })
  })

  it('不是 115 分享链接时返回 null', () => {
    expect(parseShareLink('https://pan.quark.cn/s/abcd')).toBeNull()
    expect(parseShareLink('https://evil115.com/s/abcd')).toBeNull()
    expect(parseShareLink('')).toBeNull()
  })
})

describe('PanSou', () => {
  it('解析带 data 外壳的响应：只留可解析的 115 链接，零值时间丢掉', () => {
    expect(parsePanSouResponse(PANSOU_WRAPPED)).toEqual([
      {
        title: '示例纪录片 4K',
        source: 'tg:Channel_Shares_115',
        datetime: '2026-10-01T08:00:00Z',
        url: 'https://115cdn.com/s/swh3abc12?password=x1y2#',
        shareCode: 'swh3abc12',
        receiveCode: 'x1y2',
      },
      {
        title: '示例剧集 全季',
        source: 'plugin:hdr4k',
        datetime: undefined,
        url: 'https://115.com/s/swzz9988',
        shareCode: 'swzz9988',
        receiveCode: 'k9k9',
      },
    ])
  })

  it('解析 README 的裸格式；提取码在链接里时补上', () => {
    const [item] = parsePanSouResponse(PANSOU_BARE)
    expect(item.receiveCode).toBe('abcd')
    expect(item.title).toBe('裸格式条目')
  })

  it('没有 115 结果时为空数组；code 非 0 时抛出服务给的信息', () => {
    expect(parsePanSouResponse({ code: 0, data: { total: 0 } })).toEqual([])
    expect(() =>
      parsePanSouResponse({ code: 400, message: '关键词不能为空' })
    ).toThrow('关键词不能为空')
    expect(() => parsePanSouResponse('oops')).toThrow(Pan115Error)
  })

  it('地址：补 /api/search，去掉末尾斜杠，只接受 http(s)', () => {
    expect(panSouEndpoint('https://so.example.com/')).toBe(
      'https://so.example.com/api/search'
    )
    expect(panSouEndpoint(' http://192.168.1.5:8888 ')).toBe(
      'http://192.168.1.5:8888/api/search'
    )
    expect(() => panSouEndpoint('')).toThrow('PanSou')
    expect(() => panSouEndpoint('ftp://x')).toThrow('PanSou')
  })

  it('POST JSON：kw、只要 115、merge 结果', async () => {
    const { fetch, sent } = fakeFetch({
      'https://so.example.com/api/search': PANSOU_WRAPPED,
    })
    const items = await searchPanSou(
      fetch,
      'https://so.example.com',
      ' 纪录片 '
    )
    expect(items).toHaveLength(2)
    expect(sent[0].method).toBe('POST')
    expect(sent[0].headers['content-type']).toContain('application/json')
    expect(JSON.parse(sent[0].body)).toEqual({
      kw: '纪录片',
      cloud_types: ['115'],
      res: 'merge',
    })
  })

  it('HTTP 失败转成人话', async () => {
    const { fetch } = fakeFetch({
      'https://so.example.com': new Response('x', { status: 502 }),
    })
    await expect(
      searchPanSou(fetch, 'https://so.example.com', 'a')
    ).rejects.toThrow('PanSou 返回 HTTP 502')
  })
})

describe('errnoMessage', () => {
  it('常见错误码', () => {
    expect(errnoMessage(4100024)).toContain('已经接收过')
    expect(errnoMessage(4100008)).toContain('提取码')
    expect(errnoMessage(4100010)).toContain('取消')
    expect(errnoMessage(4100018)).toContain('过期')
    expect(errnoMessage(911)).toContain('安全验证')
    expect(errnoMessage(99)).toContain('重新扫码登录')
    expect(errnoMessage(990001)).toContain('重新扫码登录')
  })

  it('不认识的错误码用 115 的原文，再没有就带上错误码', () => {
    expect(errnoMessage(123, '空间不足')).toBe('空间不足')
    expect(errnoMessage(123)).toBe('115 返回错误（123）')
  })
})

describe('115 webapi', () => {
  const ref = { shareCode: 'swh3abc12', receiveCode: 'x1y2' }

  it('请求带 Cookie、Referer、UA', async () => {
    const { fetch, sent } = fakeFetch({
      'https://webapi.115.com/share/snap': SNAP_OK,
    })
    await create115Client(fetch, SESSION).snap(ref)
    expect(sent[0].headers.cookie).toBe(SESSION.cookie)
    expect(sent[0].headers.referer).toBe('https://115.com/')
    expect(sent[0].headers['user-agent']).toMatch(/Mozilla/)
  })

  it('snap：查询参数与文件列表', async () => {
    const { fetch, sent } = fakeFetch({
      'https://webapi.115.com/share/snap': SNAP_OK,
    })
    const snap = await create115Client(fetch, SESSION).snap(ref)
    const url = new URL(sent[0].url)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      share_code: 'swh3abc12',
      receive_code: 'x1y2',
      offset: '0',
      limit: '100',
      cid: '',
    })
    expect(snap).toEqual({
      title: '示例纪录片',
      count: 2,
      files: [
        { id: '900', name: '第一季', size: 0, isDir: true },
        { id: '901', name: 'S01E01.mkv', size: 1024, isDir: false },
      ],
    })
  })

  it('snap 失败按错误码抛出', async () => {
    const { fetch } = fakeFetch({
      'https://webapi.115.com/share/snap': fail(4100008),
    })
    await expect(create115Client(fetch, SESSION).snap(ref)).rejects.toThrow(
      '提取码'
    )
  })

  it('receive：表单 POST，file_id 为快照里全部顶层条目', async () => {
    const { fetch, sent } = fakeFetch({
      'https://webapi.115.com/share/snap': SNAP_OK,
      'https://webapi.115.com/share/receive': { state: true, errno: 0 },
    })
    await create115Client(fetch, SESSION).receive(ref, '777')
    const post = sent[1]
    expect(post.method).toBe('POST')
    expect(post.headers['content-type']).toContain(
      'application/x-www-form-urlencoded'
    )
    expect(Object.fromEntries(new URLSearchParams(post.body))).toEqual({
      share_code: 'swh3abc12',
      receive_code: 'x1y2',
      file_id: '900,901',
      cid: '777',
      user_id: '10086',
    })
  })

  it('receive 的各个错误码', async () => {
    for (const [errno, text] of [
      [4100024, '已经接收过'],
      [4100010, '取消'],
      [4100018, '过期'],
      [911, '安全验证'],
      [99, '重新扫码登录'],
    ] as const) {
      const { fetch } = fakeFetch({
        'https://webapi.115.com/share/snap': SNAP_OK,
        'https://webapi.115.com/share/receive': fail(errno),
      })
      await expect(
        create115Client(fetch, SESSION).receive(ref, '0')
      ).rejects.toThrow(text)
    }
  })

  it('dirs：只留文件夹，带面包屑', async () => {
    const { fetch, sent } = fakeFetch({
      'https://webapi.115.com/files': FILES_ROOT,
    })
    const listing = await create115Client(fetch, SESSION).dirs('0')
    const url = new URL(sent[0].url)
    expect(url.searchParams.get('cid')).toBe('0')
    expect(url.searchParams.get('show_dir')).toBe('1')
    expect(listing).toEqual({
      cid: '0',
      path: [{ cid: '0', name: '根目录' }],
      dirs: [
        { cid: '10', name: '电影' },
        { cid: '11', name: '剧集' },
      ],
    })
  })

  it('错误信息里不带 Cookie', async () => {
    const { fetch } = fakeFetch({
      'https://webapi.115.com/files': fail(1, SESSION.cookie),
    })
    const error = await create115Client(fetch, SESSION)
      .dirs('0')
      .catch((e: Error) => e)
    expect(String((error as Error).message)).not.toContain('SEID')
  })
})

describe('扫码登录', () => {
  it('用不挤掉网页端 / 手机端的支付宝小程序端', () => {
    expect(QR_APP).toBe('alipaymini')
  })

  it('状态码映射', () => {
    expect(qrStatusOf(qrStatus(0))).toBe('waiting')
    expect(qrStatusOf(qrStatus(1))).toBe('scanned')
    expect(qrStatusOf(qrStatus(2))).toBe('confirmed')
    expect(qrStatusOf(qrStatus(-1))).toBe('expired')
    expect(qrStatusOf(qrStatus(-2))).toBe('canceled')
    expect(qrStatusOf({ state: 0 })).toBe('error')
    expect(qrStatusOf(qrStatus(9))).toBe('error')
  })

  it('取二维码 → 查状态（带 uid / time / sign）→ 按 app 换 Cookie', async () => {
    const { fetch, sent } = fakeFetch({
      'https://qrcodeapi.115.com/api/1.0/web/1.0/token': QR_TOKEN,
      'https://qrcodeapi.115.com/get/status': qrStatus(2),
      'https://passportapi.115.com/app/1.0/alipaymini/1.0/login/qrcode':
        QR_LOGIN_OK,
    })
    const login = createQrLogin(fetch)
    const ticket = await login.start()
    expect(ticket.uid).toBe('qr-uid-1')
    expect(ticket.imageUrl).toBe(
      'https://qrcodeapi.115.com/api/1.0/mac/1.0/qrcode?uid=qr-uid-1'
    )
    expect(await login.poll(ticket)).toBe('confirmed')
    const status = new URL(sent[1].url).searchParams
    expect(Object.fromEntries(status)).toEqual({
      uid: 'qr-uid-1',
      time: '1761350400',
      sign: 'sig-1',
    })
    const session = await login.finish(ticket)
    expect(session).toEqual(SESSION)
    expect(sent[2].method).toBe('POST')
    expect(Object.fromEntries(new URLSearchParams(sent[2].body))).toEqual({
      app: 'alipaymini',
      account: 'qr-uid-1',
    })
  })

  it('换 Cookie 失败时抛出 115 的信息', async () => {
    const { fetch } = fakeFetch({
      'https://passportapi.115.com/': { state: 0, error: '登录失败', errno: 1 },
    })
    await expect(
      createQrLogin(fetch).finish({
        uid: 'u',
        time: 1,
        sign: 's',
        imageUrl: '',
      })
    ).rejects.toThrow('登录失败')
  })
})

/** 内存里的会话存放，模拟 safeStorage 密钥 */
function memorySession(initial: Pan115Session | null = null): {
  read: () => Pan115Session | null
  write: (s: Pan115Session | null) => Promise<void>
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

describe('createPan115Service', () => {
  const settings = {
    pansouUrl: () => 'https://so.example.com',
    targetCid: () => '42',
  }

  it('扫码流程：start → poll 等待 → poll 确认后保存会话并返回账号', async () => {
    let n = 0
    const { fetch } = fakeFetch({
      'https://qrcodeapi.115.com/api/1.0/web/1.0/token': QR_TOKEN,
      'https://qrcodeapi.115.com/get/status': () => qrStatus(n++ === 0 ? 1 : 2),
      'https://passportapi.115.com/': QR_LOGIN_OK,
    })
    const session = memorySession()
    const service = createPan115Service({ fetch, settings, session })
    expect((await service.loginStart()).ok).toBe(true)
    expect(await service.loginPoll()).toEqual({ status: 'scanned' })
    expect(await service.loginPoll()).toEqual({
      status: 'done',
      account: { loggedIn: true, userId: '10086', userName: '影盒用户' },
    })
    expect(session.value()).toEqual(SESSION)
    expect(await service.loginPoll()).toEqual({
      status: 'error',
      error: '请先获取二维码',
    })
  })

  it('二维码过期后需要重新获取', async () => {
    const { fetch } = fakeFetch({
      'https://qrcodeapi.115.com/api/1.0/web/1.0/token': QR_TOKEN,
      'https://qrcodeapi.115.com/get/status': qrStatus(-1),
    })
    const service = createPan115Service({
      fetch,
      settings,
      session: memorySession(),
    })
    await service.loginStart()
    expect(await service.loginPoll()).toEqual({ status: 'expired' })
    expect((await service.loginPoll()).status).toBe('error')
  })

  it('账号状态与退出：不返回 Cookie', async () => {
    const session = memorySession(SESSION)
    const { fetch } = fakeFetch({})
    const service = createPan115Service({ fetch, settings, session })
    const account = await service.account()
    expect(account).toEqual({
      loggedIn: true,
      userId: '10086',
      userName: '影盒用户',
    })
    expect(JSON.stringify(account)).not.toContain('SEID')
    await service.logout()
    expect(session.value()).toBeNull()
    expect(await service.account()).toEqual({ loggedIn: false })
  })

  it('未登录时预览 / 转存 / 选目录直接提示登录，不发请求', async () => {
    const { fetch, sent } = fakeFetch({})
    const service = createPan115Service({
      fetch,
      settings,
      session: memorySession(),
    })
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
    const { fetch, sent } = fakeFetch({
      'https://webapi.115.com/share/snap': SNAP_OK,
      'https://webapi.115.com/share/receive': { state: true, errno: 0 },
    })
    const service = createPan115Service({
      fetch,
      settings,
      session: memorySession(SESSION),
    })
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

  it('搜索：成功返回条目，失败返回错误信息', async () => {
    const ok = fakeFetch({
      'https://so.example.com/api/search': PANSOU_WRAPPED,
    })
    const service = createPan115Service({
      fetch: ok.fetch,
      settings,
      session: memorySession(),
    })
    const result = await service.search('纪录片')
    expect(result.ok && result.items.length).toBe(2)
    const none = createPan115Service({
      fetch: ok.fetch,
      settings: { ...settings, pansouUrl: () => '' },
      session: memorySession(),
    })
    expect(await none.search('a')).toEqual({
      ok: false,
      error: '请先在设置 · 网盘里填写 PanSou 地址',
    })
  })
})

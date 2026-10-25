/**
 * 115 / PanSou 接口的响应样例（按公开实现整理的字段形状，不含真实账号数据）与假 fetch。
 */
import { vi } from 'vitest'

/** 一次请求的记录 */
export interface SentRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: string
}

/** 按 URL 前缀返回 JSON 的假 fetch；记录每次请求 */
export function fakeFetch(
  routes: Record<string, unknown | ((req: SentRequest) => unknown)>
): {
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  sent: SentRequest[]
} {
  const sent: SentRequest[] = []
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v))
    const req: SentRequest = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body:
        typeof init?.body === 'string' ? init.body : String(init?.body ?? ''),
    }
    sent.push(req)
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find(prefix => url.startsWith(prefix))
    if (!key) return new Response('not found', { status: 404 })
    const route = routes[key]
    const value = typeof route === 'function' ? route(req) : route
    if (value instanceof Response) return value
    return new Response(JSON.stringify(value), {
      headers: { 'content-type': 'application/json' },
    })
  })
  return { fetch, sent }
}

/** PanSou 公共实例的返回（外面包一层 code / data） */
export const PANSOU_WRAPPED = {
  code: 0,
  message: 'success',
  data: {
    total: 3,
    merged_by_type: {
      '115': [
        {
          url: 'https://115cdn.com/s/swh3abc12?password=x1y2#',
          password: 'x1y2',
          note: '示例纪录片 4K',
          datetime: '2026-10-01T08:00:00Z',
          source: 'tg:Channel_Shares_115',
        },
        {
          url: 'https://115.com/s/swzz9988',
          password: 'k9k9',
          note: '示例剧集 全季',
          datetime: '0001-01-01T00:00:00Z',
          source: 'plugin:hdr4k',
        },
        {
          url: 'https://example.com/not-115',
          password: '',
          note: '坏链接',
          datetime: '',
          source: 'unknown',
        },
      ],
      quark: [
        {
          url: 'https://pan.quark.cn/s/aaaa',
          password: '',
          note: '别的网盘',
          source: 'tg:x',
        },
      ],
    },
  },
}

/** README 里的裸格式（没有外层 data） */
export const PANSOU_BARE = {
  total: 1,
  merged_by_type: {
    '115': [
      {
        url: 'https://115.com/s/swbare001?password=abcd',
        password: '',
        note: '裸格式条目',
        datetime: '2026-09-09T09:09:09Z',
        source: 'plugin:x',
      },
    ],
  },
}

/** 扫码：取二维码 token */
export const QR_TOKEN = {
  state: 1,
  code: 0,
  message: '',
  data: {
    uid: 'qr-uid-1',
    time: 1761350400,
    sign: 'sig-1',
    qrcode: 'https://115.com/scan/dg-qr-uid-1',
  },
}

/** 扫码状态 */
export const qrStatus = (status: number): unknown => ({
  state: 1,
  code: 0,
  message: '',
  data: { msg: '', status, version: '' },
})

/** 扫码确认后换 Cookie */
export const QR_LOGIN_OK = {
  state: 1,
  error: '',
  errno: 0,
  data: {
    user_id: 10086,
    user_name: '影盒用户',
    cookie: { UID: '10086_A1_1', CID: 'cid-x', SEID: 'seid-x', KID: 'kid-x' },
  },
}

/** 分享快照：一个目录 + 一个文件 */
export const SNAP_OK = {
  state: true,
  error: '',
  errno: 0,
  data: {
    shareinfo: { share_title: '示例纪录片', file_size: '2048' },
    count: 2,
    list: [
      { cid: '900', n: '第一季', s: 0 },
      { fid: '901', cid: '0', n: 'S01E01.mkv', s: 1024 },
    ],
  },
}

/** 115 webapi 失败 */
export const fail = (errno: number, error = '原始错误'): unknown => ({
  state: false,
  error,
  errno,
})

/** 目录列表：根目录下两个文件夹 + 一个文件 */
export const FILES_ROOT = {
  state: true,
  errno: 0,
  count: 3,
  path: [{ cid: 0, name: '根目录' }],
  data: [
    { cid: '10', pid: '0', n: '电影' },
    { cid: '11', pid: '0', n: '剧集' },
    { fid: '12', cid: '0', n: 'readme.txt' },
  ],
}

/**
 * 115 扫码登录（流程参考 ChenyangGao/p115client）：
 * 取二维码 token → 手机 115 扫码 → 轮询 /get/status/ → 按 app 类型换 Cookie。
 *
 * app 用「115生活 · 支付宝小程序」（alipaymini）：同一 app 类型只能登一处，新登录会挤掉旧的；
 * 选一个用户平时不用的端，就不会踢掉网页端和手机 App 的登录。
 */
import { Pan115Error } from './errors'
import { type FetchLike, USER_AGENT, fetchJson, obj, text } from './http'
import type { Pan115Session } from './client'

/** 换 Cookie 时绑定的 app 类型 */
export const QR_APP = 'alipaymini'

const QR_API = 'https://qrcodeapi.115.com'
const HEADERS = { Referer: 'https://115.com/', 'User-Agent': USER_AGENT }

/** 一张二维码 */
export interface QrTicket {
  uid: string
  time: number
  sign: string
  /** 二维码图片地址 */
  imageUrl: string
}

/** 二维码状态 */
export type QrStatus =
  | 'waiting'
  | 'scanned'
  | 'confirmed'
  | 'expired'
  | 'canceled'
  | 'error'

const STATUS: Record<number, QrStatus> = {
  0: 'waiting',
  1: 'scanned',
  2: 'confirmed',
  [-1]: 'expired',
  [-2]: 'canceled',
}

/** /get/status/ 的响应 → 状态 */
export function qrStatusOf(json: unknown): QrStatus {
  const root = obj(json)
  if (!root.state) return 'error'
  const status = obj(root.data).status
  return (typeof status === 'number' && STATUS[status]) || 'error'
}

/** 扫码登录的三步 */
export function createQrLogin(fetch: FetchLike): {
  start(): Promise<QrTicket>
  poll(ticket: QrTicket): Promise<QrStatus>
  finish(ticket: QrTicket): Promise<Pan115Session>
} {
  return {
    async start() {
      const json = obj(
        await fetchJson(fetch, '115', `${QR_API}/api/1.0/web/1.0/token/`, {
          headers: HEADERS,
        })
      )
      const data = obj(json.data)
      const uid = text(data.uid)
      if (!json.state || !uid) throw new Pan115Error('取二维码失败，请稍后再试')
      return {
        uid,
        time: Number(data.time) || 0,
        sign: text(data.sign),
        imageUrl: `${QR_API}/api/1.0/mac/1.0/qrcode?uid=${encodeURIComponent(uid)}`,
      }
    },

    async poll(ticket) {
      const query = new URLSearchParams({
        uid: ticket.uid,
        time: String(ticket.time),
        sign: ticket.sign,
      })
      return qrStatusOf(
        await fetchJson(fetch, '115', `${QR_API}/get/status/?${query}`, {
          headers: HEADERS,
        })
      )
    },

    async finish(ticket) {
      const json = obj(
        await fetchJson(
          fetch,
          '115',
          `https://passportapi.115.com/app/1.0/${QR_APP}/1.0/login/qrcode/`,
          {
            method: 'POST',
            headers: {
              ...HEADERS,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              app: QR_APP,
              account: ticket.uid,
            }).toString(),
          }
        )
      )
      const data = obj(json.data)
      const cookie = Object.entries(obj(data.cookie))
        .map(([key, value]) => `${key}=${text(value)}`)
        .join('; ')
      if (!json.state || !cookie)
        throw new Pan115Error(
          text(json.error) || text(json.message) || '扫码登录失败'
        )
      return {
        cookie,
        userId: text(data.user_id),
        userName: text(data.user_name),
      }
    },
  }
}

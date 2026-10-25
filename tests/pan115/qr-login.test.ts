/**
 * 115 扫码登录三步：取二维码、查状态、按 app 换 Cookie。
 */
import { describe, expect, it } from 'vitest'

import {
  QR_APP,
  createQrLogin,
  qrStatusOf,
} from '../../src/main/pan115/qr-login'
import { QR_LOGIN_OK, QR_TOKEN, fakeFetch, qrStatus } from './fixtures'

describe('扫码登录', () => {
  it('用不挤掉网页端 / 手机端的支付宝小程序端', () => {
    expect(QR_APP).toBe('alipaymini')
  })

  it('状态码映射；未知状态与缺状态为 error', () => {
    expect(qrStatusOf(qrStatus(0))).toBe('waiting')
    expect(qrStatusOf(qrStatus(1))).toBe('scanned')
    expect(qrStatusOf(qrStatus(2))).toBe('confirmed')
    expect(qrStatusOf(qrStatus(-1))).toBe('expired')
    expect(qrStatusOf(qrStatus(-2))).toBe('canceled')
    expect(qrStatusOf({ state: 0 })).toBe('error')
    expect(qrStatusOf(qrStatus(9))).toBe('error')
  })

  it('state 为假但带了过期 / 取消状态时，以状态为准', () => {
    expect(qrStatusOf({ state: 0, data: { status: -1 } })).toBe('expired')
    expect(qrStatusOf({ state: 0, data: { status: -2 } })).toBe('canceled')
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
    expect(Object.fromEntries(new URL(sent[1].url).searchParams)).toEqual({
      uid: 'qr-uid-1',
      time: '1761350400',
      sign: 'sig-1',
    })
    const session = await login.finish(ticket)
    expect(session).toEqual({
      cookie: 'UID=10086_A1_1; CID=cid-x; SEID=seid-x; KID=kid-x',
      userId: '10086',
      userName: '影盒用户',
    })
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

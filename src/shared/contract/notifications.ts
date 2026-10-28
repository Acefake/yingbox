import { call, defineDomain, oneOf, str } from './define'

/** 推送渠道。 */
export const NOTIFY_CHANNELS = ['system', 'bark', 'telegram'] as const

/** 推送渠道。 */
export type NotifyChannelId = (typeof NOTIFY_CHANNELS)[number]

/** 测试推送的结果。 */
export interface NotifyTestResult {
  ok: boolean
  /** 失败原因（已打码）；成功为 null */
  error: string | null
}

/**
 * 入库推送（见 src/main/notify）：开关、Bark 服务器、chat id 是普通设置 notify.*，
 * Bark key 与 Telegram token 只写不读；桌面与 NAS 共用配置状态、密钥保存和测试接口。
 */
export const notifications = defineDomain('notifications', {
  /** 只返回密钥是否已保存，不返回明文。 */
  configured: call<{ bark: boolean; telegram: boolean }>(),
  /** 保存或清除一个推送渠道密钥。 */
  setSecret: call<[channel: 'bark' | 'telegram', value: string], void>(a => [
    oneOf(a[0], 'channel', ['bark', 'telegram'] as const),
    str(a[1], 'value'),
  ]),
  /** 往一个渠道发一条测试消息（不看开关，只看配置有没有填齐） */
  test: call<[channel: NotifyChannelId], NotifyTestResult>(a => [
    oneOf(a[0], 'channel', NOTIFY_CHANNELS),
  ]),
})

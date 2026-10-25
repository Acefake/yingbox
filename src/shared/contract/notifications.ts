import { call, defineDomain, oneOf } from './define'

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
 * Bark key 与 Telegram token 是密钥（settings.setSecret）；这里只给「发一条测试」。
 */
export const notifications = defineDomain('notifications', {
  /** 往一个渠道发一条测试消息（不看开关，只看配置有没有填齐） */
  test: call<[channel: NotifyChannelId], NotifyTestResult>(a => [
    oneOf(a[0], 'channel', NOTIFY_CHANNELS),
  ]),
})

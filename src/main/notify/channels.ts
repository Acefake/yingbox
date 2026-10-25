/**
 * 推送渠道：Bark（自建或官方服务器）与 Telegram Bot。系统通知由 index.ts 用 Electron Notification 发。
 *
 * fetch 注入（主进程里是 Electron net.fetch，走系统代理；测试用假的）。Bark 服务器是用户自己填的地址，
 * 常在局域网 NAS 上，所以不做私网拦截（同 PanSou），但不跟随重定向。密钥不进日志，报错前打码。
 */
import { type NotifyMessage, redact } from './notify-rules'

/** 渠道 */
export type NotifyChannel = 'system' | 'bark' | 'telegram'

/** 渠道配置（密钥明文只在主进程内存里）。 */
export interface BarkConfig {
  server: string
  key: string
}
export interface TelegramConfig {
  token: string
  chatId: string
}

/** 注入的 fetch（标准 fetch 的子集）。 */
export type NotifyFetch = (
  url: string,
  init: {
    method: 'POST'
    headers: Record<string, string>
    body: string
    redirect: 'error'
    signal: AbortSignal
  }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

const TIMEOUT_MS = 15_000

/** Bark 服务器地址：http(s)，去掉结尾斜杠；不合法返回 null。 */
export function barkServer(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

async function post(
  fetch: NotifyFetch,
  url: string,
  payload: unknown,
  secrets: string[]
): Promise<string> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const text = await response.text().catch(() => '')
    if (!response.ok)
      throw new Error(`HTTP ${response.status} ${text.slice(0, 200)}`)
    return text
  } catch (error) {
    throw new Error(redact((error as Error).message, secrets))
  }
}

/** Bark：POST <server>/push（bark-server v2 的 JSON 接口），分组「影盒」。 */
export async function sendBark(
  fetch: NotifyFetch,
  config: BarkConfig,
  message: NotifyMessage
): Promise<void> {
  const server = barkServer(config.server)
  if (!server) throw new Error('Bark 服务器地址不对')
  const text = await post(
    fetch,
    `${server}/push`,
    {
      device_key: config.key,
      title: message.title,
      body: message.body,
      group: '影盒',
    },
    [config.key]
  )
  const code = (() => {
    try {
      return (JSON.parse(text) as { code?: number }).code
    } catch {
      return undefined
    }
  })()
  if (code !== undefined && code !== 200) throw new Error(`Bark 返回 ${code}`)
}

/** Telegram Bot：sendMessage（纯文本，标题加粗用不着，第一行就是标题）。 */
export async function sendTelegram(
  fetch: NotifyFetch,
  config: TelegramConfig,
  message: NotifyMessage
): Promise<void> {
  const text = await post(
    fetch,
    `https://api.telegram.org/bot${config.token}/sendMessage`,
    {
      chat_id: config.chatId,
      text: `${message.title}\n${message.body}`,
      disable_web_page_preview: true,
    },
    [config.token]
  )
  let ok = true
  try {
    ok = (JSON.parse(text) as { ok?: boolean }).ok !== false
  } catch {
    // 不是 JSON 也按 HTTP 状态算成功
  }
  if (!ok) throw new Error('Telegram 拒绝了这条消息')
}

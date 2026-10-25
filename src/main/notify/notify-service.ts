/**
 * 入库推送服务：收片库新入库与追更入库，按类型开关过滤、同一条只推一次、（可选）1 分钟内合并，
 * 然后发到打开了的渠道（系统通知 / Bark / Telegram）。不依赖 Electron，配置、发送、时钟都注入。
 *
 * - 去重：同一个键 {@link DEDUPE_MS} 内只推一次（追更入库与片库新入库对同一集共用键，见 notify-rules.ts）；
 * - 合并：开着时第一条进来起等 {@link MERGE_WINDOW_MS}，到点把这期间的全部合成一条；关着时逐条发；
 * - 某个渠道失败只记日志（已打码），不影响其它渠道，也不重发。
 */
import type { LibraryArrival } from '../../shared/library/arrivals'
import {
  type BarkConfig,
  type NotifyChannel,
  type NotifyFetch,
  type TelegramConfig,
  sendBark,
  sendTelegram,
} from './channels'
import {
  type LandedEpisode,
  type NotifyItem,
  type NotifyKind,
  type NotifyMessage,
  formatMessage,
  itemFromArrival,
  itemFromLanded,
} from './notify-rules'

/** 合并窗口。 */
export const MERGE_WINDOW_MS = 60_000
/** 同一条多久内不重复推。 */
export const DEDUPE_MS = 24 * 3_600_000

/** 当前配置（每次发送前现读，改设置立即生效）。 */
export interface NotifyConfig {
  /** 各渠道开没开 */
  enabled: Record<NotifyChannel, boolean>
  /** 没填齐为 null */
  bark: BarkConfig | null
  telegram: TelegramConfig | null
  kinds: Record<NotifyKind, boolean>
  merge: boolean
}

/** 依赖。 */
export interface NotifyServiceDeps {
  config: () => NotifyConfig
  /** 弹系统通知 */
  showSystem: (message: NotifyMessage) => void
  fetch: NotifyFetch
  /** 这一集是不是追更转存、还在等入库的 */
  autograbSaved: (seriesId: number, season: number, episode: number) => boolean
  now?: () => number
  log?: (message: string) => void
}

/** 推送服务。 */
export interface NotifyService {
  arrivals(list: readonly LibraryArrival[]): void
  landed(records: readonly LandedEpisode[]): void
  /** 往一个渠道发一条测试消息（不看开关，只看配置有没有填齐）。 */
  test(channel: NotifyChannel): Promise<void>
  /** 立即发出合并中的消息（退出前 / 测试）。 */
  flush(): Promise<void>
}

/** 打开了且填齐了的渠道。 */
function active(config: NotifyConfig): {
  bark: BarkConfig | null
  telegram: TelegramConfig | null
} {
  return {
    bark: config.enabled.bark ? config.bark : null,
    telegram: config.enabled.telegram ? config.telegram : null,
  }
}

/** 创建推送服务。 */
export function createNotifyService(deps: NotifyServiceDeps): NotifyService {
  const now = deps.now ?? Date.now
  const log = deps.log ?? (() => {})
  const sent = new Map<string, number>()
  let buffer: NotifyItem[] = []
  let timer: ReturnType<typeof setTimeout> | undefined

  async function deliver(
    message: NotifyMessage,
    config: NotifyConfig
  ): Promise<void> {
    const jobs: Array<[string, () => Promise<void> | void]> = []
    if (config.enabled.system)
      jobs.push(['系统通知', () => deps.showSystem(message)])
    const { bark, telegram } = active(config)
    if (bark) jobs.push(['Bark', () => sendBark(deps.fetch, bark, message)])
    if (telegram) {
      jobs.push(['Telegram', () => sendTelegram(deps.fetch, telegram, message)])
    }
    await Promise.all(
      jobs.map(async ([name, run]) => {
        try {
          await run()
        } catch (error) {
          log(`${name}推送失败：${(error as Error).message}`)
        }
      })
    )
  }

  async function flush(): Promise<void> {
    clearTimeout(timer)
    timer = undefined
    const items = buffer
    buffer = []
    if (items.length) await deliver(formatMessage(items), deps.config())
  }

  function accept(items: NotifyItem[]): void {
    const config = deps.config()
    const at = now()
    for (const [key, time] of sent) if (at - time > DEDUPE_MS) sent.delete(key)
    const fresh = items.filter(item => {
      if (!config.kinds[item.kind] || sent.has(item.key)) return false
      sent.set(item.key, at)
      return true
    })
    if (!fresh.length) return
    const { bark, telegram } = active(config)
    if (!config.enabled.system && !bark && !telegram) return
    if (!config.merge) {
      for (const item of fresh) void deliver(formatMessage([item]), config)
      return
    }
    buffer.push(...fresh)
    if (!timer) {
      timer = setTimeout(() => void flush(), MERGE_WINDOW_MS)
      timer.unref?.()
    }
  }

  return {
    arrivals: list =>
      accept(list.map(a => itemFromArrival(a, deps.autograbSaved))),
    landed: records => accept(records.map(itemFromLanded)),
    flush,
    async test(channel) {
      const config = deps.config()
      const message: NotifyMessage = {
        title: '影盒推送测试',
        body: '能看到这条，说明推送设置好了',
      }
      if (channel === 'system') return deps.showSystem(message)
      if (channel === 'bark') {
        if (!config.bark) throw new Error('先填 Bark 服务器地址和设备 key')
        return sendBark(deps.fetch, config.bark, message)
      }
      if (!config.telegram)
        throw new Error('先填 Telegram Bot token 和 chat id')
      return sendTelegram(deps.fetch, config.telegram, message)
    },
  }
}

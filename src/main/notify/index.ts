/**
 * 入库推送接到 Electron：读设置与密钥（notify.*）、系统通知用 Electron Notification、出网用 net.fetch（走系统代理），
 * 订阅媒体库引擎宣布的新入库，实现 notifications 域（测试推送）。规则在 notify-rules.ts，流程在 notify-service.ts。
 */
import { Notification, net } from 'electron'
import type { NotifyTestResult } from '../../shared/contract/notifications'
import { notifications } from '../../shared/contract/notifications'
import { onLibraryArrivals } from '../library/host'
import { implement } from '../rpc'
import { settingsStore } from '../settings'
import type { NotifyFetch } from './channels'
import type { LandedEpisode, NotifyMessage } from './notify-rules'
import { type NotifyConfig, createNotifyService } from './notify-service'

/** 设置 → 当前配置（每次现读）。 */
function readConfig(): NotifyConfig {
  const store = settingsStore()
  const barkKey = store.getSecret('notify.bark.key')
  const barkServer = store.get('notify.bark.server')
  const token = store.getSecret('notify.telegram.token')
  const chatId = store.get('notify.telegram.chatId')
  return {
    enabled: {
      system: store.get('notify.system'),
      bark: store.get('notify.bark.enabled'),
      telegram: store.get('notify.telegram.enabled'),
    },
    bark: barkKey && barkServer ? { server: barkServer, key: barkKey } : null,
    telegram: token && chatId ? { token, chatId } : null,
    kinds: {
      autograb: store.get('notify.on.autograb'),
      episode: store.get('notify.on.episode'),
      movie: store.get('notify.on.movie'),
    },
    merge: store.get('notify.merge'),
  }
}

function showSystem(message: NotifyMessage): void {
  if (!Notification.isSupported()) throw new Error('系统不支持通知')
  new Notification({ title: message.title, body: message.body }).show()
}

/** 入库推送的入口；返回给追更用的「追更入库」口。 */
export interface NotifyHub {
  landed(records: readonly LandedEpisode[]): void
}

/**
 * 注册入库推送（initSettings、registerLibraryIpc 之后调用一次）。
 * @param autograbSaved 这一集是不是追更转存、还在等入库的（追更模块注册后才有，之前一律 false）
 */
export function registerNotify(
  autograbSaved: (seriesId: number, season: number, episode: number) => boolean
): NotifyHub {
  const service = createNotifyService({
    config: readConfig,
    showSystem,
    fetch: net.fetch as unknown as NotifyFetch,
    autograbSaved,
    log: message => console.warn(`[notify] ${message}`),
  })
  onLibraryArrivals(list => service.arrivals(list))
  implement(notifications, {
    configured: () => ({
      bark: !!settingsStore().getSecret('notify.bark.key'),
      telegram: !!settingsStore().getSecret('notify.telegram.token'),
    }),
    setSecret: (_, channel, value) =>
      settingsStore().setSecret(
        channel === 'bark' ? 'notify.bark.key' : 'notify.telegram.token',
        value
      ),
    test: async (_, channel): Promise<NotifyTestResult> => {
      try {
        await service.test(channel)
        return { ok: true, error: null }
      } catch (error) {
        return { ok: false, error: (error as Error).message }
      }
    },
  })
  return { landed: records => service.landed(records) }
}

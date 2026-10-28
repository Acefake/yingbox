import { createNotifyService } from '../main/notify/notify-service'
import type { NotifyFetch } from '../main/notify/channels'
import { notifications } from '../shared/contract/notifications'
import { settingsSchema } from '../shared/settings/schema'
import type { DomainRegistry } from './domains/registry'
import type { FileSecretStore } from './secrets'
import type { ServerSettingsStore } from './settings-store'

/** NAS 入库推送；配置与桌面同源，密钥只在服务端保存，禁用系统通知。 */
export function registerServerNotifications(
  registry: DomainRegistry,
  options: {
    settings: ServerSettingsStore
    secrets: FileSecretStore
    autograbSaved(seriesId: number, season: number, episode: number): boolean
    fetch?: NotifyFetch
    log(message: string): void
  }
): ReturnType<typeof createNotifyService> {
  const { settings, secrets } = options
  const service = createNotifyService({
    config: () => ({
      enabled: {
        system: false,
        bark: settings.get('notify.bark.enabled'),
        telegram: settings.get('notify.telegram.enabled'),
      },
      bark: secrets.get('notify.bark.key')
        ? {
            server: settings.get('notify.bark.server'),
            key: secrets.get('notify.bark.key')!,
          }
        : null,
      telegram:
        secrets.get('notify.telegram.token') &&
        settings.get('notify.telegram.chatId')
          ? {
              token: secrets.get('notify.telegram.token')!,
              chatId: settings.get('notify.telegram.chatId'),
            }
          : null,
      kinds: {
        autograb: settings.get('notify.on.autograb'),
        episode: settings.get('notify.on.episode'),
        movie: settings.get('notify.on.movie'),
      },
      merge: settings.get('notify.merge'),
    }),
    autograbSaved: options.autograbSaved,
    fetch: options.fetch ?? ((url, init) => fetch(url, init)),
    showSystem: () => {
      throw new Error('NAS 不支持系统通知，请使用 Bark 或 Telegram')
    },
    log: options.log,
  })
  registry.implement(notifications, {
    configured: () => ({
      bark: !!secrets.get('notify.bark.key'),
      telegram: !!secrets.get('notify.telegram.token'),
    }),
    setSecret: (_, channel, value) => {
      const key =
        channel === 'bark' ? 'notify.bark.key' : 'notify.telegram.token'
      const parsed = settingsSchema[key].parse(value)
      if (parsed === undefined) throw new Error('密钥格式不合法')
      secrets.set(key, parsed)
    },
    test: async (_, channel) => {
      try {
        await service.test(channel)
        return { ok: true, error: null }
      } catch (error) {
        return { ok: false, error: (error as Error).message }
      }
    },
  })
  return service
}

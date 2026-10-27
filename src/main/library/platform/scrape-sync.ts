/**
 * 刮削偏好下发（两种宿主共用）：主设置（`scrape.metadataLanguage`、`scrape.imageSize.*`）是唯一来源，
 * 宿主启动时下发一次，之后这几个键一变就再下发；片库引擎存进自己的 settings 表（见 scrape-prefs-store.ts）。
 * 桌面端的设置在 settings.json（src/main/scrape-prefs.ts），独立服务的在服务端设置文件（src/server/app.ts）。
 */
import type { SettingValue } from '../../../shared/settings/schema'
import {
  type ScrapePrefs,
  type ScrapeSettingKey,
  isScrapeSettingKey,
  scrapePrefsFrom,
} from '../../../shared/library/scrape-prefs'

/** 片库引擎的下发口。 */
export interface ScrapePrefsTarget {
  setScrapePrefs(prefs: ScrapePrefs): Promise<unknown>
}

/** 宿主的设置读取与变更订阅。 */
export interface ScrapeSettingsSource {
  get<K extends ScrapeSettingKey>(key: K): SettingValue<K>
  /** 订阅设置变更（参数是变了的键）。 */
  onChange(listener: (key: string) => void): void
}

/**
 * 启动时下发一次，此后刮削相关的键变了就下发。连续变更按顺序排队，最后一次下发的总是最新值。
 * 下发失败只记日志（引擎里仍是上一次的值，下次变更或重启再下发）。
 */
export function syncScrapePrefs(
  target: ScrapePrefsTarget,
  source: ScrapeSettingsSource,
  log: (message: string) => void = message => console.warn(message)
): Promise<void> {
  let queue = Promise.resolve()
  const push = (): Promise<void> => {
    queue = queue
      .then(() => target.setScrapePrefs(scrapePrefsFrom(k => source.get(k))))
      .then(
        () => undefined,
        error => log(`[scrape] 下发刮削偏好失败：${(error as Error).message}`)
      )
    return queue
  }
  source.onChange(key => {
    if (isScrapeSettingKey(key)) void push()
  })
  return push()
}

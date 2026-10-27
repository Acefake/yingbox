/**
 * 桌面端刮削偏好下发：settings.json 里的元数据语言与图片清晰度 → 媒体库引擎（规则见 library/platform/scrape-sync.ts）。
 */
import type { LibraryEngineClient } from './library/host'
import { syncScrapePrefs } from './library/platform/scrape-sync'
import { onSettingChanged, settingsStore } from './settings'

/** 启动时下发一次，之后随设置变更下发。 */
export function registerScrapePrefsSync(client: LibraryEngineClient): void {
  const store = settingsStore()
  void syncScrapePrefs(
    { setScrapePrefs: prefs => client.call('setScrapePrefs', prefs) },
    {
      get: key => store.get(key),
      onChange: listener => onSettingChanged(change => listener(change.key)),
    }
  )
}

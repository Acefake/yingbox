/**
 * 媒体库 IPC 契约 · 刮削偏好：宿主（桌面主进程 / 独立服务）把主设置里的元数据语言与图片清晰度下发给片库引擎。
 *
 * 渲染层不调用：偏好的唯一来源是主设置，宿主在启动和设置变更时下发（见 shared/library/scrape-prefs.ts）。
 */
import type { ScrapePrefs } from '../scrape-prefs'

/** 刮削偏好的方法。 */
export interface ScrapeRpcMap {
  getScrapePrefs: { params: void; result: ScrapePrefs }
  setScrapePrefs: { params: ScrapePrefs; result: ScrapePrefs }
}

/** 方法名白名单（并入 LIBRARY_METHODS）。 */
export const SCRAPE_METHODS = [
  'getScrapePrefs',
  'setScrapePrefs',
] as const satisfies readonly (keyof ScrapeRpcMap)[]

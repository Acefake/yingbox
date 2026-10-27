/**
 * IPC 边界上刮削偏好参数的解析：必须是对象，字段按 parseScrapePrefs 宽松取值（不认识的取默认值）。
 */
import { parseScrapePrefs } from '../scrape-prefs'
import type { ScrapeRpcMap } from './contract-scrape'
import { asRecord } from './validate-base'

/** 刮削偏好方法的参数解析器（并入 PARAM_PARSERS）。 */
export const SCRAPE_PARSERS: {
  [M in keyof ScrapeRpcMap]: (input: unknown) => ScrapeRpcMap[M]['params']
} = {
  getScrapePrefs: () => undefined,
  setScrapePrefs: input => parseScrapePrefs(asRecord(input, '刮削偏好')),
}

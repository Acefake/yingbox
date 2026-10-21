/**
 * 番号站点单测共用：读录制页面、按 URL 返回页面的假上下文（记录每次请求的选项）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  PageOptions,
  SiteContext,
} from '../../../../src/main/library/providers/jav/types'

/** 读 tests/fixtures/jav 下的录制页面。 */
export const fixture = (name: string): string =>
  readFileSync(join(__dirname, '../../../fixtures/jav', name), 'utf8')

/** 一次请求的记录。 */
export interface SeenRequest {
  url: string
  options?: PageOptions
}

/**
 * 假上下文：键是 URL（POST 时是 `POST <url> <body>`），没登记的当 404。
 */
export function pages(
  map: Record<string, string>
): SiteContext & { seen: SeenRequest[] } {
  const seen: SeenRequest[] = []
  return {
    seen,
    page: async (url, options) => {
      seen.push({ url, options })
      const key =
        options?.method === 'POST' ? `POST ${url} ${options.body ?? ''}` : url
      return map[key] ?? null
    },
  }
}

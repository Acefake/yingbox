import { call, defineDomain, optRecord, optStr, str } from './define'
import type { FileResult } from './file'

/** http.fetch 的请求选项 */
export interface HttpFetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

/** http.fetch 的结果：JSON 能解析时 data 为对象，否则为文本且 raw 为 true */
export interface HttpFetchResult {
  success: boolean
  status?: number
  data?: unknown
  raw?: boolean
  error?: string
}

/** 经主进程（带 SSRF 防护）的网络请求。 */
export const http = defineDomain('http', {
  /** 下载到本地文件（原子写） */
  download: call<[url: string, filePath: string], FileResult>(a => [
    str(a[0], 'url'),
    str(a[1], 'filePath'),
  ]),
  /** GET / POST / HEAD 请求 */
  fetch: call<[url: string, options?: HttpFetchOptions], HttpFetchResult>(a => [
    str(a[0], 'url'),
    optRecord<HttpFetchOptions>(a[1], 'options'),
  ]),
  /** 代取图片为 data URL（绕过防盗链，上限 8MB） */
  fetchImage: call<
    [url: string, referer?: string],
    { success: boolean; data?: string; error?: string }
  >(a => [str(a[0], 'url'), optStr(a[1], 'referer')]),
})

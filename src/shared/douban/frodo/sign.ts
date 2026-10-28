/**
 * 豆瓣 frodo（Android 客户端接口）签名。
 *
 * frodo.douban.com/api/v2 的每个 GET 都要带三个查询参数：
 * - `apikey`：豆瓣 Android 客户端里公开流传的 key；
 * - `_ts`：秒级时间戳（服务端实测不校验新旧，但每次请求仍取当前时间）；
 * - `_sig`：`base64(HMAC-SHA1(secret, "GET&" + urlencode(path) + "&" + _ts))`，
 *   path 是 `/api/v2/...`（不含查询串），urlencode 把 `/` 也编码成 `%2F`（Python `quote(path, safe='')`）。
 * 另外必须用豆瓣 Android 客户端的 User-Agent，浏览器 UA 会被拒（403 invalid_apikey）。
 *
 * key / secret 是客户端常量，豆瓣随时可能吊销，失效时整个 frodo 回退就失效，
 * 见 docs/library-refactor/douban-frodo.md。
 *
 * 只用 node:crypto，不依赖 Electron：桌面端两个 utilityProcess 与独立服务共用。
 */
import { createHmac } from 'node:crypto'

/** 接口根地址。 */
export const FRODO_BASE = 'https://frodo.douban.com'
/** 公开的 Android 客户端 apikey。 */
export const FRODO_API_KEY = '0dad551ec0f84ed02907ff5c42e8ec70'
/** 与 apikey 配对的签名密钥。 */
export const FRODO_SECRET = 'bf7dddc7c9cfe6f7'
/** 豆瓣 Android 客户端 UA（与匿名探测报告一致）。 */
export const FRODO_USER_AGENT =
  'api-client/1 com.douban.frodo/7.65.0(275) Android/34 product/sdk_gphone64_arm64 vendor/Google model/sdk_gphone64_arm64 rom/android  network/wifi  platform/AndroidPad'

/**
 * 与 Python `urllib.parse.quote(s, safe='')` 一致的编码：
 * 除字母数字与 `_.-~` 外全部百分号编码（encodeURIComponent 还会放过 `!'()*`，这里补上）。
 */
export function quoteAll(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

/**
 * 计算 `_sig`。
 * @param path 接口路径，形如 `/api/v2/search/movie`（不含主机与查询串）
 * @param ts `_ts` 的值（秒级时间戳字符串）
 * @param method 请求方法，缺省 GET
 */
export function frodoSignature(
  path: string,
  ts: string,
  method: 'GET' | 'POST' = 'GET'
): string {
  const raw = `${method}&${quoteAll(path)}&${ts}`
  return createHmac('sha1', FRODO_SECRET).update(raw).digest('base64')
}

/** 当前时间（毫秒）→ `_ts`（秒）。 */
export const frodoTimestamp = (nowMs: number): string =>
  String(Math.floor(nowMs / 1000))

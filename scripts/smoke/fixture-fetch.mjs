/**
 * 离线冒烟用的出网实现（YINGBOX_FETCH=module:scripts/smoke/fixture-fetch.mjs）：
 * 番号站点页面回放 tests/fixtures/jav 里录制的 HTML，图片地址一律返回一张真实的小 JPEG，其余 404。
 * 让 `pnpm smoke:server` 不依赖外网与站点防护，也能把识别 → 缓存原图 → 生成缩略图整条链路跑一遍。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../tests/fixtures'
)
const page = name => readFileSync(join(root, 'jav', name), 'utf8')

const PAGES = {
  'https://www.javbus.com/SSIS-497': page('javbus-SSIS-497.html'),
  'https://www.avbase.net/works/SSIS-497': page('avbase-work.html'),
  'https://adult.contents.fc2.com/article/3662771/': page('fc2-3662771.html'),
}
const COVER = readFileSync(join(root, 'images', 'cover-800x538.jpg'))

/** 被请求过的地址（调试用）。 */
export const requested = []

/** 出网实现工厂。 */
export function createFetch() {
  return async url => {
    requested.push(url)
    if (PAGES[url])
      return new Response(PAGES[url], {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    if (/\.(jpe?g|png|webp)(\?|$)/i.test(url))
      return new Response(new Uint8Array(COVER), {
        headers: { 'content-type': 'image/jpeg' },
      })
    return new Response('not found', { status: 404 })
  }
}

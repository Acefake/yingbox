/**
 * 网页端 service worker 不能缓存片库视频和带 Content-Encoding 的脚本。
 * /media/files/<id> 没有扩展名，旧缓存策略会拆掉 Range 播放。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sw = readFileSync(
  join(__dirname, '../../src/renderer/public/sw.js'),
  'utf8'
)

describe('service worker 绕过媒体与预压缩资源', () => {
  it('缓存名升到 v2，并跳过 /api/、/media/、/assets/ 和 Range', () => {
    expect(sw).toContain("const CACHE = 'yingbox-shell-v2'")
    expect(sw).not.toContain('yingbox-shell-v1')
    expect(sw).toContain("url.pathname.startsWith('/api/')")
    expect(sw).toContain("url.pathname.startsWith('/media/')")
    expect(sw).toContain("url.pathname.startsWith('/assets/')")
    expect(sw).toContain("req.headers.has('range')")
  })
})

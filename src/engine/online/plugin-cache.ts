/**
 * CatSpider 插件源码的磁盘缓存：命中且未过期直接读盘；过期或未命中时联网拉取，
 * 拉取失败回退到旧缓存。插件地址多经 GitHub 代理，每次联网既慢又容易失败。
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { NetClient } from '../../shared/net/client'

/** 缓存有效期：6 小时 */
export const PLUGIN_TTL_MS = 6 * 60 * 60 * 1000

/** 创建插件加载器。 */
export function createPluginLoader(
  net: NetClient,
  cacheDir: string,
  now: () => number = Date.now
): (url: string) => Promise<string> {
  return async url => {
    const file = join(
      cacheDir,
      `${createHash('sha1').update(url).digest('hex').slice(0, 16)}.js`
    )
    const cached = await stat(file)
      .then(async s => ({
        code: await readFile(file, 'utf-8'),
        mtime: s.mtimeMs,
      }))
      .catch(() => null)
    if (cached && now() - cached.mtime < PLUGIN_TTL_MS) return cached.code
    try {
      const { text } = await net.getText(url, { timeoutMs: 20000 })
      await mkdir(cacheDir, { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      await writeFile(tmp, text, 'utf-8')
      await rename(tmp, file)
      return text
    } catch (error) {
      if (cached) return cached.code
      throw error
    }
  }
}

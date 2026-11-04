/**
 * CatSpider 插件源码的磁盘缓存：命中且未过期直接读盘；过期或未命中时联网拉取，
 * 拉取失败回退到旧缓存。插件地址多经 GitHub 代理，每次联网既慢又容易失败。
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { GITHUB_MIRROR_PREFIX } from '../../shared/release/mirrors'
import type { NetClient } from '../../shared/net/client'

/** 缓存有效期：6 小时 */
export const PLUGIN_TTL_MS = 6 * 60 * 60 * 1000

const PINNED_JSDELIVR =
  /^https:\/\/cdn\.jsdelivr\.net\/gh\/([^/]+)\/([^@/]+)@([0-9a-f]{40})\/(.+)$/

/** 固定到提交的 jsDelivr 地址 → [官方 CDN, GitHub 镜像]；其他地址只有自己。内容靠 sha256 校验，镜像不可信也安全。 */
export function pluginCandidates(url: string): string[] {
  const m = PINNED_JSDELIVR.exec(url)
  if (!m) return [url]
  const [, owner, repo, sha, path] = m
  return [
    url,
    `${GITHUB_MIRROR_PREFIX}https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path}`,
  ]
}

const sha256Of = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex')

/**
 * 创建插件加载器。`expectedSha256` 给出某地址的期望摘要时：缓存和下载的内容都必须匹配，
 * 不匹配的当作失败（ADR-0048）；有摘要的内容不可变，缓存不过期。
 */
export function createPluginLoader(
  net: NetClient,
  cacheDir: string,
  now: () => number = Date.now,
  expectedSha256: (url: string) => string | undefined = () => undefined
): (url: string) => Promise<string> {
  return async url => {
    const file = join(
      cacheDir,
      `${createHash('sha1').update(url).digest('hex').slice(0, 16)}.js`
    )
    const expected = expectedSha256(url)
    const matches = (text: string): boolean =>
      expected === undefined || sha256Of(text) === expected
    const cached = await stat(file)
      .then(async s => ({
        code: await readFile(file, 'utf-8'),
        mtime: s.mtimeMs,
      }))
      .catch(() => null)
    const usable = cached && matches(cached.code) ? cached : null
    if (
      usable &&
      (expected !== undefined || now() - usable.mtime < PLUGIN_TTL_MS)
    )
      return usable.code
    let lastError: unknown = new Error('插件地址不可用')
    for (const candidate of pluginCandidates(url)) {
      try {
        const { text } = await net.getText(candidate, { timeoutMs: 20000 })
        if (!matches(text)) throw new Error('插件脚本校验失败')
        await mkdir(cacheDir, { recursive: true })
        const tmp = `${file}.${process.pid}.tmp`
        await writeFile(tmp, text, 'utf-8')
        await rename(tmp, file)
        return text
      } catch (error) {
        lastError = error
      }
    }
    if (usable) return usable.code
    throw lastError
  }
}

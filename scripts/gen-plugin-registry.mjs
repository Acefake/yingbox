/**
 * 把 src/engine/online/vod-sites.json 的 CatSpider 插件固定到上游提交（ADR-0048）。
 * 每个插件的 ext 改为 jsDelivr 的 `@<提交 SHA>` 地址，并写入脚本内容的 sha256，
 * 引擎加载时校验，上游被改动或代理篡改都不会被执行。
 * 已固定的条目（ext 已是 jsDelivr 固定地址且 sha256 存在）原样保留；`--refresh` 强制重新固定到上游最新提交。
 * 用法：node scripts/gen-plugin-registry.mjs [--refresh]
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

const FILE = new URL('../src/engine/online/vod-sites.json', import.meta.url)
const refresh = process.argv.includes('--refresh')
const PROXY = /^https:\/\/ghp\.xptvhelper\.link\//
const RAW =
  /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(?:refs\/heads\/)?([^/]+)\/(.+)$/
const PINNED =
  /^https:\/\/cdn\.jsdelivr\.net\/gh\/([^/]+)\/([^@/]+)@([0-9a-f]{40})\/(.+)$/

const commits = new Map()
const headOf = async (owner, repo, ref) => {
  const key = `${owner}/${repo}@${ref}`
  if (!commits.has(key)) {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits/${ref}`,
      {
        headers: {
          'User-Agent': 'yingbox-gen',
          Accept: 'application/vnd.github+json',
        },
        signal: AbortSignal.timeout(20000),
      }
    )
    if (!res.ok) throw new Error(`${key} HTTP ${res.status}`)
    commits.set(key, (await res.json()).sha)
  }
  return commits.get(key)
}
const sha256 = async url => {
  let last
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return createHash('sha256')
        .update(await res.text(), 'utf8')
        .digest('hex')
    } catch (error) {
      last = error
    }
  }
  throw new Error(`${url} 下载失败：${last?.cause?.code ?? last?.message}`)
}

const data = JSON.parse(await readFile(FILE, 'utf8'))
const failed = []
for (const site of data.sites) {
  try {
    const pinned = PINNED.exec(site.ext)
    if (pinned && site.sha256 && !refresh) continue
    if (
      !pinned &&
      site.sha256 &&
      !refresh &&
      /^https:\/\/gist\.githubusercontent\.com\/.+\/raw\/[0-9a-f]{40}\//.test(
        site.ext
      )
    )
      continue
    if (/^https:\/\/gist\.githubusercontent\.com\//.test(site.ext)) {
      site.sha256 = await sha256(site.ext)
      continue
    }
    let owner, repo, ref, path
    const fromPinned = PINNED.exec(site.ext)
    if (fromPinned) [, owner, repo, , path] = fromPinned
    else {
      const m = RAW.exec(site.ext.replace(PROXY, ''))
      if (!m) throw new Error(`无法解析 ${site.ext}`)
      ;[, owner, repo, ref, path] = m
    }
    const sha = await headOf(owner, repo, fromPinned || !ref ? 'HEAD' : ref)
    const ext = `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${sha}/${path}`
    site.sha256 = await sha256(ext)
    site.ext = ext
  } catch (error) {
    failed.push(`${site.name}: ${error.message}`)
  }
}
if (failed.length) {
  console.error(`固定失败 ${failed.length} 个，未写入：\n${failed.join('\n')}`)
  process.exit(1)
}
await writeFile(FILE, `${JSON.stringify(data, null, 2)}\n`)
console.log(
  `已固定 ${data.sites.length} 个插件，提交 ${[...commits.values()].map(s => s.slice(0, 7)).join(', ')}`
)

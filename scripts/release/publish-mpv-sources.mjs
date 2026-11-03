/**
 * 把 mpv 对应源码包放到固定发布 mpv-sources-<id>（只传一次，不进版本发布）。需要 gh 已登录。
 *   node scripts/release/publish-mpv-sources.mjs <dist 目录> [--tag-only]   --tag-only 只输出标签，不发布
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 源码包文件名 → 固定发布标签。 */
export function sourcesTagOf(archiveName) {
  const id = /^(.+)-sources\.tar$/.exec(archiveName)?.[1]
  if (!id) throw new Error(`不是 mpv 源码包：${archiveName}`)
  return `mpv-sources-${id}`
}

/** 在 dist 目录里找到源码包相关文件；返回 { tag, files }。 */
export async function findSources(dist) {
  const names = await readdir(dist)
  const archive = names.find(name => name.endsWith('-sources.tar'))
  if (!archive)
    throw new Error(`${dist} 里没有 mpv 源码包，先运行 pnpm fetch:mpv`)
  const files = names
    .filter(name => name === archive || name.startsWith(`${archive}.`))
    .concat(names.filter(name => name === 'MPV-SOURCE-DOWNLOAD.md'))
    .map(name => join(dist, name))
  return { tag: sourcesTagOf(archive), files }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { tag, files } = await findSources(process.argv[2] ?? 'dist')
  if (process.argv.includes('--tag-only')) {
    console.log(tag)
    process.exit(0)
  }
  const exists = spawnSync('gh', ['release', 'view', tag], { stdio: 'ignore' })
  if (exists.status === 0) {
    console.log(`${tag} 已存在，跳过`)
  } else {
    execFileSync(
      'gh',
      [
        'release',
        'create',
        tag,
        ...files,
        '--latest=false',
        '--title',
        `mpv 对应源码（${tag}）`,
        '--notes',
        '影盒 Windows 版随带 mpv 的对应完整源码，随各版本发布提供下载链接。',
      ],
      { stdio: 'inherit' }
    )
  }
  console.log(tag)
}

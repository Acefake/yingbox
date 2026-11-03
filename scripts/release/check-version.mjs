/** 发布标签与 package.json 版本必须一致；输出不带 v 的版本号。 */
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

/** 标签 vX.Y.Z 对应的版本；格式不对或与 package.json 不一致时抛错。 */
export function assertVersion(tag, packageVersion) {
  const version = /^v(\d+\.\d+\.\d+)$/.exec(tag ?? '')?.[1]
  if (!version) throw new Error(`发布标签应为 vX.Y.Z：${tag}`)
  if (version !== packageVersion)
    throw new Error(
      `标签 ${tag} 与 package.json 版本 ${packageVersion} 不一致，先改版本再打标签`
    )
  return version
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'))
  console.log(assertVersion(process.argv[2], pkg.version))
}

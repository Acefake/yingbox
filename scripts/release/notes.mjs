/**
 * 发布说明：每个版本一份 docs/release-notes/X.Y.Z.md，只写这一版新增了什么功能、修复了什么问题。
 * 应用内更新弹窗按纯文本显示，所以不用 Markdown 标题、表格和代码。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 版本 X.Y.Z 的发布说明文件路径。 */
export function releaseNotesPath(root, version) {
  return join(root, 'docs/release-notes', `${version}.md`)
}

/** 读取发布说明；文件不存在或没有内容时抛错，避免发出一个没有说明的版本。 */
export async function readReleaseNotes(root, version) {
  const path = releaseNotesPath(root, version)
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch {
    throw new Error(`缺少发布说明 docs/release-notes/${version}.md`)
  }
  if (!text.trim()) throw new Error(`发布说明 ${path} 是空的`)
  return `${text.trim()}\n`
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.stdout.write(await readReleaseNotes('.', process.argv[2]))
}

/** 为目录里的安装包生成 sha256sum.txt（格式同 sha256sum：`<摘要>  <文件名>`，按文件名排序）。 */
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const CHECKSUM_FILE = 'sha256sum.txt'

/** 目录里除校验文件本身外所有文件的校验行。 */
export async function checksumLines(dir) {
  const names = (await readdir(dir, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name !== CHECKSUM_FILE)
    .map(entry => entry.name)
    .sort()
  const lines = []
  for (const name of names) {
    const digest = createHash('sha256')
      .update(await readFile(join(dir, name)))
      .digest('hex')
    lines.push(`${digest}  ${name}`)
  }
  return lines
}

/** 写出目录里的 sha256sum.txt；目录里没有文件时报错。 */
export async function writeChecksums(dir) {
  const lines = await checksumLines(dir)
  if (!lines.length) throw new Error(`${dir} 里没有安装包`)
  await writeFile(join(dir, CHECKSUM_FILE), `${lines.join('\n')}\n`)
  return lines
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = process.argv[2]
  if (!dir) throw new Error('用法：node scripts/release/checksums.mjs <目录>')
  console.log((await writeChecksums(dir)).join('\n'))
}

/** MSYS2 mpv 包的校验与安装；开发下载器和 Electron 按需安装共用。 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import distribution from '../shared/mpv-distribution.json'

export { distribution }

export type MpvFetch = (url: string) => Promise<{
  ok: boolean
  status: number
  body: ReadableStream<Uint8Array> | null
}>

/** 文件必须匹配锁定的 SHA-256；不存在时同样失败。 */
export async function verifyMpvFile(
  file: string,
  expected: string
): Promise<void> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  if (hash.digest('hex') !== expected)
    throw new Error(`mpv 文件校验失败：${file}`)
}

/** 仅将验证成功的文件从 .part 提交到缓存。 */
export async function downloadMpvFile(
  file: string,
  url: string,
  sha256: string,
  fetcher: MpvFetch
): Promise<void> {
  if (
    await verifyMpvFile(file, sha256).then(
      () => true,
      () => false
    )
  )
    return
  await mkdir(dirname(file), { recursive: true })
  const part = `${file}.part`
  try {
    const response = await fetcher(url)
    if (!response.ok || !response.body)
      throw new Error(`mpv 下载失败（HTTP ${response.status}）`)
    const reader = response.body.getReader()

    async function* chunks(): AsyncGenerator<Uint8Array> {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) return
          yield value
        }
      } finally {
        reader.releaseLock()
      }
    }

    await pipeline(Readable.from(chunks()), createWriteStream(part))
    await verifyMpvFile(part, sha256)
    await rename(part, file)
  } finally {
    await rm(part, { force: true })
  }
}

/** 只允许锁文件中的相对路径，拒绝根目录与父目录穿越。 */
export function mpvMemberPath(member: string): string {
  if (
    !member.startsWith('ucrt64/') ||
    member.includes('\\') ||
    member.split('/').some(p => p === '..' || p === '.') ||
    isAbsolute(member)
  )
    throw new Error(`mpv 包路径不合法：${member}`)
  return member.slice('ucrt64/'.length)
}

/** 安装标记及所有已安装文件必须与当前锁文件一致。 */
export async function mpvDistributionReady(dest: string): Promise<boolean> {
  try {
    const marker = JSON.parse(
      await readFile(join(dest, 'distribution.json'), 'utf8')
    )
    if (marker.id !== distribution.id) return false
    for (const pkg of distribution.packages)
      for (const file of pkg.files)
        await verifyMpvFile(join(dest, mpvMemberPath(file.path)), file.sha256)
    return true
  } catch {
    return false
  }
}

/** tar 只解压锁定的成员，不执行包内安装脚本。 */
export function runMpvTar(tar: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(tar, args, { stdio: 'ignore', windowsHide: true })
    child.once('error', reject)
    child.once('exit', code =>
      code === 0 ? resolve() : reject(new Error(`mpv 解压失败（${code}）`))
    )
  })
}

/** 全部文件校验成功后才替换安装目录，失败时保留原安装。 */
export async function prepareMpvDistribution(options: {
  dest: string
  cache: string
  tar: string
  fetcher: MpvFetch
  force?: boolean
}): Promise<string> {
  const { dest, cache, tar, fetcher, force } = options
  const target = resolve(dest)
  if (dirname(target) === target)
    throw new Error('mpv 安装目录不能是磁盘根目录')
  const exe = join(target, distribution.executable)
  if (!force && (await mpvDistributionReady(target))) return exe
  const staging = `${target}.part`
  const previous = `${target}.previous`
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  try {
    // 控制下载和解压并发，避免同时打开大量文件。
    let next = 0
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, async () => {
        while (next < distribution.packages.length) {
          const pkg = distribution.packages[next++]
          const archive = join(cache, pkg.filename)
          for (const file of pkg.files) mpvMemberPath(file.path)
          await downloadMpvFile(
            archive,
            `${distribution.binaryRepository}${pkg.filename}`,
            pkg.sha256,
            fetcher
          )
          await runMpvTar(tar, [
            '-xf',
            archive,
            '-C',
            staging,
            ...pkg.files.map(f => f.path),
          ])
          for (const file of pkg.files)
            await verifyMpvFile(join(staging, file.path), file.sha256)
        }
      })
    )
    const failure = results.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    const ready = join(staging, 'ucrt64')
    await writeFile(
      join(ready, 'distribution.json'),
      JSON.stringify({ id: distribution.id })
    )
    await rm(previous, { recursive: true, force: true })
    let moved = false
    try {
      await rename(target, previous).then(
        () => {
          moved = true
        },
        error => {
          if (error.code !== 'ENOENT') throw error
        }
      )
      await rename(ready, target)
    } catch (error) {
      if (moved) await rename(previous, target)
      throw error
    }
    await rm(previous, { recursive: true, force: true })
    return exe
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

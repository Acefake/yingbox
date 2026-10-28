/**
 * 便携版 mpv 的按需安装（仅 Windows）：用户选了 mpv 引擎、本机又找不到 mpv 时，
 * 下载 shinchiro 社区构建并解压到 <userData>/mpv，之后 mpv-locate 就能找到它。
 *
 * 版本与 scripts/fetch-mpv.mjs 保持一致（tests/mpv-install.test.ts 会核对），
 * 打包产物自带的 resources/mpv 仍优先；这里只补开发运行和缺文件的安装。
 * 解压用 Windows 自带的 tar.exe（libarchive，能解 .7z）。mpv 许可证 GPLv2+。
 */
import { app, net } from 'electron'
import { spawn } from 'child_process'
import { createReadStream, createWriteStream, existsSync } from 'fs'
import { createHash } from 'node:crypto'
import { mkdir, rename, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable } from 'stream'
import type { ReadableStream as WebReadableStream } from 'stream/web'
import { pipeline } from 'stream/promises'

/** 固定版本（与 scripts/fetch-mpv.mjs 相同），保证可复现 */
export const MPV_RELEASE = '20261015'
export const MPV_SHA256 =
  'f9becefe40e2a29d2ce5f3ab231ff094f9cf3e4038ff014cfe4a0c09ad90e79e'
export const MPV_ARCHIVE = `mpv-x86_64-${MPV_RELEASE}-git-492bae0768.7z`
export const MPV_URL = `https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/${MPV_RELEASE}/${MPV_ARCHIVE}`

/** 解压后删掉的安装辅助脚本（保留上游文档） */
const PRUNE = [
  'installer',
  'mpv-register.bat',
  'mpv-unregister.bat',
  'updater.bat',
]

/** 用户目录下的便携版 mpv 所在目录 */
export function userMpvDir(): string {
  return join(app.getPath('userData'), 'mpv')
}

/** Windows 自带的 tar.exe 路径 */
function systemTar(): string {
  return join(process.env.WINDIR || 'C:\\Windows', 'System32', 'tar.exe')
}

/** 能否在本机自动安装：只有 Windows（且有系统 tar.exe）才行，其他平台用包管理器装 */
export function canInstallMpv(): boolean {
  return process.platform === 'win32' && existsSync(systemTar())
}

/** 跑一个命令，非 0 退出码视为失败 */
function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore', windowsHide: true })
    child.once('error', reject)
    child.once('exit', code =>
      code === 0 ? resolve() : reject(new Error(`${cmd} 退出码 ${code}`))
    )
  })
}

/** 下载到文件；走 Electron net，跟随系统代理 */
async function download(url: string, file: string): Promise<void> {
  const res = await net.fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`下载失败（HTTP ${res.status}）`)
  await pipeline(
    Readable.fromWeb(res.body as unknown as WebReadableStream),
    createWriteStream(file)
  )
  if ((await stat(file)).size < 1024 * 1024) throw new Error('下载的文件不完整')
  await verifyMpvArchive(file)
}

/** 解压前核对固定发布包的 SHA-256，拒绝损坏或被替换的内容。 */
export async function verifyMpvArchive(file: string): Promise<void> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  if (hash.digest('hex') !== MPV_SHA256)
    throw new Error('mpv 下载校验失败，请重试')
}

/** 下载 → 解压到临时目录 → 整体换到 userMpvDir，返回 mpv.exe 路径 */
async function installOnce(): Promise<string> {
  if (!canInstallMpv()) throw new Error('当前系统不支持自动安装 mpv')
  const dest = userMpvDir()
  const exe = join(dest, 'mpv.exe')
  if (existsSync(exe)) return exe
  const archive = join(tmpdir(), MPV_ARCHIVE)
  const staging = `${dest}.part`
  try {
    await download(MPV_URL, archive)
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { recursive: true })
    await run(systemTar(), ['-xf', archive, '-C', staging])
    for (const item of PRUNE)
      await rm(join(staging, item), { recursive: true, force: true })
    if (!existsSync(join(staging, 'mpv.exe')))
      throw new Error('解压后没有找到 mpv.exe')
    await rm(dest, { recursive: true, force: true })
    await rename(staging, dest)
    return exe
  } finally {
    await rm(archive, { force: true }).catch(() => {})
    await rm(staging, { recursive: true, force: true }).catch(() => {})
  }
}

let pending: Promise<string> | null = null

/** 安装便携版 mpv；同时多次调用共用一次下载 */
export function installMpv(): Promise<string> {
  if (!pending)
    pending = installOnce().finally(() => {
      pending = null
    })
  return pending
}

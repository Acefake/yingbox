/** Windows mpv 按需安装，与开发构建使用同一份 MSYS2 分发锁文件。 */
import { app, net } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { prepareMpvDistribution } from './mpv-distribution'

/** 用户单独下载的便携版目录。 */
export function userMpvDir(): string {
  return join(app.getPath('userData'), 'mpv')
}

/** 只在具备系统 tar 的 Windows 上自动安装。 */
export function canInstallMpv(): boolean {
  return process.platform === 'win32' && existsSync(systemTar())
}

function systemTar(): string {
  return join(process.env.WINDIR || 'C:/Windows', 'System32/tar.exe')
}

let pending: Promise<string> | null = null

/** 并发调用共用一次安装；失败后允许重试。 */
export function installMpv(): Promise<string> {
  if (!canInstallMpv())
    return Promise.reject(new Error('当前系统不支持自动安装 mpv'))
  if (!pending) {
    pending = prepareMpvDistribution({
      dest: userMpvDir(),
      cache: join(app.getPath('userData'), 'mpv-packages'),
      tar: systemTar(),
      fetcher: url => net.fetch(url),
    }).finally(() => {
      pending = null
    })
  }
  return pending
}

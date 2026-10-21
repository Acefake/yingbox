/**
 * 找 mpv 可执行文件：环境变量 YINGBOX_MPV_PATH → 随包附带 → 系统常见位置 / PATH。
 */
import { app } from 'electron'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

/** 随包/随项目附带的 mpv 可执行文件候选路径 */
function bundledMpvPaths(): string[] {
  const exe = process.platform === 'win32' ? 'mpv.exe' : 'mpv'
  return [
    // 打包后：electron-builder extraResources 把 resources/mpv 放到 resourcesPath/mpv
    typeof process.resourcesPath === 'string'
      ? join(process.resourcesPath, 'mpv', exe)
      : '',
    // 开发运行：项目内的 resources/mpv（与 amane 运行时同一套约定）
    join(app.getAppPath(), 'resources', 'mpv', exe),
  ].filter(Boolean)
}

/** 查找系统中的 mpv 可执行文件 */
export function findMpvExecutable(): string {
  if (
    process.env.YINGBOX_MPV_PATH &&
    existsSync(process.env.YINGBOX_MPV_PATH)
  ) {
    return process.env.YINGBOX_MPV_PATH
  }
  const bundled = bundledMpvPaths().find(p => existsSync(p))
  if (bundled) return bundled

  const candidates =
    process.platform === 'win32'
      ? ['mpv.exe']
      : ['/opt/homebrew/bin/mpv', '/usr/local/bin/mpv', '/usr/bin/mpv', 'mpv']

  for (const c of candidates) {
    try {
      execFileSync(c, ['--version'], { timeout: 2000, stdio: 'pipe' })
      return c
    } catch {
      /* next */
    }
  }
  throw new Error(
    '未找到 mpv 播放器。影盒会附带便携版 mpv（resources/mpv），' +
      '若缺失可执行 pnpm fetch:mpv 重新准备，或自行安装：\n' +
      'Windows: https://mpv.io/installation/\n' +
      'macOS: brew install mpv\n' +
      'Linux: sudo apt install mpv\n\n' +
      '也可通过环境变量 YINGBOX_MPV_PATH 指定可执行文件路径。'
  )
}

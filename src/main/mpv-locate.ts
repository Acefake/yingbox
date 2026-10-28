/**
 * 找 mpv 可执行文件：环境变量 YINGBOX_MPV_PATH → 随包附带 → 用户目录里自动装的便携版
 * → 系统常见安装位置（Windows 的 scoop / choco / winget / Program Files）→ PATH。
 * Windows 上都找不到时 ensureMpvExecutable 会自动下载便携版（mpv-install）。
 */
import { app } from 'electron'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { canInstallMpv, installMpv, userMpvDir } from './mpv-install'

/** 随包/随项目附带的 mpv 可执行文件候选路径 */
function bundledMpvPaths(): string[] {
  const exe = process.platform === 'win32' ? 'mpv.exe' : 'mpv'
  return [
    // 打包后：electron-builder extraResources 把 resources/mpv 放到 resourcesPath/mpv
    typeof process.resourcesPath === 'string'
      ? join(process.resourcesPath, 'mpv', 'bin', exe)
      : '',
    // 开发运行：项目内的 resources/mpv
    join(app.getAppPath(), 'resources', 'mpv', 'bin', exe),
    // 首次使用时自动下载的便携版
    join(userMpvDir(), 'bin', exe),
    join(userMpvDir(), exe),
  ].filter(Boolean)
}

/** Windows 上常见的 mpv 安装位置（不在 PATH 里也能找到） */
function windowsInstallPaths(): string[] {
  const env = process.env
  return [
    env.USERPROFILE && join(env.USERPROFILE, 'scoop', 'shims', 'mpv.exe'),
    env.USERPROFILE &&
      join(env.USERPROFILE, 'scoop', 'apps', 'mpv', 'current', 'mpv.exe'),
    env.ProgramData && join(env.ProgramData, 'chocolatey', 'bin', 'mpv.exe'),
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs', 'mpv', 'mpv.exe'),
    env.LOCALAPPDATA &&
      join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'mpv.exe'),
    env.ProgramFiles && join(env.ProgramFiles, 'mpv', 'mpv.exe'),
    env['ProgramFiles(x86)'] &&
      join(env['ProgramFiles(x86)'], 'mpv', 'mpv.exe'),
  ].filter((p): p is string => Boolean(p))
}

/** 找 mpv；找不到返回 null */
export function locateMpv(): string | null {
  try {
    return findMpvExecutable()
  } catch {
    return null
  }
}

/**
 * 拿到可用的 mpv：找不到且能自动安装（Windows）时先下载便携版。
 * @param onInstall 开始 / 结束自动安装时回调（渲染层据此提示「正在下载 mpv」）
 */
export async function ensureMpvExecutable(
  onInstall?: (installing: boolean) => void
): Promise<string> {
  const found = locateMpv()
  if (found) return found
  if (!canInstallMpv()) return findMpvExecutable()
  onInstall?.(true)
  try {
    return await installMpv()
  } catch (error) {
    throw new Error(
      `未找到 mpv，自动下载也失败了：${error instanceof Error ? error.message : String(error)}。` +
        '可在「设置 → 播放器」重试下载，或自行安装 mpv 后重启影盒。'
    )
  } finally {
    onInstall?.(false)
  }
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
  if (process.platform === 'win32') {
    const installed = windowsInstallPaths().find(p => existsSync(p))
    if (installed) return installed
  }

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

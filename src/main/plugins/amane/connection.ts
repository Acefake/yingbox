/**
 * Amane 连接设置：读写 amane/connection.json、令牌（设置密钥）、带令牌的 fetch。
 *
 * 状态集中在 `connection` 对象里，供生命周期与 API 转发模块共享。
 */
import { app, safeStorage } from 'electron'
import { existsSync, promises as fs } from 'fs'
import { dirname, join } from 'path'
import type { AmaneSettings } from '../../../shared/amane'
import { settingsStore } from '../../settings'
import {
  type SavedSettings,
  normalizeBaseUrl,
  parseSavedSettings,
} from './rules'

/** 当前连接设置与令牌（initialize 之后才有效） */
export const connection = {
  settings: undefined as unknown as SavedSettings,
  token: '',
}

const configPath = (): string =>
  join(app.getPath('userData'), 'amane', 'connection.json')

/** 连接设置写 amane.json，令牌写设置密钥（safeStorage） */
export async function persist(): Promise<void> {
  await settingsStore().setSecret('amane.token', connection.token)
  await fs.mkdir(dirname(configPath()), { recursive: true })
  const temp = `${configPath()}.tmp`
  await fs.writeFile(temp, JSON.stringify(connection.settings, null, 2), {
    mode: 0o600,
  })
  await fs.rename(temp, configPath())
}

/**
 * 首启：探测默认后台位置 → 读入已保存的设置 → 迁移旧版密文令牌。
 * 设置文件损坏时返回错误提示（文件不存在不算错误）。
 */
export async function loadConnection(): Promise<string | null> {
  const executable =
    process.platform === 'win32' ? 'Amane.Server.exe' : 'Amane.Server'
  const candidates = [
    process.env.YINGBOX_AMANE_EXECUTABLE,
    join(process.resourcesPath, 'amane', 'onedir', executable),
    join(app.getAppPath(), 'resources', 'amane', 'onedir', executable),
    join(app.getPath('desktop'), 'Amane', 'onedir', executable),
  ]
  connection.settings = {
    mode: 'managed',
    executablePath: candidates.find(p => p && existsSync(p)) || '',
    baseUrl: 'http://127.0.0.1:18180',
    dataDirectory: join(app.getPath('userData'), 'amane', 'data'),
  }
  connection.token = settingsStore().getSecret('amane.token')
  try {
    const saved = parseSavedSettings(
      JSON.parse(await fs.readFile(configPath(), 'utf8'))
    )
    connection.settings = saved.settings
    if (!connection.token && saved.encryptedToken) {
      connection.token = safeStorage.decryptString(
        Buffer.from(saved.encryptedToken, 'base64')
      )
      await settingsStore().setSecret('amane.token', connection.token)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      return 'Amane 连接设置无法读取，请在连接设置中重新保存密钥'
  }
  return null
}

/** 带令牌访问 Amane；禁止重定向，默认 15 秒超时 */
export async function fetchApi(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(`${normalizeBaseUrl(connection.settings.baseUrl)}${path}`, {
    ...init,
    redirect: 'error',
    signal: init.signal || AbortSignal.timeout(15000),
    headers: {
      'Content-Type': 'application/json',
      ...(connection.token
        ? { Authorization: `Bearer ${connection.token}` }
        : {}),
      ...init.headers,
    },
  })
}

/** 开发模式直接运行项目内 Amane Python 源码(editable 安装,改即生效);发布版仍用打包后台。
 *  YINGBOX_AMANE_FORCE_EXE=1 可强制回到 exe;YINGBOX_AMANE_SOURCE_DIR 可指定源码目录。 */
export function resolveSourceRuntime(): {
  python: string
  args: string[]
  cwd: string
  sourceDir: string
} | null {
  if (app.isPackaged || process.env.YINGBOX_AMANE_FORCE_EXE === '1') return null
  const root =
    process.env.YINGBOX_AMANE_SOURCE_DIR?.trim() ||
    join(app.getAppPath(), 'packages', 'amane', 'upstream')
  const python =
    process.platform === 'win32'
      ? join(root, '.venv', 'Scripts', 'python.exe')
      : join(root, '.venv', 'bin', 'python')
  if (
    !existsSync(python) ||
    !existsSync(join(root, 'src', 'amane', 'server.py'))
  )
    return null
  return {
    python,
    args: ['-c', 'from amane.server import main; main()'],
    cwd: root,
    sourceDir: root,
  }
}

/** 给渲染层看的设置（不含令牌本身） */
export const publicSettings = (): AmaneSettings => ({
  mode: connection.settings.mode,
  executablePath: connection.settings.executablePath,
  baseUrl: connection.settings.baseUrl,
  dataDirectory: connection.settings.dataDirectory,
  tokenConfigured: Boolean(connection.token),
  devSource: Boolean(resolveSourceRuntime()),
})

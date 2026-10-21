/**
 * Amane 托管的纯规则：地址 / 设置校验、请求白名单、重启退避、启动环境。
 *
 * 只依赖 node:path，不碰 electron 与进程状态，方便单测。
 */
import {
  isAbsolute,
  join,
  delimiter as pathDelimiter,
  resolve,
} from 'node:path'
import type { AmaneRequest, AmaneSettings } from '../../../shared/amane'
import type { AmaneConfigureInput } from '../../../shared/contract/amane'

/** 影盒固定搭配的 Amane 版本；健康检查版本不符视为不可用 */
export const AMANE_VERSION = '0.20.1'
/** 托管进程意外退出后的自动重启上限 */
export const MAX_RESTART_ATTEMPTS = 5
/** 请求体上限（1 MB） */
export const MAX_REQUEST_BYTES = 1024 * 1024
/** 响应 / 图片上限（16 MB） */
export const MAX_RESPONSE_BYTES = 16 * 1024 * 1024

/** 写进 amane.json 的连接设置（令牌另存设置密钥） */
export type SavedSettings = Omit<AmaneSettings, 'tokenConfigured' | 'devSource'>
/** 旧版 amane.json 里还带着 safeStorage 密文令牌；首启迁到设置密钥后不再写回 */
export type LegacySavedSettings = SavedSettings & { encryptedToken?: string }

/** 校验服务地址只能是本机 HTTP 根地址，返回规范化的 origin */
export function normalizeBaseUrl(raw: string): string {
  const url = new URL(raw)
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(
      'Amane 服务地址须为本机 HTTP 地址，例如 http://127.0.0.1:18180'
    )
  }
  return url.origin
}

/** 读入的 amane.json 解析结果：规范化后的设置 + 可能存在的旧密文令牌 */
export interface ParsedSaved {
  settings: SavedSettings
  encryptedToken?: string
}

/** 校验磁盘上的连接设置；格式不对直接抛错（调用方据此报「无法读取」） */
export function parseSavedSettings(raw: unknown): ParsedSaved {
  const saved = raw as LegacySavedSettings | null
  if (
    !saved ||
    !['managed', 'external'].includes(saved.mode) ||
    typeof saved.executablePath !== 'string' ||
    typeof saved.baseUrl !== 'string' ||
    typeof saved.dataDirectory !== 'string' ||
    !isAbsolute(saved.dataDirectory) ||
    (saved.encryptedToken !== undefined &&
      typeof saved.encryptedToken !== 'string')
  ) {
    throw new Error('无效的 Amane 连接设置')
  }
  return {
    settings: {
      mode: saved.mode,
      executablePath: saved.executablePath,
      baseUrl: normalizeBaseUrl(saved.baseUrl),
      dataDirectory: saved.dataDirectory,
    },
    ...(saved.encryptedToken ? { encryptedToken: saved.encryptedToken } : {}),
  }
}

/**
 * 应用一次连接设置修改：返回新设置与新令牌（未改令牌时为 undefined）。
 * 只做校验与合并，不落盘。
 */
export function applyConfigure(
  current: SavedSettings,
  changes: AmaneConfigureInput
): { next: SavedSettings; token?: string } {
  if (!['managed', 'external'].includes(changes.mode || current.mode))
    throw new Error('无效的服务模式')
  const next = { ...current }
  if (changes.mode) next.mode = changes.mode
  if (changes.baseUrl !== undefined)
    next.baseUrl = normalizeBaseUrl(changes.baseUrl)
  if (changes.executablePath !== undefined)
    next.executablePath = String(changes.executablePath).trim()
  if (changes.dataDirectory !== undefined) {
    if (!isAbsolute(changes.dataDirectory))
      throw new Error('数据目录须为绝对路径')
    next.dataDirectory = resolve(changes.dataDirectory)
  }
  if (
    changes.token !== undefined &&
    (typeof changes.token !== 'string' ||
      changes.token.length > 4096 ||
      /[\r\n]/.test(changes.token))
  )
    throw new Error('无效的 API Token')
  return {
    next,
    ...(changes.token !== undefined ? { token: changes.token.trim() } : {}),
  }
}

/** 渲染层可调用的 Amane API 白名单（按方法） */
export const AMANE_ROUTES: Record<string, RegExp> = {
  GET: /^\/api\/(?:agent\/sessions(?:\/\d+(?:\/trace)?)?|saved-queries(?:\/\d+(?:\/result)?)?|health|libraries(?:\/\d+)?|metadata(?:\/\d+)?|media(?:\/\d+)?|actors(?:\/\d+)?|facets\/[a-z_]+|tasks(?:\/(?:\d+|\d+\/children|worker))?|config(?:\/schema)?|network\/sources)$/,
  POST: /^\/api\/(?:agent\/sessions(?:\/\d+\/(?:title|agui(?:\/cancel)?))?|saved-queries(?:\/batch)?|libraries|tasks|tasks\/batch|tasks\/worker\/(?:pause|resume)|metadata\/batch\/(?:scrape|user-tags)|facets\/user_tag|actors\/\d+\/scrape|network\/check)$/,
  DELETE: /^\/api\/agent\/sessions\/\d+$/,
  PATCH:
    /^\/api\/(?:agent\/sessions\/\d+|saved-queries\/\d+|config|libraries\/\d+|metadata\/\d+|media\/\d+)$/,
}

/** 校验一次转发请求，返回可直接拼到服务地址后的 `路径?查询` */
export function permittedPath(request: AmaneRequest, baseUrl: string): string {
  if (
    !request ||
    typeof request.path !== 'string' ||
    request.path.length > 4096 ||
    !request.path.startsWith('/api/') ||
    /[\\#\r\n]/.test(request.path)
  )
    throw new Error('无效的 Amane 请求')
  const url = new URL(request.path, baseUrl)
  if (url.origin !== new URL(baseUrl).origin)
    throw new Error('无效的 Amane 请求来源')
  const method = request.method || 'GET'
  if (!AMANE_ROUTES[method]?.test(url.pathname))
    throw new Error('不支持的 Amane 操作')
  return `${url.pathname}${url.search}`
}

/** 网络检测较慢，单独放宽超时 */
export const requestTimeoutFor = (path: string): number =>
  path === '/api/network/check' ? 120000 : 30000

/** 智能体回合的订阅接口：回合独立运行，主进程只确认已受理 */
export const isAguiPath = (path: string): boolean =>
  /^\/api\/agent\/sessions\/\d+\/agui$/.test(path)

/** amane:// 协议只放行资源图片路径 */
export const isImageResourcePath = (path: string): boolean =>
  /^\/api\/resources\/(?:[a-f0-9]{16}|proxy)(?:\?|$)/.test(path)

/** 把 FastAPI 的 detail（字符串或校验错误数组）转成一句中文提示 */
export function errorDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail))
    return detail
      .map(item => (typeof item?.msg === 'string' ? item.msg : ''))
      .filter(Boolean)
      .join('；')
  return ''
}

/** 校验托管模式下选择的后台程序；返回错误提示，合格时返回 null */
export function executableProblem(
  path: string,
  exists: (path: string) => boolean
): string | null {
  if (!path || !isAbsolute(path) || !exists(path))
    return '未找到 Amane 后台，请选择 Amane.Server.exe（位于完整安装目录的 onedir 中）'
  if (!/^Amane\.Server(?:\.exe)?$/i.test(path.split(/[\\/]/).pop() || ''))
    return '请选择 Amane.Server 后台程序，而不是托盘程序 Amane.exe'
  return null
}

/** 第 attempts 次失败后的重启计划；超过上限返回 null */
export function restartPlan(
  attempts: number
): { attempt: number; delay: number; message: string } | null {
  if (attempts >= MAX_RESTART_ATTEMPTS) return null
  const attempt = attempts + 1
  const delay = Math.min(60000, 4000 * attempt)
  return {
    attempt,
    delay,
    message: `Amane 后台意外退出，${Math.round(delay / 1000)} 秒后自动重启（第 ${attempt}/${MAX_RESTART_ATTEMPTS} 次）`,
  }
}

/** 重启次数用尽时的提示 */
export const RESTART_EXHAUSTED = `Amane 后台已退出（自动重启 ${MAX_RESTART_ATTEMPTS} 次未成功），请检查数据目录中的 logs`

/** 托管进程的环境变量（打包后台与源码运行共用） */
export function serviceEnv(
  settings: SavedSettings,
  token: string,
  base: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const url = new URL(settings.baseUrl)
  return {
    ...base,
    AMANE_HOST: url.hostname.replace(/^\[|\]$/g, ''),
    AMANE_PORT: url.port || '80',
    AMANE_DATA_DIR: settings.dataDirectory,
    AMANE_LOG_DIR: join(settings.dataDirectory, 'logs'),
    AMANE_TOKEN: token,
    AMANE_SUPERVISED: '1',
    AMANE_UI_DISABLED: '1',
    AMANE_SAFE_DIRS: 'ALLOW_ALL',
    PYDANTIC_DISABLE_PLUGINS: '1',
  }
}

/** 开发模式运行 Python 源码时额外的环境变量 */
export function sourceEnv(
  env: NodeJS.ProcessEnv,
  sourceDir: string,
  pythonPath: string | undefined
): NodeJS.ProcessEnv {
  return {
    ...env,
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONPATH: [join(sourceDir, 'src'), pythonPath]
      .filter(Boolean)
      .join(pathDelimiter),
  }
}

/** 媒体记录里的相对路径相对所属媒体库解析 */
export const mediaPathFor = (mediaPath: string, libraryPath: string): string =>
  isAbsolute(mediaPath) ? mediaPath : resolve(libraryPath, mediaPath)

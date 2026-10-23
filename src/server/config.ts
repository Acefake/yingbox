/**
 * 独立服务的配置：命令行参数 > 环境变量 > 默认值。
 *
 * | 参数            | 环境变量             | 默认                                   |
 * | --------------- | -------------------- | -------------------------------------- |
 * | --host          | YINGBOX_HOST         | 127.0.0.1（只本机可访问）              |
 * | --port          | YINGBOX_PORT         | 31480                                  |
 * | --data-dir      | YINGBOX_DATA_DIR     | ~/.yingbox-server                      |
 * | --cache-dir     | YINGBOX_CACHE_DIR    | 同数据目录（图片缓存放在其下 media/）  |
 * | --media-root …  | YINGBOX_MEDIA_ROOTS  | 用户主目录（多个用系统路径分隔符 : / ;） |
 * | --web-dir       | YINGBOX_WEB_DIR      | 包旁边的 dist-web（存在时）；off 关闭   |
 * | --fetch         | YINGBOX_FETCH        | node（见 library/platform/fetch）       |
 * | --watch         | YINGBOX_WATCH        | auto（auto / events / poll / off）      |
 * | --scan-interval | YINGBOX_SCAN_INTERVAL| 300 秒（定时增量扫描；0 关闭）          |
 * | --settle        | YINGBOX_SETTLE_SECONDS | 10 秒（文件写入稳定判定；0 不判定）   |
 *
 * 访问令牌用 YINGBOX_SERVER_TOKEN 固定，否则首次启动生成并存进数据目录（见 secrets.ts）。
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import {
  DEFAULT_MONITOR,
  WATCH_MODES,
  type WatchMode,
} from '../main/library/engine/library-monitor'
import { type FetchSpec, parseFetchSpec } from '../main/library/platform/fetch'
import { libraryPaths } from '../main/library/platform/paths'

/** 服务配置。 */
export interface ServerConfig {
  host: string
  /** 对外访问的固定源（HTTPS 反向代理部署时显式指定）。 */
  publicOrigin?: string
  port: number
  /** 数据目录：library.db、secrets.json。 */
  dataDir: string
  /** 缓存目录：media/（海报原图与缩略图）、演员头像索引；默认同数据目录。 */
  cacheDir: string
  /** 允许浏览、添加为媒体库的根目录（已解析为绝对路径）。 */
  mediaRoots: string[]
  /** 网页端静态文件目录；null 表示不托管网页（只提供 API）。 */
  webDir: string | null
  fetch: FetchSpec
  /** 目录监控：模式、定时增量扫描间隔、写入稳定判定时间（毫秒）。 */
  monitor: MonitorConfig
}

/** 目录监控配置。 */
export interface MonitorConfig {
  watchMode: WatchMode
  scanIntervalMs: number
  settleMs: number
}

/** 默认值的来源（测试注入）。 */
export interface ConfigDefaults {
  cwd: string
  home: string
  /** 服务包所在目录（out/server），用来找旁边的 dist-web。 */
  bundleDir: string
}

/** 默认端口。 */
export const DEFAULT_PORT = 31480

/** 读一个命令行参数的全部取值（`--name value` 与 `--name=value` 两种写法）。 */
function flagValues(argv: string[], name: string): string[] {
  const values: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === `--${name}` && i + 1 < argv.length) values.push(argv[++i])
    else if (arg.startsWith(`--${name}=`))
      values.push(arg.slice(name.length + 3))
  }
  return values
}

const nonEmpty = (value: string | undefined): string | undefined =>
  value?.trim() ? value.trim() : undefined

/** 非负秒数 → 毫秒；缺省用 fallbackMs，不合法时抛错。 */
function secondsOption(
  value: string | undefined,
  name: string,
  fallbackMs: number
): number {
  if (value === undefined) return fallbackMs
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new Error(`${name} 应为非负秒数：${value}`)
  return Math.round(seconds * 1000)
}

/** 解析目录监控配置。 */
function loadMonitor(
  flag: (name: string) => string | undefined,
  env: NodeJS.ProcessEnv
): MonitorConfig {
  const mode = flag('watch') ?? nonEmpty(env.YINGBOX_WATCH) ?? 'auto'
  if (!WATCH_MODES.includes(mode as WatchMode))
    throw new Error(`监控模式应为 ${WATCH_MODES.join(' / ')}：${mode}`)
  return {
    watchMode: mode as WatchMode,
    scanIntervalMs: secondsOption(
      flag('scan-interval') ?? nonEmpty(env.YINGBOX_SCAN_INTERVAL),
      '定时扫描间隔',
      DEFAULT_MONITOR.scanIntervalMs
    ),
    settleMs: secondsOption(
      flag('settle') ?? nonEmpty(env.YINGBOX_SETTLE_SECONDS),
      '写入稳定时间',
      DEFAULT_MONITOR.settleMs
    ),
  }
}

/** 公网访问地址只允许 HTTP(S) 的源，不接受路径、凭据或查询参数。 */
export function parsePublicOrigin(
  value: string | undefined
): string | undefined {
  if (!value) return undefined
  const url = new URL(value)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      '公网访问地址应为 HTTP(S) 源，例如 https://media.example.com'
    )
  }
  return url.origin
}

/** 解析配置；不合法的端口、监控参数直接抛错。 */
export function loadConfig(
  argv: string[],
  env: NodeJS.ProcessEnv,
  defaults: ConfigDefaults = {
    cwd: process.cwd(),
    home: homedir(),
    bundleDir: __dirname,
  }
): ServerConfig {
  const flag = (name: string): string | undefined =>
    nonEmpty(flagValues(argv, name).at(-1))
  const abs = (path: string): string => resolve(defaults.cwd, path)

  const port = Number(
    flag('port') ?? nonEmpty(env.YINGBOX_PORT) ?? DEFAULT_PORT
  )
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error(`端口不合法：${port}`)

  const rootFlags = flagValues(argv, 'media-root').filter(Boolean)
  const rootList = rootFlags.length
    ? rootFlags
    : (nonEmpty(env.YINGBOX_MEDIA_ROOTS)?.split(delimiter).filter(Boolean) ?? [
        defaults.home,
      ])

  const webSetting = flag('web-dir') ?? nonEmpty(env.YINGBOX_WEB_DIR)
  const bundledWeb = resolve(defaults.bundleDir, '../../dist-web')
  const webDir =
    webSetting === 'off'
      ? null
      : webSetting
        ? abs(webSetting)
        : existsSync(join(bundledWeb, 'index.html'))
          ? bundledWeb
          : null

  const dataDir = abs(
    flag('data-dir') ??
      nonEmpty(env.YINGBOX_DATA_DIR) ??
      join(defaults.home, '.yingbox-server')
  )
  const cacheSetting = flag('cache-dir') ?? nonEmpty(env.YINGBOX_CACHE_DIR)

  return {
    host: flag('host') ?? nonEmpty(env.YINGBOX_HOST) ?? '127.0.0.1',
    publicOrigin: parsePublicOrigin(
      flag('public-origin') ?? nonEmpty(env.YINGBOX_PUBLIC_ORIGIN)
    ),
    port,
    dataDir,
    cacheDir: cacheSetting ? abs(cacheSetting) : dataDir,
    mediaRoots: [...new Set(rootList.map(abs))],
    webDir,
    fetch: parseFetchSpec(flag('fetch') ?? env.YINGBOX_FETCH),
    monitor: loadMonitor(flag, env),
  }
}

/** 服务落盘的位置：数据库与密钥在数据目录，图片缓存在缓存目录（Docker 里分别是 /config、/cache 两个卷）。 */
export function serverPaths(config: ServerConfig): {
  dbPath: string
  secretsPath: string
  mediaDir: string
} {
  return {
    dbPath: libraryPaths(config.dataDir).dbPath,
    secretsPath: join(config.dataDir, 'secrets.json'),
    mediaDir: libraryPaths(config.cacheDir).mediaDir,
  }
}

/**
 * 启动日志里的目录监控说明。
 * 监控模式只管本地盘：存储为网盘的库（库设置里选「网盘」，或「自动」判为 NFS / SMB / FUSE 等挂载盘，
 * 见 main/library/engine/storage-mode.ts）不论哪种模式都不监听、不定时扫描。
 */
export function describeMonitor(m: MonitorConfig): string {
  const mode = {
    auto: '自动（本地盘用文件系统事件，网络盘 / 挂载盘按网盘处理）',
    events: '文件系统事件',
    poll: '只用定时扫描',
    off: '关闭（只能手动扫描）',
  }[m.watchMode]
  if (m.watchMode === 'off') return mode
  const poll = m.scanIntervalMs
    ? `每 ${m.scanIntervalMs / 1000} 秒增量扫描`
    : '不定时扫描'
  const settle = m.settleMs
    ? `文件 ${m.settleMs / 1000} 秒不变再入库`
    : '不等文件写完'
  return `${mode}，${poll}，${settle}；网盘不监听、不定时扫描，只按变更通知与手动扫描`
}

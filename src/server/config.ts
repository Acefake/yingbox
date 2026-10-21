/**
 * 独立服务的配置：命令行参数 > 环境变量 > 默认值。
 *
 * | 参数            | 环境变量             | 默认                                   |
 * | --------------- | -------------------- | -------------------------------------- |
 * | --host          | YINGBOX_HOST         | 127.0.0.1（只本机可访问）              |
 * | --port          | YINGBOX_PORT         | 31480                                  |
 * | --data-dir      | YINGBOX_DATA_DIR     | ~/.yingbox-server                      |
 * | --media-root …  | YINGBOX_MEDIA_ROOTS  | 用户主目录（多个用系统路径分隔符 : / ;） |
 * | --web-dir       | YINGBOX_WEB_DIR      | 包旁边的 dist-web（存在时）；off 关闭   |
 * | --fetch         | YINGBOX_FETCH        | node（见 library/platform/fetch）       |
 *
 * 访问令牌用 YINGBOX_SERVER_TOKEN 固定，否则首次启动生成并存进数据目录（见 secrets.ts）。
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { type FetchSpec, parseFetchSpec } from '../main/library/platform/fetch'

/** 服务配置。 */
export interface ServerConfig {
  host: string
  port: number
  /** 数据目录：library.db、media/（原图与缩略图）、secrets.json。 */
  dataDir: string
  /** 允许浏览、添加为媒体库的根目录（已解析为绝对路径）。 */
  mediaRoots: string[]
  /** 网页端静态文件目录；null 表示不托管网页（只提供 API）。 */
  webDir: string | null
  fetch: FetchSpec
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

/** 解析配置；不合法的端口直接抛错。 */
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

  return {
    host: flag('host') ?? nonEmpty(env.YINGBOX_HOST) ?? '127.0.0.1',
    port,
    dataDir: abs(
      flag('data-dir') ??
        nonEmpty(env.YINGBOX_DATA_DIR) ??
        join(defaults.home, '.yingbox-server')
    ),
    mediaRoots: [...new Set(rootList.map(abs))],
    webDir,
    fetch: parseFetchSpec(flag('fetch') ?? env.YINGBOX_FETCH),
  }
}

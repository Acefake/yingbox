/**
 * 在线播放（引擎 + 播放代理）的服务端配置，只读环境变量，与片库配置（../config.ts）分开。
 *
 * | 环境变量                    | 默认                       | 说明                                                    |
 * | --------------------------- | -------------------------- | ------------------------------------------------------- |
 * | YINGBOX_ONLINE              | on                         | off 关闭在线板块（不起引擎、不开播放代理）              |
 * | YINGBOX_DOWNLOAD_DIR        | <数据目录>/downloads       | 下载目录（Docker 里映射成卷）                           |
 * | YINGBOX_BROWSER             | 空（不可用）               | chromium:<可执行文件>：用系统 Chromium 代抓 CF 页面     |
 * | YINGBOX_STREAM_ALLOW_PRIVATE| 空                         | 播放代理放行的内网目标：主机名、IP 或 IPv4 CIDR，逗号分隔 |
 * | YINGBOX_ENGINE_IDLE         | 300 秒                     | 引擎空闲多久退出（0 不退出）                            |
 */
import { isAbsolute, join, resolve } from 'node:path'
import { type BrowserSpec, parseBrowserSpec } from './browser-fetch'

/** 在线配置。 */
export interface OnlineConfig {
  enabled: boolean
  /** 引擎数据目录：插件缓存、熔断记录、下载队列、Chromium 配置 */
  engineDir: string
  downloadDir: string
  browser: BrowserSpec | null
  /** 播放代理额外放行的内网目标 */
  streamAllowPrivate: string[]
  idleMs: number
}

const nonEmpty = (value: string | undefined): string | undefined =>
  value?.trim() ? value.trim() : undefined

/** 解析配置；不合法时抛错（启动即失败，比运行中静默退回好排查）。 */
export function loadOnlineConfig(
  env: NodeJS.ProcessEnv,
  dataDir: string,
  cwd = process.cwd()
): OnlineConfig {
  const switchValue = (nonEmpty(env.YINGBOX_ONLINE) ?? 'on').toLowerCase()
  if (!['on', 'off', '1', '0', 'true', 'false'].includes(switchValue))
    throw new Error(`YINGBOX_ONLINE 应为 on / off：${switchValue}`)
  const download = nonEmpty(env.YINGBOX_DOWNLOAD_DIR)
  const idle = Number(nonEmpty(env.YINGBOX_ENGINE_IDLE) ?? 300)
  if (!Number.isFinite(idle) || idle < 0)
    throw new Error(`YINGBOX_ENGINE_IDLE 应为非负秒数：${idle}`)
  return {
    enabled: ['on', '1', 'true'].includes(switchValue),
    engineDir: join(dataDir, 'engine'),
    downloadDir: download
      ? isAbsolute(download)
        ? download
        : resolve(cwd, download)
      : join(dataDir, 'downloads'),
    browser: parseBrowserSpec(env.YINGBOX_BROWSER),
    streamAllowPrivate: (nonEmpty(env.YINGBOX_STREAM_ALLOW_PRIVATE) ?? '')
      .split(',')
      .map(item => item.trim().toLowerCase())
      .filter(Boolean),
    idleMs: Math.round(idle * 1000),
  }
}

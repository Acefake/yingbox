/**
 * 宿主能力：片库 / 刮削核心与宿主之间唯一的接缝。
 *
 * 核心（扫描、识别、刮削、写出）只依赖 Node 标准库；宿主差异全在这里注入：
 * - 桌面端（Electron utilityProcess，engine/entry.ts）：Electron net.fetch（Chromium 网络栈、系统代理），
 *   原图落盘后通知主进程用 nativeImage 预热缩略图；
 * - 独立服务（src/server）：Node fetch（undici）或可插拔实现（curl / curl-impersonate、自定义模块），
 *   缩略图由服务进程里的 wasm 管线生成。
 * 两种宿主都经 createLibraryService 构造同一个 LibraryService，行为一致。
 */
import type {
  HttpFetch,
  IdentifyModuleOptions,
} from '../identify/identify-module'
import { DEFAULT_MONITOR } from '../engine/library-monitor'
import { LibraryService, type LibraryServiceOptions } from '../engine/service'

export { DEFAULT_MONITOR } from '../engine/library-monitor'

export { libraryPaths } from './paths'

/** 宿主注入的能力。 */
export interface LibraryPlatform {
  /** 数据库文件路径（library.db）。 */
  dbPath: string
  /** 图片缓存根目录（orig/ 原图与 thumb/ 缩略图）。 */
  mediaDir: string
  /** 出网实现：番号站点、TMDB、图片下载都走它。 */
  fetch: HttpFetch
  /** 写日志（告警、监听失败）。 */
  log: (message: string) => void
  /** 一批原图落盘后回调（宿主据此预热缩略图）。 */
  onImagesCached?: (keys: string[]) => void
  /** 加工派生图（番号封面裁海报）；宿主用编解码线程实现，见 images/derived.ts 的 codecDeriver。 */
  deriveImage?: IdentifyModuleOptions['deriveImage']
  /** 环境变量兜底的令牌（设置里没有时使用）。 */
  env?: LibraryEnvSecrets
}

/** 环境变量里的令牌。 */
export interface LibraryEnvSecrets {
  tmdbToken?: string
  opensubtitlesKey?: string
  /** ThePornDB 令牌。 */
  theporndbToken?: string
  /** JavDB 登录 Cookie。 */
  javdbCookie?: string
  /** DMM 官方 API 凭据，"API_ID:AFFILIATE_ID"。 */
  dmmApi?: string
}

/** 从环境变量读令牌（桌面端与独立服务同一套变量名）。 */
export function envSecrets(env: NodeJS.ProcessEnv): LibraryEnvSecrets {
  return {
    tmdbToken:
      env.YINGBOX_TMDB_TOKEN || env.VITE_TMDB_ACCESS_TOKEN || undefined,
    opensubtitlesKey: env.YINGBOX_OPENSUBTITLES_KEY || undefined,
    theporndbToken: env.YINGBOX_THEPORNDB_TOKEN || undefined,
    javdbCookie: env.YINGBOX_JAVDB_COOKIE || undefined,
    dmmApi:
      env.DMM_API_ID && env.DMM_AFFILIATE_ID
        ? `${env.DMM_API_ID}:${env.DMM_AFFILIATE_ID}`
        : undefined,
  }
}

/** 用宿主能力构造片库服务；extra 只放测试 / 宿主特有的调优项（监控、并发等），缺省用 DEFAULT_MONITOR。 */
export function createLibraryService(
  platform: LibraryPlatform,
  extra: Omit<LibraryServiceOptions, 'dbPath' | 'log' | 'identify'> = {}
): LibraryService {
  return new LibraryService({
    ...DEFAULT_MONITOR,
    ...extra,
    dbPath: platform.dbPath,
    log: platform.log,
    identify: {
      fetch: platform.fetch,
      mediaDir: platform.mediaDir,
      onImagesCached: platform.onImagesCached,
      deriveImage: platform.deriveImage,
      env: platform.env,
    },
  })
}

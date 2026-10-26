/**
 * 独立服务的组装：片库核心（Node 宿主）+ 缩略图管线（wasm）+ 路由 + 鉴权。
 *
 * 返回一个 `fetch(Request) => Response`，入口（index.ts）把它挂到 node:http 上；单测直接调它，不占端口。
 * 与桌面端的对应关系：
 * | 桌面端（Electron）                          | 独立服务（Node）                               |
 * | ------------------------------------------- | ---------------------------------------------- |
 * | utilityProcess + MessagePort IPC            | 同进程 LibraryService + HTTP RPC / SSE         |
 * | net.fetch（Chromium）                       | Node fetch / curl(-impersonate) / 自定义模块   |
 * | nativeImage 缩放                            | wasm 解码 + 缩放（编解码线程）                 |
 * | safeStorage 存 TMDB 令牌                    | secrets.json（0600）+ 环境变量                 |
 * | 系统文件夹对话框                            | /api/fs/dirs 在媒体根目录内浏览                |
 * | 内置播放器 / mpv                            | 网页 <video> + /media/files Range 流           |
 * | 在线引擎 utilityProcess + yingbox-stream:// | child_process 引擎 + /api/engine + /api/stream |
 * | subtitle:find / read（外挂字幕转 WebVTT）   | /media/subtitles/<fileId>[/<文件名>]           |
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { LibraryService } from '../main/library/engine/service'
import type { HttpFetch } from '../main/library/identify/identify-module'
import { codecDeriver } from '../main/library/images/derived'
import { codecClipPixels } from '../main/library/visual/clip-pixels'
import { createFetch, describeFetch } from '../main/library/platform/fetch'
import {
  createLibraryService,
  envSecrets,
} from '../main/library/platform/platform'
import { syncTmdbTokenToLibrary } from '../main/library/platform/token-sync'
import {
  type Codec,
  inProcessCodec,
  startCodec,
} from '../main/thumbnails/codec-client'
import { createThumbnailPipeline } from '../main/thumbnails/pipeline'
import { createWasmResizer } from '../main/thumbnails/wasm-resizer'
import { type ServerConfig, serverPaths } from './config'
import type { Handler } from './http/adapter'
import { createAuth, sameOrigin } from './http/auth'
import { HttpError, Router, fail } from './http/router'
import { createStaticHandler } from './http/static'
import { serverLibraryHost } from './library-host'
import { registerFsRoutes } from './routes/fs'
import { registerLibraryRoutes } from './routes/library'
import { registerMediaRoutes } from './routes/media'
import { type OnlineDeps, registerOnline } from './online'
import { registerSessionRoutes } from './routes/session'
import { registerSubtitleRoutes } from './routes/subtitles'
import { FileSecretStore, SECRET_KEYS, ensureServerToken } from './secrets'

/** 组装好的服务。 */
export interface ServerApp {
  fetch: Handler
  service: LibraryService
  /** 访问令牌（入口打印登录地址用）。 */
  token: string
  /** 令牌是否是这次启动新生成的。 */
  tokenGenerated: boolean
  close(): Promise<void>
}

/** 可注入项（测试 / 宿主调优）。 */
export interface ServerAppOptions {
  log?: (message: string) => void
  /** 出网实现；缺省按 config.fetch 创建。 */
  fetch?: HttpFetch
  /** 编解码实现；缺省起 webp-worker 线程，线程文件不存在时在当前线程执行。 */
  codec?: Codec
  /** 在线引擎（测试注入；缺省 fork 子进程，见 online/engine.ts）。 */
  engine?: OnlineDeps['engine']
  /** 是否监控媒体库目录（false 时不监听也不定时扫描），默认按 config.monitor。 */
  watch?: boolean
  env?: NodeJS.ProcessEnv
}

/** 编解码线程：构建产物里 webp-worker.js 与本文件同目录；找不到（如直接跑源码）时退回当前线程。 */
function defaultCodec(log: (message: string) => void): Codec {
  const workerPath = join(__dirname, 'webp-worker.js')
  return (
    (existsSync(workerPath) && startCodec(workerPath, log)) || inProcessCodec()
  )
}

/** 创建服务（打开数据库、恢复任务、开始监听媒体库）。 */
export async function createServerApp(
  config: ServerConfig,
  options: ServerAppOptions = {}
): Promise<ServerApp> {
  const log = options.log ?? (message => console.warn(`[server] ${message}`))
  const env = options.env ?? process.env
  mkdirSync(config.dataDir, { recursive: true })
  const { dbPath, secretsPath, mediaDir } = serverPaths(config)
  const secrets = new FileSecretStore(secretsPath, env)
  const { token, generated } = ensureServerToken(secrets)
  const auth = createAuth(token, config.publicOrigin)

  const codec = options.codec ?? defaultCodec(log)
  const thumbnails = createThumbnailPipeline({
    mediaDir,
    codec,
    resizer: createWasmResizer(codec),
    log,
  })
  const service = createLibraryService(
    {
      dbPath,
      mediaDir,
      fetch: options.fetch ?? (await createFetch(config.fetch)),
      log: message => log(`[library] ${message}`),
      deriveImage: codecDeriver(codec),
      clipPixels: codecClipPixels(codec),
      // ffprobe 动态范围探测、按画面搜抽帧、自动中文字幕（见 library-host.ts）
      ...serverLibraryHost(env),
      onImagesCached: keys => thumbnails.warm(keys),
      env: envSecrets(env),
    },
    { ...config.monitor, watch: options.watch }
  )
  await service.start()
  // 网页端保存过的 TMDB 令牌：片库还没配置时补一次（与桌面端启动时的规则相同）
  await syncTmdbTokenToLibrary(
    {
      getProviderStatus: async () => service.getProviderStatus(),
      setProviderToken: async value =>
        service.setProviderToken({ provider: 'tmdb', token: value }),
    },
    secrets.get(SECRET_KEYS.tmdbToken) ?? ''
  )

  const router = new Router()
  registerSessionRoutes(router, auth, () => ({
    mediaRoots: config.mediaRoots,
    fetch: describeFetch(config.fetch),
  }))
  registerLibraryRoutes(router, {
    service,
    secrets,
    mediaRoots: config.mediaRoots,
  })
  registerMediaRoutes(router, { service, thumbnails })
  registerSubtitleRoutes(router, service)
  registerFsRoutes(router, config.mediaRoots)
  // 在线板块（引擎 + 播放代理），见 online/index.ts
  const online = registerOnline(router, {
    dataDir: config.dataDir,
    env,
    tmdbToken: () =>
      secrets.get(SECRET_KEYS.tmdbToken)?.trim() ||
      env.YINGBOX_TMDB_TOKEN ||
      env.VITE_TMDB_ACCESS_TOKEN ||
      '',
    log,
    engine: options.engine,
  })
  const serveStatic = config.webDir ? createStaticHandler(config.webDir) : null

  const handle: Handler = async request => {
    const url = new URL(request.url)
    const route = router.match(request.method, url.pathname)
    const isApi = /^\/(api|media)\//.test(url.pathname)
    if (!route || (!isApi && route === 'method-not-allowed')) {
      if (isApi || !serveStatic) return fail(404, '没有这个接口')
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return fail(405, '不支持的方法')
      // 带 ?token= 打开首页（启动日志里的地址）：写入 Cookie 后去掉地址里的令牌
      const candidate = url.searchParams.get('token')
      if (candidate !== null && auth.matches(candidate))
        return new Response(null, {
          status: 302,
          headers: { Location: '/', 'Set-Cookie': auth.loginCookie(request) },
        })
      return serveStatic(request, url)
    }
    if (route === 'method-not-allowed') return fail(405, '不支持的方法')
    if (!sameOrigin(request, config.publicOrigin))
      return fail(403, '跨站请求被拒绝')
    if (!route.public && !auth.check(request)) return fail(401, '需要登录')
    try {
      return await route.handler(request, { url, params: route.params })
    } catch (error) {
      if (error instanceof HttpError) return fail(error.status, error.message)
      throw error
    }
  }

  return {
    fetch: handle,
    service,
    token,
    tokenGenerated: generated,
    close: async () => {
      await online.close()
      await service.close()
    },
  }
}

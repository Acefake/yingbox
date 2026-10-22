/**
 * 缩略图模块入口（桌面端 Electron 胶水）：注册 yingbox-media:// 协议，全应用唯一一套缩略图。
 *
 * - 一个协议：媒体库原图（image/<key>）与任意来源（thumb/?src=）都走 yingbox-media://；
 * - 一个缓存目录：<userData>/library/media/thumb，一个 LRU 上限（cache.ts）；
 * - 生成在主进程：nativeImage 缩放（native-resizer.ts）+ worker_threads 里的 wasm 编码 WebP。
 *   不在渲染层 Worker 生成：file:// 页面里起 Worker 有打包风险，且本地图片本来就要主进程读。
 * 管线本身与宿主无关（pipeline.ts），独立服务用同一条管线、换成 wasm 缩放器。
 * 海报取景的焦点经 IPC media 域给渲染层（focus/service.ts）。
 */
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import { app, protocol } from 'electron'
import { media } from '../../shared/contract/media'
import { MEDIA_SCHEME } from '../../shared/media-url'
import { implement } from '../rpc'
import { startCodec } from './codec-client'
import { createNativeResizer } from './native-resizer'
import { createThumbnailPipeline } from './pipeline'

/** registerSchemesAsPrivileged 用的协议声明（必须在 app ready 之前注册）。 */
export const MEDIA_SCHEME_PRIVILEGES: Electron.CustomScheme = {
  scheme: MEDIA_SCHEME,
  privileges: { secure: true, standard: true, supportFetchAPI: true },
}

/** 媒体库图片目录（引擎的 orig/ 与全部缩略图 thumb/）。 */
export const mediaDir = (): string =>
  join(app.getPath('userData'), 'library', 'media')

/** 缩略图服务（给媒体库主进程宿主用）。 */
export interface ThumbnailService {
  /** 引擎下载好一批原图后调用，后台生成全部宽度的缩略图。 */
  warm(keys: string[]): void
}

/** 注册 yingbox-media:// 协议（app ready 之后调用）。 */
export function registerThumbnails(
  log: (message: string) => void = message => console.warn(`[thumb] ${message}`)
): ThumbnailService {
  const codec = startCodec(join(__dirname, 'webp-worker.js'), log)
  const pipeline = createThumbnailPipeline({
    mediaDir: mediaDir(),
    codec,
    resizer: createNativeResizer(codec),
    log,
  })
  protocol.handle(MEDIA_SCHEME, pipeline.handle)
  implement(media, {
    focus: (_, urls) => pipeline.focus.get(urls),
    saveFocus: (_, url, focus) => pipeline.focus.save(url, focus),
  })
  // 旧版独立缩略图缓存（thumb:// 时期，userData/thumb-cache）已不再使用
  void rm(join(app.getPath('userData'), 'thumb-cache'), {
    recursive: true,
    force: true,
  }).catch(() => {})
  return { warm: keys => pipeline.warm(keys) }
}

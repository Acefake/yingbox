/**
 * 组装按画面搜模块：缺省后端是下载到 <片库数据目录>/models 的中文 CLIP + onnxruntime-node，
 * 像素转换缺省在当前线程用 wasm 做（宿主注入编解码线程时走线程）；视频抽帧用宿主给的 ffmpeg。
 * 没有图片缓存目录（测试、内存库）时后端不可用。
 */
import { dirname, join } from 'node:path'
import { inProcessCodec } from '../../thumbnails/codec-client'
import type { LibraryDb } from '../db/database'
import type { ImageCache } from '../images/image-cache'
import type { JobQueue } from '../jobs/queue'
import { type VisualBackend, createClipBackend } from './clip-backend'
import type { DownloadFetch } from './clip-model-files'
import { codecClipPixels } from './clip-pixels'
import type { FrameHostOptions } from './frames/frame-indexer'
import { VisualModule } from './visual-module'

/** 宿主 / 测试可注入的项（LibraryServiceOptions.visual）。 */
export interface VisualOptions {
  backend?: VisualBackend
  /** 原图字节 → 224×224 RGBA。 */
  pixels?: (bytes: Uint8Array) => Promise<Uint8Array>
  /** 视频关键帧：ffmpeg 路径等（宿主给）；不给时不能抽帧。 */
  frames?: FrameHostOptions
}

/** 永远不可用的后端（没有数据目录时）。 */
const DISABLED: VisualBackend = {
  model: 'disabled',
  available: async () => false,
  modelReady: async () => false,
  download: async () => {
    throw new Error('按画面搜不可用')
  },
  embedImages: async () => [],
  embedText: async () => {
    throw new Error('按画面搜不可用')
  },
}

export type { VisualModule }

/**
 * 用服务参数组装（visual 注入项 + 识别层的图片缓存目录与出网实现）。
 * host 是正在构造的服务：图片缓存属于识别模块，用到时再取（识别模块后建）。
 */
export function createVisualModule(
  service: {
    visual?: VisualOptions
    identify?: { mediaDir?: string; fetch?: unknown }
    log?: (message: string) => void
  },
  host: {
    db: LibraryDb
    queue: JobQueue
    identifier?: { images: ImageCache | undefined }
    isCloudLibrary(libraryId: number): Promise<boolean>
  }
): VisualModule {
  const options = { ...service.visual, mediaDir: service.identify?.mediaDir }
  const fetch = (service.identify?.fetch ?? globalThis.fetch) as DownloadFetch
  const backend =
    options.backend ??
    (options.mediaDir
      ? createClipBackend({
          modelsDir: join(dirname(options.mediaDir), 'models'),
          fetch,
        })
      : DISABLED)
  return new VisualModule({
    db: host.db,
    queue: host.queue,
    backend,
    imageFile: async (url, signal) =>
      (await host.identifier?.images?.ensureFile(url, signal)) ?? null,
    pixels: options.pixels ?? codecClipPixels(inProcessCodec()),
    mediaDir: options.mediaDir,
    isCloudLibrary: id => host.isCloudLibrary(id),
    frames: options.frames,
    log: service.log,
  })
}

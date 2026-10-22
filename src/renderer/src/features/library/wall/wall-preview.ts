/**
 * 海报墙格子的悬停预览来源（悬停满延时才向片库要 getPreview）。
 *
 * - 本机可靠磁盘：视频经 local:// 协议（主进程 serveFile，支持 Range，从中间起播只读需要的那段）
 *   从片长 10% 处起播，只循环 6 秒；播不了（如浏览器不支持的编码）退回已缓存的图片；
 *   网页端走片库服务的 /media/files/<id>（同样支持 Range）；
 * - 网盘 / 网络路径：片库只给已缓存的图片，这里轮播；一张图都没有就保持静态海报。
 */
import type {
  ItemPreview,
  LibraryItemSummary,
} from '../../../../../shared/library/ipc'
import type { PreviewMedia, PreviewSource } from '@/components/ui/hover-preview'
import { isWebRuntime, serverFileUrl } from '@/services/library-server'
import { toLocalUrl } from '@/utils/local-url'

import { itemImage } from '../api/images'
import { libraryBridge } from '../api/bridge'

/** 本地片段：从片长的 10% 处开始 */
export const CLIP_START_RATIO = 0.1
/** 本地片段：只循环这么多秒 */
export const CLIP_SECONDS = 6

/** 依赖（测试替换）。 */
export interface WallPreviewDeps {
  getPreview: (itemId: number) => Promise<ItemPreview | null>
  /** 视频文件 → 可播放地址 */
  videoUrl: (video: NonNullable<ItemPreview['video']>) => string
  /** 缓存图 → 界面地址 */
  image: (url: string) => string | null
}

const defaultDeps = (): WallPreviewDeps => ({
  getPreview: id => libraryBridge()?.getPreview(id) ?? Promise.resolve(null),
  videoUrl: video =>
    isWebRuntime() ? serverFileUrl(video.fileId) : toLocalUrl(video.path),
  image: url => itemImage(url, 480),
})

/** 预览数据 → 要播的东西；什么都没有返回 null。 */
export function previewMedia(
  preview: ItemPreview | null,
  deps: Pick<WallPreviewDeps, 'videoUrl' | 'image'>
): PreviewMedia | null {
  if (!preview) return null
  const images = preview.images
    .map(deps.image)
    .filter((url): url is string => Boolean(url))
  if (preview.video)
    return {
      kind: 'video',
      url: deps.videoUrl(preview.video),
      startRatio: CLIP_START_RATIO,
      clipSeconds: CLIP_SECONDS,
      fallback: images.length ? images : undefined,
    }
  return images.length ? { kind: 'images', urls: images } : null
}

/** 一格的预览来源。 */
export function wallPreviewSource(
  item: LibraryItemSummary,
  deps: WallPreviewDeps = defaultDeps()
): PreviewSource {
  return {
    key: `library:${item.id}`,
    resolve: async () => previewMedia(await deps.getPreview(item.id), deps),
  }
}

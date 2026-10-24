/**
 * 进度条缩略图的桌面端胶水：定位 ffmpeg、调低子进程优先级、推送 seekReady、登记退出清理。
 *
 * 缓存与生成在 service.ts（不依赖 Electron），纯规则在 rules.ts 与 shared/seek-thumbnails.ts。
 * 雪碧图经 yingbox-media://seek/… 提供（与缩略图同一个协议，由 thumbnails/index.ts 分流过来）。
 */
import { execFile } from 'node:child_process'
import { constants, setPriority } from 'node:os'
import { media } from '../../shared/contract/media'
import { localUrlToFilePath } from '../local-media'
import { registerPlugin } from '../plugins/host'
import { emit } from '../rpc'
import { ffmpegCandidates } from './rules'
import { SeekThumbnailService } from './service'

/** 找不到 ffmpeg 后多久再重新探测（用户可能刚装上）。 */
const RETRY_LOCATE_MS = 5 * 60 * 1000

/** 跑一次 `<bin> -version`，能跑通就算可用。 */
function probe(bin: string): Promise<boolean> {
  return new Promise(resolve => {
    execFile(bin, ['-version'], { timeout: 5000, windowsHide: true }, error =>
      resolve(!error)
    )
  })
}

/** 带缓存的 ffmpeg 定位：找到后整个会话复用；找不到隔一段时间再试。 */
function createFfmpegLocator(): () => Promise<string | null> {
  let found: string | null = null
  let missedAt = 0
  return async () => {
    if (found) return found
    if (missedAt && Date.now() - missedAt < RETRY_LOCATE_MS) return null
    for (const candidate of ffmpegCandidates(process.platform, process.env)) {
      if (await probe(candidate)) {
        found = candidate
        return found
      }
    }
    missedAt = Date.now()
    return null
  }
}

/** 创建进度条缩略图服务并接上 IPC 推送与退出清理。 */
export function createSeekThumbnails(
  mediaDir: string,
  log: (message: string) => void
): {
  service: SeekThumbnailService
  /** IPC：local:// 地址 + 时长 → 状态 */
  request: (
    localUrl: string,
    duration: number
  ) => ReturnType<SeekThumbnailService['request']>
} {
  const service = new SeekThumbnailService({
    mediaDir,
    locateFfmpeg: createFfmpegLocator(),
    lowerPriority: child => {
      if (!child.pid) return
      try {
        setPriority(child.pid, constants.priority.PRIORITY_LOW)
      } catch {
        // 没有权限调整优先级时照常运行
      }
    },
    notify: manifest => emit(media, 'seekReady', manifest),
    log: message => log(`[seek] ${message}`),
  })
  registerPlugin({
    id: 'seek-thumbnails',
    stop: () => service.stop(),
    health: () => ({ running: service.busy }),
  })
  return {
    service,
    request: async (localUrl, duration) => {
      // 只接受 local:// 地址，渲染层不能借这个接口探测任意路径
      if (!localUrl.startsWith('local://')) return null
      const path = localUrlToFilePath(localUrl)
      return path ? service.request(path, duration) : null
    },
  }
}

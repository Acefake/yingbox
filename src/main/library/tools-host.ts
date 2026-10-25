/**
 * 主进程替媒体库引擎代办的工具定位（引擎侧见 engine/host-calls.ts）：
 * ffprobe 跟 ffmpeg 走同一套探测（YINGBOX_FFMPEG → 用户覆盖 → PATH → 常见安装位置，见 plugins/lada/tools），
 * 引擎拿到路径后自己起 ffprobe 读视频流的动态范围（scanner/video-probe.ts），
 * 起 ffmpeg 给按画面搜抽视频帧（visual/frames）。
 */
import { createFfmpegCache } from '../capture/ffmpeg-cache'
import {
  ffprobeFor,
  ladaPaths,
  onPathOverridesChange,
} from '../plugins/lada/tools'
import { LIBRARY_HOST_METHODS } from './engine/host-calls'

/** 没找到 ffmpeg 时多久内不再重新探测（探测是同步的，会卡主进程） */
const FFMPEG_RETRY_MS = 60_000

const ffmpegCache = createFfmpegCache(() => ladaPaths().ffmpeg, FFMPEG_RETRY_MS)
onPathOverridesChange(() => ffmpegCache.invalidate())

/** 媒体库引擎的工具定位代办方法表（交给 UtilityHost 的 host 选项）。 */
export function libraryToolsHost(): Record<string, () => Promise<string>> {
  return {
    // 没有 ffmpeg 时回空串：引擎据此跳过探测、不报错
    [LIBRARY_HOST_METHODS.ffprobePath]: async () => {
      const ffmpeg = ffmpegCache.get()
      return ffmpeg ? ffprobeFor(ffmpeg) : ''
    },
    [LIBRARY_HOST_METHODS.ffmpegPath]: async () => ffmpegCache.get() ?? '',
  }
}

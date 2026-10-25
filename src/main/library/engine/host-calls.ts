/**
 * 媒体库引擎请主进程代办的 AI 调用（线协议的 host / reply，见 shared/utility/protocol.ts；
 * 按 id 配对的调用口与远程源凭据共用 remote/host-remote.ts 的 createHostCaller）。
 *
 * 另有 ffprobe / ffmpeg 路径（视频动态范围探测、按画面搜抽帧用）：工具定位与用户覆盖在主进程，见 src/main/library/tools-host.ts。
 *
 * AI 识别兜底：大模型的配置、密钥与用量统计都在主进程（src/main/ai），
 * 引擎经 {@link LIBRARY_HOST_METHODS} 里的两个方法调用，主进程实现见 src/main/library/ai-host.ts。
 */
import type { AiJsonRequest } from '../../../shared/ai/types'
import type { LibraryAi, LibraryAiStatus } from '../identify/ai/ai-scrape-rules'
import type { HostCaller } from '../remote/host-remote'

/** 主进程为媒体库引擎实现的代办方法名。 */
export const LIBRARY_HOST_METHODS = {
  aiStatus: 'aiStatus',
  aiChatJson: 'aiChatJson',
  /** ffprobe 路径（主进程实现见 src/main/library/tools-host.ts）；没有时为空串 */
  ffprobePath: 'ffprobePath',
  /** ffmpeg 路径（按画面搜抽视频帧用，同上）；没有时为空串 */
  ffmpegPath: 'ffmpegPath',
} as const

/** 经主进程代办的大模型调用口。 */
export function hostAi(host: HostCaller): LibraryAi {
  return {
    status: () =>
      host.call(LIBRARY_HOST_METHODS.aiStatus, []) as Promise<LibraryAiStatus>,
    chatJson: (request: AiJsonRequest) =>
      host.call(LIBRARY_HOST_METHODS.aiChatJson, [request]),
  }
}

/** 经主进程查工具路径；主进程没回应时按没有处理。 */
function hostToolPath(host: HostCaller, method: string): () => Promise<string> {
  return () =>
    (host.call(method, []) as Promise<string>).then(
      path => (typeof path === 'string' ? path : ''),
      () => ''
    )
}

/** 经主进程查 ffprobe 路径。 */
export const hostFfprobePath = (host: HostCaller): (() => Promise<string>) =>
  hostToolPath(host, LIBRARY_HOST_METHODS.ffprobePath)

/** 经主进程查 ffmpeg 路径（按画面搜抽视频帧）。 */
export const hostFfmpegPath = (host: HostCaller): (() => Promise<string>) =>
  hostToolPath(host, LIBRARY_HOST_METHODS.ffmpegPath)

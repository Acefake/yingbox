/**
 * 网页端播放：没有内置播放器窗口和 mpv，用页内 <video> 播片库服务的 Range 流（/media/files/<id>）。
 * 状态是模块级单例，WebPlayer.vue 渲染它；同一时间只播一个。
 *
 * 浏览器能直接解码的格式有限（MP4 / WebM 里的 H.264、VP9、AV1 等），MKV / HEVC 视浏览器而定，
 * 播不了时 <video> 报错，界面提示改用桌面端。
 */
import { ref } from 'vue'

import { serverFileUrl } from '@/services/library-server'

/** 一个可播放的源。 */
export interface WebPlaySource {
  name: string
  url: string
}

/** 当前播放。 */
export interface WebPlayback {
  title: string
  poster?: string
  sources: WebPlaySource[]
  index: number
}

const current = ref<WebPlayback | null>(null)

/** 当前播放（响应式）；没有在播时为 null。 */
export function webPlayback(): typeof current {
  return current
}

/** 开始播放：文件 id 与展示名一一对应。 */
export function openWebPlayer(options: {
  title: string
  poster?: string
  files: Array<{ fileId: number; name: string }>
  index: number
}): boolean {
  if (!options.files.length) return false
  current.value = {
    title: options.title,
    poster: options.poster,
    sources: options.files.map(file => ({
      name: file.name,
      url: serverFileUrl(file.fileId),
    })),
    index: Math.min(Math.max(0, options.index), options.files.length - 1),
  }
  return true
}

/** 换到第 index 个源；越界时不动。 */
export function seekWebPlayer(index: number): void {
  const playback = current.value
  if (!playback || index < 0 || index >= playback.sources.length) return
  current.value = { ...playback, index }
}

/** 关闭播放。 */
export function closeWebPlayer(): void {
  current.value = null
}

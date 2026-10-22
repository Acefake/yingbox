/**
 * 网页端播放：没有内置播放器窗口和 mpv，用页内 <video> 播片库服务的 Range 流（/media/files/<id>）。
 * 状态和 <video> 都是模块级单例，WebPlayer.vue 渲染它；同一时间只播一个。
 * 播放中离开详情时 <video> 整体进应用内小窗（features/player 的 mini-dock），回来时认领回播放层。
 *
 * 浏览器能直接解码的格式有限（MP4 / WebM 里的 H.264、VP9、AV1 等），MKV / HEVC 视浏览器而定，
 * 播不了时 <video> 报错，界面提示改用桌面端。
 */
import { type Ref, ref } from 'vue'

import { claimMini, dockMini, preemptMini } from '@/features/player'
import { serverFileUrl } from '@/services/library-server'

/** 一个可播放的源。 */
export interface WebPlaySource {
  name: string
  url: string
}

/** 当前播放。 */
export interface WebPlayback {
  /** 这一次播放的标识（小窗认领用；连播换集时不变） */
  key: string
  title: string
  poster?: string
  sources: WebPlaySource[]
  index: number
  /** 正在应用内小窗里播（播放层隐藏） */
  docked?: boolean
}

const current = ref<WebPlayback | null>(null)
const failed = ref(false)
let videoEl: HTMLVideoElement | null = null
let opened = 0

/** 当前播放（响应式）；没有在播时为 null。 */
export function webPlayback(): typeof current {
  return current
}

/** 当前源浏览器播不了（响应式）。 */
export function webPlaybackFailed(): Readonly<Ref<boolean>> {
  return failed
}

/**
 * 页内播放用的唯一一个 <video>。由本模块创建和持有、不归 Vue 模板管，
 * 所以可以整体搬进应用内小窗再搬回播放层，地址、进度、缓冲都不变。
 */
export function webVideo(): HTMLVideoElement {
  if (videoEl) return videoEl
  const el = document.createElement('video')
  el.className = 'web-player__video'
  el.controls = true
  el.autoplay = true
  el.playsInline = true
  el.tabIndex = 0
  el.addEventListener('ended', () => {
    if (current.value) seekWebPlayer(current.value.index + 1)
  })
  el.addEventListener('error', () => {
    if (el.getAttribute('src')) failed.value = true
  })
  videoEl = el
  return el
}

/** 把当前源交给 <video>（地址没变就不动，避免重新请求） */
function load(playback: WebPlayback): void {
  const el = webVideo()
  const url = playback.sources[playback.index].url
  failed.value = false
  if (el.getAttribute('src') !== url) el.src = url
  el.poster = playback.poster ?? ''
}

/** 开始播放：文件 id 与展示名一一对应。小窗里有别的播放时先拆掉。 */
export function openWebPlayer(options: {
  title: string
  poster?: string
  files: Array<{ fileId: number; name: string }>
  index: number
}): boolean {
  if (!options.files.length) return false
  const key = `library-web:${++opened}`
  preemptMini(key)
  current.value = {
    key,
    title: options.title,
    poster: options.poster,
    sources: options.files.map(file => ({
      name: file.name,
      url: serverFileUrl(file.fileId),
    })),
    index: Math.min(Math.max(0, options.index), options.files.length - 1),
  }
  load(current.value)
  return true
}

/** 换到第 index 个源；越界时不动。 */
export function seekWebPlayer(index: number): void {
  const playback = current.value
  if (!playback || index < 0 || index >= playback.sources.length) return
  current.value = { ...playback, index }
  load(current.value)
}

/** 关闭播放（拆除）。 */
export function closeWebPlayer(): void {
  current.value = null
  failed.value = false
  const el = videoEl
  if (!el) return
  el.remove()
  try {
    el.pause()
    el.removeAttribute('src')
    el.load()
  } catch {
    // 停止失败不影响关闭
  }
}

/**
 * 离开详情：播放中就把 <video> 交给应用内小窗，播放层隐藏；没进小窗返回 false。
 * @param restore 小窗「回到详情」：导航回去，之后调 undockWebPlayer
 */
export function dockWebPlayer(restore: () => void): boolean {
  const playback = current.value
  if (!playback || playback.docked || !videoEl) return false
  const ok = dockMini({
    key: playback.key,
    title: playback.title,
    node: videoEl,
    video: videoEl,
    restore,
    teardown: closeWebPlayer,
  })
  if (ok) current.value = { ...playback, docked: true }
  return ok
}

/** 回到详情：重新显示播放层（<video> 由播放层认领回去） */
export function undockWebPlayer(): void {
  const playback = current.value
  if (playback?.docked) current.value = { ...playback, docked: false }
}

/** 播放层显示时调用：认领小窗里的会话，返回要放进播放层的 <video> */
export function claimWebVideo(): HTMLVideoElement {
  if (current.value) claimMini(current.value.key)
  return webVideo()
}

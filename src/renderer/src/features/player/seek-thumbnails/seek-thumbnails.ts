/**
 * 进度条缩略图（内置播放器，本地文件）：开播后向主进程要雪碧图清单，
 * 没有就等主进程后台生成完推送 seekReady；拿到后悬停进度条时显示对应帧。
 *
 * 显示复用 Artplayer 自带的 thumbnails 控件（定位、显隐动画、皮肤都沿用），
 * 但不设 option.thumbnails.url：自带逻辑只支持单张雪碧图，这里按时间换页、算帧位置（seekFrameAt）。
 * 没有 ffmpeg、不是本地文件、时长不合适时什么都不做，进度条照常只显示时间。
 */
import type Artplayer from 'artplayer'

import {
  type SeekManifest,
  seekFrameAt,
  seekSpriteUrl,
} from '@shared/seek-thumbnails'

type SeekWaiter = (manifest: SeekManifest) => void

/** 等待生成完的播放器：key → 回调（同一部视频可能被多个实例等待） */
const waiters = new Map<string, Set<SeekWaiter>>()
let listening = false

/** 全应用只订阅一次 seekReady，按 key 分发。 */
function ensureListener(): void {
  if (listening) return
  const mediaApi = window.api?.media
  if (!mediaApi?.onSeekReady) return
  listening = true
  mediaApi.onSeekReady(manifest => {
    const set = waiters.get(manifest.key)
    if (!set) return
    waiters.delete(manifest.key)
    for (const waiter of set) waiter(manifest)
  })
}

function addWaiter(key: string, waiter: SeekWaiter): () => void {
  let set = waiters.get(key)
  if (!set) {
    set = new Set()
    waiters.set(key, set)
  }
  set.add(waiter)
  return () => {
    set.delete(waiter)
    if (!set.size && waiters.get(key) === set) waiters.delete(key)
  }
}

/** Artplayer 的缩略图控件节点 */
function thumbnailsControl(art: Artplayer): HTMLElement | null {
  const controls = art.controls as unknown as Record<string, unknown>
  const node = controls?.['thumbnails']
  return node instanceof HTMLElement ? node : null
}

/** 拿到清单后接管悬停：按时间算页与帧位置，设置控件的背景与位置。 */
function enable(art: Artplayer, manifest: SeekManifest): void {
  const { $progress } = art.template
  // 先取第一页，第一次悬停时不用等加载
  new Image().src = seekSpriteUrl(manifest.key, 0)

  art.on('setBar', (type, percentage) => {
    if (type !== 'hover') return
    const node = thumbnailsControl(art)
    const duration = art.duration
    if (!node || !Number.isFinite(duration) || duration <= 0) return
    const frame = seekFrameAt(percentage * duration, manifest)
    if (!frame) return
    const { width, height } = manifest
    const barWidth = $progress.clientWidth
    const pos = barWidth * percentage
    const left = Math.min(Math.max(pos - width / 2, 0), barWidth - width)
    node.style.backgroundImage = `url("${seekSpriteUrl(manifest.key, frame.page)}")`
    node.style.width = `${width}px`
    node.style.height = `${height}px`
    node.style.backgroundPosition = `-${frame.column * width}px -${frame.row * height}px`
    node.style.left = `${Math.max(left, 0)}px`
  })
}

/** 向主进程要清单；需要等生成时登记回调，实例销毁时撤掉。 */
async function request(art: Artplayer, source: string): Promise<void> {
  const mediaApi = window.api?.media
  if (!mediaApi?.seekThumbnails) return
  let destroyed = false
  art.on('destroy', () => {
    destroyed = true
  })
  ensureListener()
  let status
  try {
    status = await mediaApi.seekThumbnails(source, art.duration)
  } catch {
    return
  }
  if (!status || destroyed) return
  if (status.manifest) {
    enable(art, status.manifest)
    return
  }
  const remove = addWaiter(status.key, manifest => {
    if (!destroyed) enable(art, manifest)
  })
  art.on('destroy', remove)
}

/**
 * 给一个播放器实例装上进度条缩略图（只对 local:// 本地文件生效）。
 * 时长要从元数据读，所以等 loadedmetadata 之后再向主进程要。
 */
export function installSeekThumbnails(art: Artplayer, source: string): void {
  if (!source.startsWith('local://') || art.option.isLive) return
  if (Number.isFinite(art.duration) && art.duration > 0) {
    void request(art, source)
    return
  }
  art.once('video:loadedmetadata', () => void request(art, source))
}

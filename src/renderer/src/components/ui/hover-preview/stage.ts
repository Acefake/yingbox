/**
 * 悬停预览的 DOM 舞台：全应用复用一个 <video> 和一个 <img>，挂到当前卡片的预览层里。
 *
 * - 视频静音、内联、不出画中画；开始播放（playing）才淡入，之前一直是静态封面，不闪黑；
 * - startRatio / clipSeconds：本地影片从片中某处起播，只循环那几秒；
 * - 出错（编码不支持、地址失效）：有备用图片就改轮播图片，没有就收起；
 * - 释放：暂停、去掉 src 再 load()，让浏览器立刻断开连接、丢掉解码器，元素移出卡片。
 */
import type { PreviewStage } from './controller'
import type { PreviewMedia } from './types'

/** 图片默认停留时间 */
const IMAGE_INTERVAL_MS = 1200
/** 淡入时加的 class（样式在 ui.css） */
const VISIBLE = 'is-visible'

/** 创建舞台；doc 便于测试替换。 */
export function createDomStage(doc: Document = document): PreviewStage {
  let video: HTMLVideoElement | null = null
  let image: HTMLImageElement | null = null
  let ticker: ReturnType<typeof setInterval> | undefined

  function makeVideo(): HTMLVideoElement {
    const el = doc.createElement('video')
    el.className = 'ui-preview-media'
    el.muted = true
    el.playsInline = true
    el.preload = 'auto'
    el.setAttribute('aria-hidden', 'true')
    el.setAttribute('disablepictureinpicture', '')
    el.setAttribute('disableremoteplayback', '')
    return el
  }

  function makeImage(): HTMLImageElement {
    const el = doc.createElement('img')
    el.className = 'ui-preview-media'
    el.setAttribute('alt', '')
    el.setAttribute('aria-hidden', 'true')
    el.setAttribute('referrerpolicy', 'no-referrer')
    return el
  }

  function releaseVideo(): void {
    if (!video) return
    const el = video
    el.onloadedmetadata = el.ontimeupdate = el.onplaying = el.onerror = null
    el.classList.remove(VISIBLE)
    el.pause()
    el.removeAttribute('src')
    el.load()
    el.remove()
  }

  function releaseImages(): void {
    if (ticker) clearInterval(ticker)
    ticker = undefined
    if (!image) return
    image.onload = null
    image.classList.remove(VISIBLE)
    image.src = ''
    image.remove()
  }

  function showImages(
    host: HTMLElement,
    urls: string[],
    interval?: number
  ): void {
    if (!urls.length) return
    const el = (image ??= makeImage())
    let index = 0
    el.onload = () => el.classList.add(VISIBLE)
    el.src = urls[0]
    host.append(el)
    if (urls.length > 1)
      ticker = setInterval(() => {
        index = (index + 1) % urls.length
        el.src = urls[index]
      }, interval ?? IMAGE_INTERVAL_MS)
  }

  function showVideo(
    host: HTMLElement,
    media: Extract<PreviewMedia, { kind: 'video' }>
  ): void {
    const el = (video ??= makeVideo())
    const clip = media.clipSeconds
    let from = 0
    el.loop = !clip
    el.onloadedmetadata = () => {
      if (media.startRatio && Number.isFinite(el.duration))
        el.currentTime = from = el.duration * media.startRatio
    }
    el.ontimeupdate = () => {
      if (clip && el.currentTime >= from + clip) el.currentTime = from
    }
    el.onplaying = () => el.classList.add(VISIBLE)
    el.onerror = () => {
      releaseVideo()
      if (media.fallback?.length) showImages(host, media.fallback)
    }
    el.src = media.url
    host.append(el)
    void el.play()?.catch(() => {})
  }

  const clear = (): void => {
    releaseVideo()
    releaseImages()
  }

  return {
    show(host, media) {
      clear()
      if (media.kind === 'video') showVideo(host, media)
      else showImages(host, media.urls, media.intervalMs)
    },
    clear,
  }
}

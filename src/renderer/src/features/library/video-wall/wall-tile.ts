/**
 * 视频墙的一格（DOM）：每格自己的 <video> / <img>，挂在格子的媒体层里，海报在下面垫底。
 *
 * - 真放视频（live）：静音、内联、关画中画；按预览来源从片中某处起播、只播 clipSeconds 秒，
 *   播满（或整段播完）通知 onDone 换片；开始播放（playing）才淡入，之前一直是海报；
 * - 解码失败（error）：通知 onFailed、释放 video，改轮播备用图，停留 dwellMs 后换片；
 * - 吃力：waiting 超过 stallMs 没恢复，或两次采样之间掉帧超过四分之一，通知 onStrain（调度器降级）；
 * - 不占名额的视频格 / 只有缓存图的条目（网盘）：轮播图片，停留 dwellMs 后换片；什么都没有就只留海报；
 * - 暂停：视频 pause()、停留计时停表；继续接着算；
 * - 释放（换片、退出）：暂停、去掉 src 再 load()，让浏览器立刻断开连接、丢掉解码器，元素移出格子。
 */
import type { PreviewMedia } from '@/components/ui/hover-preview'

/** 淡入时加的 class（样式在 ui.css，与悬停预览共用） */
const VISIBLE = 'is-visible'
/** 掉帧采样间隔 */
const QUALITY_SAMPLE_MS = 2000
/** 采样窗口里至少这么多帧才下结论 */
const QUALITY_MIN_FRAMES = 30

/** 一格向调度器报告的事。 */
export interface TileCallbacks {
  /** 这段播完 / 停留够了，换下一部 */
  onDone(): void
  /** 视频播不了（编码不支持、文件读不了） */
  onFailed(): void
  /** 播放吃力（卡顿、掉帧） */
  onStrain(): void
}

/** 时长参数（测试可调）。 */
export interface TileTiming {
  /** 只放图 / 什么都没有时每部停留多久 */
  dwellMs: number
  /** 卡住多久算吃力 */
  stallMs: number
}

const DEFAULT_TIMING: TileTiming = { dwellMs: 6000, stallMs: 3000 }

/** 一格。 */
export interface WallTile {
  /** 放一部：media 为 null 只留海报；live 为假时视频也只轮播备用图 */
  show(media: PreviewMedia | null, live: boolean): void
  pause(): void
  resume(): void
  /** 释放所有元素与计时器 */
  release(): void
}

/** 掉帧采样。 */
export type FrameQuality = Pick<
  VideoPlaybackQuality,
  'totalVideoFrames' | 'droppedVideoFrames'
>

/** 两次采样之间掉帧超过四分之一（且帧数够多）算吃力。 */
export function isStrained(prev: FrameQuality, cur: FrameQuality): boolean {
  const total = cur.totalVideoFrames - prev.totalVideoFrames
  const dropped = cur.droppedVideoFrames - prev.droppedVideoFrames
  return total >= QUALITY_MIN_FRAMES && dropped / total > 0.25
}

/**
 * 新建一格。
 * @param host - 媒体层元素（盖在海报上）
 * @param cb - 报告给调度器
 * @param timing - 时长参数
 */
export function createWallTile(
  host: HTMLElement,
  cb: TileCallbacks,
  timing: TileTiming = DEFAULT_TIMING
): WallTile {
  const doc = host.ownerDocument
  let video: HTMLVideoElement | null = null
  let image: HTMLImageElement | null = null
  let ticker: ReturnType<typeof setInterval> | undefined
  let stall: ReturnType<typeof setTimeout> | undefined
  /** 停留计时：剩余毫秒与本轮开始时刻（暂停时结算） */
  let dwell: {
    left: number
    since: number
    timer?: ReturnType<typeof setTimeout>
  } | null = null
  let images: string[] = []
  let paused = false
  let finished = false

  const done = (): void => {
    if (finished) return
    finished = true
    cb.onDone()
  }

  function startDwell(): void {
    if (!dwell || paused) return
    dwell.since = Date.now()
    dwell.timer = setTimeout(done, dwell.left)
  }

  function stopDwell(): void {
    if (!dwell?.timer) return
    clearTimeout(dwell.timer)
    dwell.timer = undefined
    dwell.left = Math.max(0, dwell.left - (Date.now() - dwell.since))
  }

  function releaseVideo(): void {
    if (stall) clearTimeout(stall)
    stall = undefined
    if (!video) return
    const el = video
    video = null
    el.onloadedmetadata = el.ontimeupdate = el.onplaying = null
    el.onwaiting = el.onerror = el.onended = null
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
    image.removeAttribute('src')
    image.remove()
    image = null
  }

  function startTicker(): void {
    if (paused || images.length < 2 || !image) return
    const el = image
    let index = images.indexOf(el.getAttribute('src') ?? '')
    ticker = setInterval(
      () => {
        index = (index + 1) % images.length
        el.setAttribute('src', images[index])
      },
      Math.round(timing.dwellMs / images.length)
    )
  }

  /** 轮播图片，停留 dwellMs 后换片（没有图只留海报）。 */
  function showImages(urls: string[]): void {
    images = urls
    if (urls.length) {
      const el = doc.createElement('img')
      el.className = 'ui-preview-media video-wall-media'
      el.alt = ''
      el.setAttribute('aria-hidden', 'true')
      el.setAttribute('referrerpolicy', 'no-referrer')
      el.onload = () => el.classList.add(VISIBLE)
      el.setAttribute('src', urls[0])
      host.append(el)
      image = el
      startTicker()
    }
    dwell = { left: timing.dwellMs, since: 0 }
    startDwell()
  }

  function showVideo(media: Extract<PreviewMedia, { kind: 'video' }>): void {
    const el = doc.createElement('video')
    el.className = 'ui-preview-media video-wall-media'
    el.muted = true
    el.playsInline = true
    el.preload = 'auto'
    el.setAttribute('aria-hidden', 'true')
    el.setAttribute('disablepictureinpicture', '')
    el.setAttribute('disableremoteplayback', '')
    const clip = media.clipSeconds
    let from = 0
    let sample: { at: number; q: FrameQuality } | null = null
    el.onloadedmetadata = () => {
      if (media.startRatio && Number.isFinite(el.duration))
        el.currentTime = from = el.duration * media.startRatio
    }
    el.ontimeupdate = () => {
      if (clip && el.currentTime >= from + clip) done()
      const now = Date.now()
      if (!el.getVideoPlaybackQuality) return
      if (sample && now - sample.at < QUALITY_SAMPLE_MS) return
      const q = el.getVideoPlaybackQuality()
      if (sample && isStrained(sample.q, q)) cb.onStrain()
      sample = { at: now, q }
    }
    el.onended = done
    el.onplaying = () => {
      if (stall) clearTimeout(stall)
      stall = undefined
      el.classList.add(VISIBLE)
    }
    el.onwaiting = () => {
      if (stall) clearTimeout(stall)
      stall = setTimeout(() => {
        stall = undefined
        cb.onStrain()
      }, timing.stallMs)
    }
    el.onerror = () => {
      releaseVideo()
      cb.onFailed()
      showImages(media.fallback ?? [])
    }
    el.setAttribute('src', media.url)
    host.append(el)
    video = el
    if (!paused) void el.play()?.catch(() => {})
  }

  function clear(): void {
    releaseVideo()
    releaseImages()
    if (dwell?.timer) clearTimeout(dwell.timer)
    dwell = null
    images = []
  }

  return {
    show(media, live) {
      clear()
      finished = false
      if (media?.kind === 'video' && live) showVideo(media)
      else if (media?.kind === 'video') showImages(media.fallback ?? [])
      else showImages(media?.urls ?? [])
    },
    pause() {
      if (paused) return
      paused = true
      video?.pause()
      if (ticker) clearInterval(ticker)
      ticker = undefined
      if (stall) clearTimeout(stall)
      stall = undefined
      stopDwell()
    },
    resume() {
      if (!paused) return
      paused = false
      if (video) void video.play()?.catch(() => {})
      startTicker()
      startDwell()
    },
    release() {
      finished = true
      clear()
    },
  }
}

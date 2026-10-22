/**
 * 海报取景（渲染层）：图片加载后按焦点写 object-position，横版剧照 / 番号封套裁成竖版海报时不切掉人脸。
 *
 * - 只处理会被裁的图（图与框比例不同），地址是缩略图地址（桌面 yingbox-media://image|thumb/，
 *   网页 /media/image|thumb）；焦点由主进程 / 片库服务算好并随缩略图缓存持久化（shared/media-focus.ts）；
 * - 同一轮加载的合并成一批（≤ FOCUS_BATCH），同时只有一个请求在途；发请求前离开页面的图（虚拟网格回收、
 *   换页）直接丢掉，等于取消；问过的地址记在内存里，再次出现同步写样式；
 * - 有 FaceDetector（Windows / macOS，见 face-detector.ts）时，启发式结果在后台逐张用人脸细化，
 *   一次一张、间隔 DETECT_GAP_MS，结果写回主进程（之后所有窗口、重启后都用它）；平台没实现就不再尝试。
 */
import {
  FOCUS_BATCH,
  type MediaFocus,
  focusPosition,
} from '../../../../shared/media-focus'
import { serverFocus, serverSaveFocus } from '@/services/library-server'
import { type FaceBox, type FaceDetect, faceDetector } from './face-detector'

export type { FaceBox, FaceDetect }

/** 焦点的来源：桌面端 IPC，网页端片库服务。 */
export interface FocusTransport {
  get(urls: string[]): Promise<Array<MediaFocus | null>>
  save(url: string, focus: MediaFocus): Promise<void>
}

/** 合并一批的等待时间。 */
const BATCH_DELAY_MS = 30
/** 两次人脸检测之间的间隔（让出主线程与 GPU）。 */
const DETECT_GAP_MS = 40
/** 内存里记多少个地址的焦点。 */
const MEMORY_LIMIT = 2000
/** 图与框的比例差在这以内算不裁。 */
const SAME_ASPECT = 0.02

const FOCUSABLE =
  /^(yingbox-media:\/\/(image|thumb)\/|\/media\/(image\/|thumb\?))/

/** 一张等焦点的图。 */
interface Pending {
  img: HTMLImageElement
  frame: number
}

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

/** 图还在页面上、还是这个地址。 */
const showing = (img: HTMLImageElement, src: string): boolean =>
  img.isConnected && img.getAttribute('src') === src

/** 按焦点写 object-position。 */
function paint(img: HTMLImageElement, frame: number, focus: MediaFocus): void {
  img.style.objectPosition = focusPosition(
    focus,
    img.naturalWidth / img.naturalHeight,
    frame
  )
}

const round = (value: number): number => Math.round(value * 1000) / 1000

/** 人脸检测结果 → 新焦点：取框里（没有框就全图）最大的那张脸；没有脸记为已检测。 */
function withFaces(
  focus: MediaFocus,
  faces: FaceBox[],
  width: number,
  height: number
): MediaFocus {
  const [x0, y0, x1, y1] = focus.box ?? [0, 0, 1, 1]
  let best: { x: number; y: number; area: number } | null = null
  for (const face of faces) {
    const x = (face.x + face.width / 2) / width
    const y = (face.y + face.height / 2) / height
    const area = face.width * face.height
    if (x < x0 || x > x1 || y < y0 || y > y1) continue
    if (!best || area > best.area) best = { x, y, area }
  }
  if (!best) return { ...focus, checked: true }
  const { checked: _, ...rest } = focus
  return { ...rest, x: round(best.x), y: round(best.y), by: 'face' }
}

/** 创建一个取景客户端（单测注入传输层与检测器；界面用默认实例 applyFocus）。 */
export function createFocusClient(
  transport: FocusTransport,
  detect: FaceDetect | null = null
): { apply(img: HTMLImageElement, frame: number): void } {
  const known = new Map<string, MediaFocus | null>()
  const waiting = new Map<string, Pending[]>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let busy = false
  let canDetect = Boolean(detect)
  const detectQueue: Array<Pending & { src: string }> = []
  let detecting = false

  function remember(src: string, focus: MediaFocus | null): void {
    known.delete(src)
    known.set(src, focus)
    if (known.size > MEMORY_LIMIT) known.delete(known.keys().next().value!)
  }

  function schedule(): void {
    if (!timer && !busy && waiting.size)
      timer = setTimeout(() => void flush(), BATCH_DELAY_MS)
  }

  async function flush(): Promise<void> {
    timer = undefined
    for (const [src, list] of waiting) {
      const alive = list.filter(p => showing(p.img, src))
      if (alive.length) waiting.set(src, alive)
      else waiting.delete(src)
    }
    const urls = [...waiting.keys()].slice(0, FOCUS_BATCH)
    if (!urls.length) return
    const batch = urls.map(src => [src, waiting.get(src)!] as const)
    for (const src of urls) waiting.delete(src)
    busy = true
    try {
      const results = await transport.get(urls)
      batch.forEach(([src, list], i) => {
        const focus = results[i] ?? null
        remember(src, focus)
        if (focus) for (const p of list) settle(src, p, focus)
      })
    } catch {
      // 取不到焦点就保持居中，不打扰界面；这一批不重试
    } finally {
      busy = false
      schedule()
    }
  }

  /** 焦点到手：还显示着就写样式，再看要不要人脸细化。 */
  function settle(src: string, p: Pending, focus: MediaFocus): void {
    if (!showing(p.img, src)) return
    paint(p.img, p.frame, focus)
    if (!canDetect || focus.by === 'face' || focus.checked) return
    if (detectQueue.some(q => q.src === src)) return
    detectQueue.push({ ...p, src })
    void pump()
  }

  async function pump(): Promise<void> {
    if (detecting) return
    detecting = true
    try {
      while (canDetect && detectQueue.length) {
        const { img, frame, src } = detectQueue.shift()!
        const focus = known.get(src)
        if (!focus || !showing(img, src)) continue
        let faces: FaceBox[]
        try {
          faces = await detect!(img)
        } catch (error) {
          if ((error as Error).name === 'NotSupportedError') canDetect = false
          continue
        }
        const next = withFaces(
          focus,
          faces,
          img.naturalWidth,
          img.naturalHeight
        )
        remember(src, next)
        if (showing(img, src)) paint(img, frame, next)
        transport.save(src, next).catch(() => {})
        await sleep(DETECT_GAP_MS)
      }
    } finally {
      detecting = false
    }
  }

  return {
    apply(img, frame) {
      const src = img.getAttribute('src')
      const { naturalWidth: w, naturalHeight: h } = img
      if (!src || !FOCUSABLE.test(src) || !w || !h) return
      if (Math.abs(w / h / frame - 1) < SAME_ASPECT) return
      if (known.has(src)) {
        const focus = known.get(src)
        if (focus) settle(src, { img, frame }, focus)
        return
      }
      const list = waiting.get(src)
      if (list) list.push({ img, frame })
      else waiting.set(src, [{ img, frame }])
      schedule()
    },
  }
}

/** 默认传输层：桌面端走 IPC media 域，网页端走片库服务。 */
function defaultTransport(): FocusTransport {
  const api = typeof window !== 'undefined' ? window.api : undefined
  if (api)
    return {
      get: urls => api.media.focus(urls),
      save: (url, focus) => api.media.saveFocus(url, focus),
    }
  return { get: serverFocus, save: serverSaveFocus }
}

let client: ReturnType<typeof createFocusClient> | null = null

/**
 * 图片加载后调用（<img @load>）：会被裁的图按焦点取景。
 * @param frame 框的宽高比（竖版海报 2/3、横版 16/9）
 */
export function applyFocus(img: HTMLImageElement, frame: number): void {
  client ??= createFocusClient(defaultTransport(), faceDetector())
  client.apply(img, frame)
}

/**
 * 海报取景的焦点：横版剧照 / 番号封套放进竖版海报框（object-fit: cover）时，画面里该留住的点。
 *
 * - 焦点是归一化坐标（0–1），与图片尺寸无关：同一张图的各档缩略图共用一份；
 * - 主进程在缩略图管线里算（src/main/thumbnails/focus），随缩略图缓存持久化；
 * - 界面只改 object-position（focusPosition），不重新编码图片；
 * - 渲染层有 FaceDetector（Windows / macOS）时在后台细化，结果写回（by = 'face'）。
 */

/** 焦点算法版本：判据变了就加一，旧的启发式结果会重算；人脸检测的结果不受影响。 */
export const FOCUS_VERSION = 1

/** 一次最多问几张（IPC 与片库服务同一上限）。 */
export const FOCUS_BATCH = 24

/**
 * 焦点从哪来：
 * - face：FaceDetector 检到的人脸（渲染层写回）；
 * - skin：肤色连通块里最大那个人的头部；
 * - edges：没有人时，边缘能量的重心；
 * - center：画面平坦，取（正面框的）正中。
 */
export const FOCUS_METHODS = ['face', 'skin', 'edges', 'center'] as const
export type FocusMethod = (typeof FOCUS_METHODS)[number]

/** 一张图的焦点。 */
export interface MediaFocus {
  /** 算法版本（FOCUS_VERSION）。 */
  v: number
  x: number
  y: number
  by: FocusMethod
  /**
   * 该留在画面里的区域 [x0, y0, x1, y1]（归一化）：番号封套的正面（书脊右侧）。
   * 取景时窗口尽量不出这个框，宁可脸不在正中，也不露书脊和背面。
   */
  box?: [number, number, number, number]
  /** 已用 FaceDetector 检过、没检到脸（不再重复检测）。 */
  checked?: boolean
}

const unit = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1

/** 校验一条焦点记录（读缓存文件、IPC / HTTP 入参）；不合法返回 null。 */
export function parseFocus(value: unknown): MediaFocus | null {
  if (!value || typeof value !== 'object') return null
  const { v, x, y, by, box, checked } = value as Record<string, unknown>
  if (!Number.isSafeInteger(v) || !unit(x) || !unit(y)) return null
  if (!FOCUS_METHODS.includes(by as FocusMethod)) return null
  const focus: MediaFocus = { v: v as number, x, y, by: by as FocusMethod }
  if (box !== undefined) {
    if (!Array.isArray(box) || box.length !== 4 || !box.every(unit)) return null
    const [x0, y0, x1, y1] = box as number[]
    if (!(x0! < x1! && y0! < y1!)) return null
    focus.box = [x0!, y0!, x1!, y1!]
  }
  if (checked === true) focus.checked = true
  else if (checked !== undefined) return null
  return focus
}

/**
 * 一个轴上窗口的起点（归一化）：让焦点落在窗口正中，再尽量收进 [lo, hi] 这一段，最后不出图。
 * 段比窗口宽：窗口在段内滑；段比窗口窄：窗口把段整个装下。
 */
function windowStart(
  focus: number,
  visible: number,
  lo: number,
  hi: number
): number {
  let start = focus - visible / 2
  const [min, max] =
    hi - lo >= visible ? [lo, hi - visible] : [hi - visible, lo]
  start = Math.min(max, Math.max(min, start))
  return Math.min(1 - visible, Math.max(0, start))
}

/** 一个轴的 object-position 百分比；这个轴不裁（整幅可见）时为 50。 */
function axis(focus: number, visible: number, lo: number, hi: number): number {
  if (!(visible < 0.999)) return 50
  return Math.round((windowStart(focus, visible, lo, hi) / (1 - visible)) * 100)
}

/**
 * 焦点 → object-position（配合 object-fit: cover）。
 *
 * object-position 的百分比是「图上这一点对齐到框的同一百分比处」，不是「这一点放到框正中」：
 * 可见部分占图的 v 时，让焦点居中的取值是 (焦点 − v/2) / (1 − v)，再夹到 0–100%。
 *
 * @param imageAspect 图片宽高比（naturalWidth / naturalHeight）
 * @param frameAspect 框的宽高比（竖版海报 2/3）
 */
export function focusPosition(
  focus: MediaFocus,
  imageAspect: number,
  frameAspect: number
): string {
  const [x0, y0, x1, y1] = focus.box ?? [0, 0, 1, 1]
  const x = axis(focus.x, frameAspect / imageAspect, x0, x1)
  const y = axis(focus.y, imageAspect / frameAspect, y0, y1)
  return `${x}% ${y}%`
}

/**
 * 焦点计算（纯 TS、无依赖，在编解码线程里跑；单测直接调用）：RGBA → 归一化焦点。
 *
 * 三步，都在缩小到长边 ANALYSIS_SIDE 的采样图上做（一张 300 宽的缩略图约 1–3 ms）：
 * 1. 番号封套（背面 | 书脊 | 正面 拼成的横图，宽高比 1.2–1.65）：找书脊折痕——
 *    只在「切出来的正面宽高比落在 PANEL_ASPECT」的那几列里找整高的竖直直线，找到就把正面框成 box，
 *    后面两步只看框里。找不到不框：普通 3:2 剧照也是这个比例，不能凭比例猜正面在右。
 * 2. 人：肤色（Kovac RGB 规则）连通块，取面积大、位置靠上的那个，焦点是它头部那一段的重心
 *    （头部高度按块顶部的宽度估，人脸下面连着的脖子、躯干不算）。
 * 3. 没有人：边缘能量（亮度梯度平方）的重心；画面平坦就取（框的）正中。
 *
 * 这是启发式，不是人脸检测：肤色规则对灰度图、极暗或偏色的图无效，会退到第 3 步。
 * Windows / macOS 上渲染层还会用 FaceDetector 细化（见 services/thumbnails/focus.ts）。
 */
import { FOCUS_VERSION, type MediaFocus } from '../../../shared/media-focus'

/** 采样图长边（像素）。 */
const ANALYSIS_SIDE = 160
/** 封套宽高比范围：之外是竖版正封或 16:9 剧照，没有书脊可找。 */
const SLEEVE_ASPECT: [number, number] = [1.2, 1.65]
/** 正面（书脊右侧到右缘）宽高比的可信区间，折痕只在切出这个形状的列里找（DMM 封套实测约 0.70）。 */
const PANEL_ASPECT: [number, number] = [0.66, 0.78]
/** 相邻两列亮度差超过它才算一行里的边。 */
const FOLD_STEP = 0.05
/**
 * 脊线连续度门槛与相对全图中位数的倍数。实测（缩到 160 宽）：17 张 DMM 封套 0.40–0.92、
 * 至少是中位数的 2.9 倍；14 张 3:2 / 4:3 的普通剧照与老照片最高 0.33、或不到中位数的 2.5 倍。
 */
const FOLD_RIDGE = 0.38
const FOLD_CONTRAST = 2.5
/** 窗口里强度达到最强列这个比例的都算候选，取最右那条（书脊右缘，正面从这里开始）。 */
const FOLD_RIVAL = 0.8
/** 肤色块面积占搜索区域的比例：太小是零星色块，太大是肤色背景（木纹、沙滩、米色墙）。 */
const BLOB_AREA: [number, number] = [0.004, 0.6]
/** 平均边缘强度低于它算平坦画面。 */
const FLAT_EDGE = 0.01

/** 采样图：每格的亮度（0–1）、是否肤色。 */
interface Sample {
  w: number
  h: number
  lum: Float32Array
  skin: Uint8Array
}

/** 搜索区域（采样图像素，左闭右开）。 */
interface Region {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Kovac 等的 RGB 肤色规则（白天光照），再去掉它会误收的正红（红毯、红布：绿远低于红）。
 * 不卡蓝绿关系：冷光下的脸蓝会高过绿。
 */
function isSkin(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return (
    r > 95 &&
    g > 40 &&
    b > 20 &&
    max - min > 15 &&
    Math.abs(r - g) > 15 &&
    r > g &&
    r > b &&
    g > r * 0.4
  )
}

/** 按块平均缩小到长边 ANALYSIS_SIDE（原图更小就不缩）。 */
function sample(rgba: Uint8Array, width: number, height: number): Sample {
  const scale = Math.min(1, ANALYSIS_SIDE / Math.max(width, height))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const sums = new Float32Array(w * h * 4)
  for (let y = 0; y < height; y++) {
    const row = Math.min(h - 1, Math.floor((y * h) / height)) * w
    for (let x = 0; x < width; x++) {
      const cell = (row + Math.min(w - 1, Math.floor((x * w) / width))) * 4
      const i = (y * width + x) * 4
      sums[cell] += rgba[i]!
      sums[cell + 1] += rgba[i + 1]!
      sums[cell + 2] += rgba[i + 2]!
      sums[cell + 3]++
    }
  }
  const lum = new Float32Array(w * h)
  const skin = new Uint8Array(w * h)
  for (let c = 0; c < w * h; c++) {
    const n = sums[c * 4 + 3]! || 1
    const r = sums[c * 4]! / n
    const g = sums[c * 4 + 1]! / n
    const b = sums[c * 4 + 2]! / n
    lum[c] = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    skin[c] = isSkin(r, g, b) ? 1 : 0
  }
  return { w, h, lum, skin }
}

/**
 * 书脊折痕：正面从哪一列开始（采样图像素）；不是封套或找不到折痕返回 null。
 *
 * 每对相邻列 (x, x+1) 记「脊线连续度」：亮度差超过 FOLD_STEP、且是左右各两列里最大的行占多少。
 * 整高的直线每行都在同一列取到局部最大；颗粒、纹理、人物轮廓的最大值散在各列。
 * 窗口里最强的那条要够连续（FOLD_RIDGE），也要比全图中位数高出 FOLD_CONTRAST 倍（老照片满是颗粒）。
 */
function findFold(s: Sample, aspect: number): number | null {
  if (aspect < SLEEVE_ASPECT[0] || aspect >= SLEEVE_ASPECT[1]) return null
  const step = (x: number, y: number): number =>
    Math.abs(s.lum[y * s.w + x + 1]! - s.lum[y * s.w + x]!)
  const ridge = new Float32Array(s.w)
  for (let x = 2; x < s.w - 3; x++) {
    let hits = 0
    for (let y = 0; y < s.h; y++) {
      const v = step(x, y)
      if (v < FOLD_STEP) continue
      if (
        v >= step(x - 2, y) &&
        v >= step(x - 1, y) &&
        v >= step(x + 1, y) &&
        v >= step(x + 2, y)
      )
        hits++
    }
    ridge[x] = hits / s.h
  }
  const median = [...ridge].sort((a, b) => a - b)[s.w >> 1]!
  const lo = Math.max(2, Math.ceil(s.w - PANEL_ASPECT[1] * s.h) - 1)
  const hi = Math.min(s.w - 4, Math.floor(s.w - PANEL_ASPECT[0] * s.h) - 1)
  let best = 0
  for (let x = lo; x <= hi; x++) best = Math.max(best, ridge[x]!)
  if (best < FOLD_RIDGE || best < median * FOLD_CONTRAST) return null
  for (let x = hi; x >= lo; x--) if (ridge[x]! >= best * FOLD_RIVAL) return x + 1
  return null
}

/** 区域里最像「人」的肤色块的头部重心（采样图像素）；没有返回 null。 */
function findPerson(s: Sample, r: Region): { x: number; y: number } | null {
  const area = (r.x1 - r.x0) * (r.y1 - r.y0)
  const label = new Int32Array(s.w * s.h)
  let best: { score: number; pixels: number[] } | null = null
  let next = 0
  for (let y = r.y0; y < r.y1; y++)
    for (let x = r.x0; x < r.x1; x++) {
      const start = y * s.w + x
      if (!s.skin[start] || label[start]) continue
      // 四邻接洪泛，收集这一块的像素
      const pixels = [start]
      label[start] = ++next
      for (let k = 0; k < pixels.length; k++) {
        const p = pixels[k]!
        const px = p % s.w
        const py = (p - px) / s.w
        for (const [nx, ny] of [
          [px - 1, py],
          [px + 1, py],
          [px, py - 1],
          [px, py + 1],
        ] as const) {
          if (nx < r.x0 || nx >= r.x1 || ny < r.y0 || ny >= r.y1) continue
          const q = ny * s.w + nx
          if (s.skin[q] && !label[q]) {
            label[q] = next
            pixels.push(q)
          }
        }
      }
      const share = pixels.length / area
      if (share < BLOB_AREA[0] || share > BLOB_AREA[1]) continue
      const top = Math.floor(pixels[0]! / s.w)
      const score = pixels.length * (1.15 - (top - r.y0) / (r.y1 - r.y0))
      if (!best || score > best.score) best = { score, pixels }
    }
  return best ? headCentroid(s, best.pixels) : null
}

/** 块的头部：从块顶往下，高度取「顶部 20% 行里最宽那行」的 1.4 倍，求这一段的重心。 */
function headCentroid(s: Sample, pixels: number[]): { x: number; y: number } {
  const rows = new Map<number, number>()
  let top = Infinity
  let bottom = -Infinity
  for (const p of pixels) {
    const y = Math.floor(p / s.w)
    rows.set(y, (rows.get(y) ?? 0) + 1)
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
  }
  const band = Math.max(1, Math.round((bottom - top + 1) * 0.2))
  let width = 1
  for (let y = top; y < top + band; y++)
    width = Math.max(width, rows.get(y) ?? 0)
  const limit = top + Math.max(2, width * 1.4)
  let sx = 0
  let sy = 0
  let n = 0
  for (const p of pixels) {
    const x = p % s.w
    const y = (p - x) / s.w
    if (y > limit) continue
    sx += x + 0.5
    sy += y + 0.5
    n++
  }
  return { x: sx / n, y: sy / n }
}

/** 区域里边缘能量的重心（采样图像素）；画面平坦返回 null。 */
function edgeCentroid(s: Sample, r: Region): { x: number; y: number } | null {
  let total = 0
  let sum = 0
  let sx = 0
  let sy = 0
  let n = 0
  for (let y = Math.max(1, r.y0); y < Math.min(s.h - 1, r.y1); y++)
    for (let x = Math.max(1, r.x0); x < Math.min(s.w - 1, r.x1); x++) {
      const i = y * s.w + x
      const e =
        Math.abs(s.lum[i + 1]! - s.lum[i - 1]!) +
        Math.abs(s.lum[i + s.w]! - s.lum[i - s.w]!)
      total += e
      sum += e * e
      sx += e * e * (x + 0.5)
      sy += e * e * (y + 0.5)
      n++
    }
  if (!n || total / n < FLAT_EDGE) return null
  return { x: sx / sum, y: sy / sum }
}

const round = (value: number): number =>
  Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000

/** 计算一张图的焦点（宽高任意，RGBA 按行排列）。 */
export function analyzeFocus(
  rgba: Uint8Array,
  width: number,
  height: number
): MediaFocus {
  const s = sample(rgba, width, height)
  const fold = findFold(s, width / height)
  const region: Region = { x0: fold ?? 0, y0: 0, x1: s.w, y1: s.h }
  const box: MediaFocus['box'] =
    fold === null ? undefined : [round(region.x0 / s.w), 0, 1, 1]
  const at = (
    by: MediaFocus['by'],
    p: { x: number; y: number }
  ): MediaFocus => ({
    v: FOCUS_VERSION,
    x: round(p.x / s.w),
    y: round(p.y / s.h),
    by,
    ...(box ? { box } : {}),
  })
  const person = findPerson(s, region)
  if (person) return at('skin', person)
  const edges = edgeCentroid(s, region)
  if (edges) return at('edges', edges)
  return at('center', {
    x: (region.x0 + region.x1) / 2,
    y: (region.y0 + region.y1) / 2,
  })
}

/**
 * 焦点测试用的合成图：纯色底 + 肤色椭圆「脸」（可带躯干）、书脊折痕、无肤色的纹理块。
 * 坐标都是归一化的（0–1），方便断言焦点落在哪。
 */

/** RGBA 画布。 */
export interface Canvas {
  rgba: Uint8Array
  width: number
  height: number
}

/** 肤色（Kovac 规则判为皮肤）。 */
export const SKIN: RGB = [224, 172, 140]
/** 偏蓝的灰底（不是皮肤）。 */
export const BACKDROP: RGB = [70, 80, 105]

export type RGB = [number, number, number]

/** 一张纯色图。 */
export function canvas(
  width: number,
  height: number,
  color = BACKDROP
): Canvas {
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = color[0]
    rgba[i + 1] = color[1]
    rgba[i + 2] = color[2]
    rgba[i + 3] = 255
  }
  return { rgba, width, height }
}

function set(c: Canvas, x: number, y: number, color: RGB): void {
  if (x < 0 || y < 0 || x >= c.width || y >= c.height) return
  const i = (y * c.width + x) * 4
  c.rgba[i] = color[0]
  c.rgba[i + 1] = color[1]
  c.rgba[i + 2] = color[2]
}

/** 矩形（归一化坐标）。 */
export function rect(
  c: Canvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: RGB
): Canvas {
  for (let y = Math.round(y0 * c.height); y < Math.round(y1 * c.height); y++)
    for (let x = Math.round(x0 * c.width); x < Math.round(x1 * c.width); x++)
      set(c, x, y, color)
  return c
}

/** 椭圆脸：中心 (cx, cy)，半径 r 按图高算（横竖都是 r × 高，画出来是圆脸），带两只深色眼睛。 */
export function face(c: Canvas, cx: number, cy: number, r: number): Canvas {
  const radius = r * c.height
  const px = cx * c.width
  const py = cy * c.height
  for (let y = Math.floor(py - radius * 1.3); y <= py + radius * 1.3; y++)
    for (let x = Math.floor(px - radius); x <= px + radius; x++) {
      const dx = (x - px) / radius
      const dy = (y - py) / (radius * 1.3)
      if (dx * dx + dy * dy <= 1) set(c, x, y, SKIN)
    }
  for (const side of [-0.4, 0.4]) {
    const ex = Math.round(px + side * radius)
    const ey = Math.round(py - 0.2 * radius)
    const er = Math.max(1, Math.round(radius * 0.12))
    for (let y = ey - er; y <= ey + er; y++)
      for (let x = ex - er; x <= ex + er; x++) set(c, x, y, [30, 25, 25])
  }
  return c
}

/** 人：脸 + 脖子 + 躯干（躯干比脸宽、在脸下方）。 */
export function person(c: Canvas, cx: number, cy: number, r: number): Canvas {
  face(c, cx, cy, r)
  const w = (r * c.height) / c.width
  rect(c, cx - w * 0.35, cy + r * 1.2, cx + w * 0.35, cy + r * 1.8, SKIN)
  rect(
    c,
    cx - w * 1.6,
    cy + r * 1.8,
    cx + w * 1.6,
    Math.min(1, cy + r * 6),
    SKIN
  )
  return c
}

/** 一条整高的深色竖线（书脊折痕），x 是归一化的左缘，宽 px 像素。 */
export function fold(c: Canvas, x: number, px = 3): Canvas {
  const left = Math.round(x * c.width)
  for (let y = 0; y < c.height; y++)
    for (let dx = 0; dx < px; dx++) set(c, left + dx, y, [10, 10, 10])
  return c
}

/** 黑白棋盘纹理块（有边缘、没有肤色）。 */
export function checker(
  c: Canvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cell = 6
): Canvas {
  for (let y = Math.round(y0 * c.height); y < Math.round(y1 * c.height); y++)
    for (let x = Math.round(x0 * c.width); x < Math.round(x1 * c.width); x++) {
      const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0
      set(c, x, y, on ? [245, 245, 245] : [15, 15, 15])
    }
  return c
}

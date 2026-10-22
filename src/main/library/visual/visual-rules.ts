/**
 * 按画面搜的纯规则：条目参与索引的图片、图片签名、向量量化 / 存库格式与相似度。
 */
import { createHash } from 'node:crypto'
import type { ItemMetadata } from '../../../shared/library/ipc'
import { CLIP_DIM } from './clip-encoder'

/** 每部最多索引的剧照数（封面另算）。 */
export const MAX_STILLS = 24

/**
 * 条目参与索引的图片地址：封面（backdrop，番号库是整张横版封面）+ 剧照。
 * 派生图（#yingbox= 裁出来的海报）和竖版海报跳过：都是封面的一部分。
 */
export function indexImages(metadata: ItemMetadata | null): string[] {
  if (!metadata || metadata.level !== 'title') return []
  const pick = (role: string): string[] =>
    metadata.images
      .filter(img => img.role === role && img.path && !img.path.includes('#'))
      .map(img => img.path)
  const cover = pick('backdrop').slice(0, 1)
  const stills = [...new Set(pick('still'))]
    .filter(url => !cover.includes(url))
    .slice(0, MAX_STILLS)
  return [...cover, ...stills]
}

/** 图片列表的签名：列表变了就要重建索引。 */
export function imageSignature(model: string, urls: readonly string[]): string {
  return createHash('sha1')
    .update(model)
    .update('\n')
    .update(urls.join('\n'))
    .digest('hex')
}

/** 量化后的向量：int8 分量 × scale ≈ 原值。 */
export interface QuantizedVector {
  q: Int8Array
  scale: number
}

/**
 * float32 → int8，按本向量的最大分量缩放（最大分量映射到 ±127）。
 * 归一化的 512 维向量分量多在 ±0.05 附近，固定 ×127 会丢掉一半以上精度；按向量缩放后误差在千分之几。
 */
export function quantize(vec: Float32Array): QuantizedVector {
  let max = 0
  for (const x of vec) max = Math.max(max, Math.abs(x))
  const scale = max / 127 || 1
  const q = new Int8Array(CLIP_DIM)
  for (let i = 0; i < CLIP_DIM; i++) q[i] = Math.round(vec[i]! / scale)
  return { q, scale }
}

/** 存库格式：4 字节 float32（小端）scale + 512 字节 int8。 */
export function packVector(v: QuantizedVector): Uint8Array {
  const out = new Uint8Array(4 + CLIP_DIM)
  new DataView(out.buffer).setFloat32(0, v.scale, true)
  out.set(new Uint8Array(v.q.buffer, v.q.byteOffset, CLIP_DIM), 4)
  return out
}

/** packVector 的逆：写进 matrix 第 row 行，返回 scale。 */
export function unpackVector(
  blob: Uint8Array,
  matrix: Int8Array,
  row: number
): number {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
  matrix.set(
    new Int8Array(blob.buffer, blob.byteOffset + 4, CLIP_DIM),
    row * CLIP_DIM
  )
  return view.getFloat32(0, true)
}

/** matrix 第 row 行（int8，缩放系数 scale）与查询向量的余弦相似度（查询已归一化）。 */
export function similarity(
  matrix: Int8Array,
  row: number,
  scale: number,
  query: Float32Array
): number {
  let sum = 0
  const base = row * CLIP_DIM
  for (let i = 0; i < CLIP_DIM; i++) sum += matrix[base + i]! * query[i]!
  return sum * scale
}

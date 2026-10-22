/**
 * 按画面搜的纯规则：条目参与索引的图片、图片签名、向量量化与相似度。
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
  const urls = [
    ...pick('backdrop').slice(0, 1),
    ...pick('still').slice(0, MAX_STILLS),
  ]
  return [...new Set(urls)]
}

/** 图片列表的签名：列表变了就要重建索引。 */
export function imageSignature(model: string, urls: readonly string[]): string {
  return createHash('sha1')
    .update(model)
    .update('\n')
    .update(urls.join('\n'))
    .digest('hex')
}

/** 归一化向量 → int8（×127 四舍五入）。 */
export function quantize(vec: Float32Array): Int8Array {
  const out = new Int8Array(CLIP_DIM)
  for (let i = 0; i < CLIP_DIM; i++) {
    out[i] = Math.max(-127, Math.min(127, Math.round(vec[i]! * 127)))
  }
  return out
}

/** int8 向量（matrix 第 row 行）与查询向量的余弦相似度（查询已归一化）。 */
export function similarity(
  matrix: Int8Array,
  row: number,
  query: Float32Array
): number {
  let sum = 0
  const base = row * CLIP_DIM
  for (let i = 0; i < CLIP_DIM; i++) sum += matrix[base + i]! * query[i]!
  return sum / 127
}

/**
 * 派生图片：由另一张远程图片加工出来的图（目前只有「从横版封面裁出竖版海报」）。
 *
 * 派生图用「源地址 + #yingbox=<操作>」表示：
 * - 片段不会发给服务器，下载仍取源图；
 * - 整串参与 imageKey，和源图各占一个缓存文件，互不覆盖；
 * - 元数据、写出层照常把它当一张图处理，ImageCache 下载后按操作加工再落盘。
 *
 * 有码番号的封面几乎都是 DMM 的 pl.jpg 版式：左半是背面、右半是正面（即海报），
 * 站点给的竖版海报（ps.jpg）只有 147×200 左右，放到海报墙上发糊；从 800 宽的封面裁右侧更清晰。
 */
import type { Codec } from '../../thumbnails/codec-client'
import type { RgbaImage } from '../../thumbnails/image-codec'

/** 派生操作。 */
export type DerivedOp = 'poster-right'

/** 把下载到的源图加工成派生图。 */
export type DeriveImage = (
  op: DerivedOp,
  bytes: Uint8Array
) => Promise<Uint8Array>

const MARK = '#yingbox='

/** DMM 竖版海报的宽高比（ps.jpg 379×538 与 pl.jpg 右侧正面一致）。 */
export const POSTER_ASPECT = 379 / 538
/** 宽高比超过它才算横版封面；本来就接近竖版的图不裁。 */
const LANDSCAPE_ASPECT = 1.2

/** 从封面裁出海报的派生地址。 */
export function posterFromCover(cover: string): string {
  return `${sourceOf(cover)}${MARK}poster-right`
}

/** 拆出派生操作；普通地址 op 为 undefined。 */
export function parseDerived(url: string): { source: string; op?: DerivedOp } {
  const at = url.indexOf(MARK)
  if (at < 0) return { source: url }
  const op = url.slice(at + MARK.length)
  return op === 'poster-right'
    ? { source: url.slice(0, at), op }
    : { source: url.slice(0, at) }
}

/** 去掉派生标记后的源地址（写进 NFO 等给外部程序看的地方用）。 */
export function sourceOf(url: string): string {
  return parseDerived(url).source
}

/**
 * 横版封面裁右侧一块作竖版海报：高度不变，宽度按 POSTER_ASPECT；不是横版时原样返回。
 * 只拷贝像素行，不缩放。
 */
export function cropPosterRight(image: RgbaImage): RgbaImage {
  const { width, height, rgba } = image
  if (width / height < LANDSCAPE_ASPECT) return image
  const cropWidth = Math.min(
    width,
    Math.max(1, Math.round(height * POSTER_ASPECT))
  )
  const left = width - cropWidth
  const out = new Uint8Array(cropWidth * height * 4)
  const rowBytes = cropWidth * 4
  for (let y = 0; y < height; y++) {
    const from = (y * width + left) * 4
    out.set(rgba.subarray(from, from + rowBytes), y * rowBytes)
  }
  return { rgba: out, width: cropWidth, height }
}

/** 派生海报的 JPEG 质量：只编一次、长期留存，比缩略图高一档。 */
const POSTER_QUALITY = 92

/** 用编解码线程实现 ImageCache 的 derive（源图缓冲区转移给线程）。 */
export function codecDeriver(codec: Codec): DeriveImage {
  return async (_op, bytes) => {
    const own =
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes
        : bytes.slice()
    const result = await codec(
      { op: 'poster', bytes: own, quality: POSTER_QUALITY },
      [own.buffer as ArrayBuffer]
    )
    return result.data
  }
}

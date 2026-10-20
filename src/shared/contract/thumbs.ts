import { MAX_THUMB_BYTES, THUMB_WIDTHS, type ThumbWidth } from '../thumbs'
import { ContractError, call, defineDomain, oneOf, str } from './define'

/** 二进制参数（IPC 结构化克隆后是 Uint8Array） */
function bytes(value: unknown, name: string): Uint8Array {
  if (value instanceof Uint8Array && value.byteLength <= MAX_THUMB_BYTES)
    return value
  throw new ContractError(`参数 ${name} 应为不超过 2MB 的 Uint8Array`)
}

/** 缩略图磁盘缓存：渲染层 Worker 生成的 WebP 由主进程落盘（读走 thumb:// 协议）。 */
export const thumbs = defineDomain('thumbs', {
  /** 存一张缩略图；不是 WebP 或来源不支持时返回 false */
  put: call<[source: string, width: ThumbWidth, data: Uint8Array], boolean>(
    a => [
      str(a[0], 'source'),
      oneOf(a[1], 'width', THUMB_WIDTHS),
      bytes(a[2], 'data'),
    ]
  ),
})

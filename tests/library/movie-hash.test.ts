import { describe, expect, it } from 'vitest'
import {
  type ByteSource,
  computeMovieHash,
} from '../../src/shared/library/identify'

/** 内存字节源：第 i 个字节为 (i*31+7) & 0xff。 */
function source(size: number): ByteSource {
  const bytes = Uint8Array.from({ length: size }, (_, i) => (i * 31 + 7) & 0xff)
  return {
    size,
    read: async (offset, length) => bytes.subarray(offset, offset + length),
  }
}

describe('computeMovieHash', () => {
  // 期望值由 OpenSubtitles 官方 Python 参考实现（struct.unpack('<Q') 累加）独立算出
  it.each([
    [200_000, '5f9fe02060a3cd40'],
    [150_003, '003f7fc00042a9f3'],
  ])('大小 %i 字节 → %s', async (size, expected) => {
    expect(await computeMovieHash(source(size))).toBe(expected)
  })

  it('只读取头尾各 64 KiB', async () => {
    const reads: [number, number][] = []
    const src = source(1_000_000)
    await computeMovieHash({
      size: src.size,
      read: (offset, length) => {
        reads.push([offset, length])
        return src.read(offset, length)
      },
    })
    expect(reads).toEqual([
      [0, 65536],
      [1_000_000 - 65536, 65536],
    ])
  })
})

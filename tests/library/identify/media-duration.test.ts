import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  probeDuration,
  probeFileDuration,
} from '../../../src/main/library/identify/media-duration'

const FIXTURES = join(__dirname, '../../fixtures/media-duration')

/** 按需生成的稀疏字节来源：只有给定的几段有内容，其余为 0，记录读取次数。 */
function sparse(
  size: number,
  parts: Array<[number, Uint8Array]>
): {
  reads: number
  source: { size: number; read(o: number, l: number): Promise<Uint8Array> }
} {
  let reads = 0
  return {
    get reads() {
      return reads
    },
    source: {
      size,
      read: async (offset: number, length: number) => {
        reads++
        const out = new Uint8Array(Math.max(0, Math.min(length, size - offset)))
        for (const [at, bytes] of parts) {
          for (let i = 0; i < bytes.length; i++) {
            const p = at + i - offset
            if (p >= 0 && p < out.length) out[p] = bytes[i]
          }
        }
        return out
      },
    },
  }
}

const u32 = (n: number): number[] => [
  n >>> 24,
  (n >>> 16) & 255,
  (n >>> 8) & 255,
  n & 255,
]
const box = (type: string, body: number[]): number[] => [
  ...u32(8 + body.length),
  ...[...type].map(c => c.charCodeAt(0)),
  ...body,
]

describe('probeDuration', () => {
  it('ffmpeg 生成的 mkv / mp4（moov 在头、在尾）与 ffprobe 一致', async () => {
    for (const name of [
      'tiny.mkv',
      'tiny-faststart.mp4',
      'tiny-moov-end.mp4',
    ]) {
      expect(await probeFileDuration(join(FIXTURES, name)), name).toBeCloseTo(
        3.5,
        1
      )
    }
  })

  it('moov 在 8 GB mdat 之后：按 box 头跳读，只读几次', async () => {
    const ftyp = box(
      'ftyp',
      [...'isom'].map(c => c.charCodeAt(0)).concat(0, 0, 2, 0)
    )
    const mdatSize = 8 * 1024 ** 3
    // 64 位大小的 mdat 头
    const mdat = [
      0,
      0,
      0,
      1,
      ...[...'mdat'].map(c => c.charCodeAt(0)),
      0,
      0,
      0,
      2,
      0,
      0,
      0,
      0,
    ]
    // mvhd v0：timescale 1000，duration 7_200_000（2 小时）
    const mvhd = box('mvhd', [
      0,
      0,
      0,
      0,
      ...u32(0),
      ...u32(0),
      ...u32(1000),
      ...u32(7_200_000),
      ...Array(80).fill(0),
    ])
    const moov = box('moov', mvhd)
    const moovAt = ftyp.length + mdatSize
    const src = sparse(moovAt + moov.length, [
      [0, Uint8Array.from(ftyp)],
      [ftyp.length, Uint8Array.from(mdat)],
      [moovAt, Uint8Array.from(moov)],
    ])
    expect(await probeDuration(src.source)).toBe(7200)
    expect(src.reads).toBeLessThanOrEqual(6)
  })

  it('不认识的容器、截断的文件返回 undefined', async () => {
    expect(
      await probeDuration(
        sparse(1000, [[0, Uint8Array.from([1, 2, 3, 4])]]).source
      )
    ).toBeUndefined()
    expect(await probeDuration(sparse(10, []).source)).toBeUndefined()
    expect(
      await probeFileDuration(join(FIXTURES, 'missing.mkv'))
    ).toBeUndefined()
  })
})

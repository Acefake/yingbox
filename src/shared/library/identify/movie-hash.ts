/**
 * OpenSubtitles moviehash：文件大小 + 头尾各 64 KiB 按 64 位小端整数累加，取低 64 位。
 *
 * 读取通过 ByteSource 抽象，这里不依赖 node:fs，主进程用 FileHandle 适配即可。
 */

/** 可随机读取的字节来源。 */
export interface ByteSource {
  /** 总字节数。 */
  readonly size: number
  /** 从 offset 读 length 字节；不足时返回实际读到的字节。 */
  read(offset: number, length: number): Promise<Uint8Array>
}

/** 头尾各读取的字节数。 */
const MOVIE_HASH_CHUNK = 64 * 1024
const MASK_64 = (1n << 64n) - 1n

/** 把一段字节按 8 字节小端整数累加（不足 8 字节的尾部补零）。 */
function sumChunk(bytes: Uint8Array, initial: bigint): bigint {
  let sum = initial
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const whole = bytes.byteLength - (bytes.byteLength % 8)
  for (let i = 0; i < whole; i += 8) {
    sum = (sum + view.getBigUint64(i, true)) & MASK_64
  }
  if (whole < bytes.byteLength) {
    const tail = new Uint8Array(8)
    tail.set(bytes.subarray(whole))
    sum = (sum + new DataView(tail.buffer).getBigUint64(0, true)) & MASK_64
  }
  return sum
}

/**
 * 计算 OpenSubtitles moviehash，返回 16 位小写十六进制。
 * 小于 64 KiB 的文件头尾两段重叠，按参考实现原样累加。
 */
export async function computeMovieHash(source: ByteSource): Promise<string> {
  const size = source.size
  const chunk = Math.min(MOVIE_HASH_CHUNK, size)
  const head = await source.read(0, chunk)
  const tail = await source.read(Math.max(0, size - chunk), chunk)
  let hash = BigInt(size) & MASK_64
  hash = sumChunk(head, hash)
  hash = sumChunk(tail, hash)
  return hash.toString(16).padStart(16, '0')
}

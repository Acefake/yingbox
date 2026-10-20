/**
 * 视频时长探测：只读容器头，不调 ffprobe / mpv，单个文件通常 2–4 次小读取。
 *
 * 支持 Matroska（mkv / webm，Segment → Info → Duration × TimecodeScale）与
 * ISO BMFF（mp4 / m4v / mov，moov → mvhd 的 duration / timescale；moov 在文件尾也能找到）。
 * 其他容器或结构异常时返回 undefined，打分时不计时长这一项。
 */
import { open } from 'node:fs/promises'
import type { ByteSource } from '../../../shared/library/identify'

/** 单次读取的块大小。 */
const CHUNK = 64 * 1024
/** 最多遍历的元素 / box 数，防止畸形文件死循环。 */
const MAX_STEPS = 256

// —————————————————————————— Matroska ——————————————————————————

const EBML_HEADER = 0x1a45dfa3
const SEGMENT = 0x18538067
const INFO = 0x1549a966
const TIMECODE_SCALE = 0x2ad7b1
const DURATION = 0x4489
const CLUSTER = 0x1f43b675

/** 读 EBML 变长整数。id 保留标记位，size 去掉标记位；全 1 表示未知长度。 */
function readVint(
  buf: Uint8Array,
  pos: number,
  keepMarker: boolean
): { value: number; length: number; unknown: boolean } | undefined {
  const first = buf[pos]
  if (first === undefined || first === 0) return undefined
  let length = 1
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++
  if (length > 8 || pos + length > buf.length) return undefined
  let value = keepMarker ? first : first & (0xff >> length)
  let allOnes = value === 0xff >> length
  for (let i = 1; i < length; i++) {
    value = value * 256 + buf[pos + i]
    if (buf[pos + i] !== 0xff) allOnes = false
  }
  return { value, length, unknown: !keepMarker && allOnes }
}

function readUint(buf: Uint8Array, pos: number, size: number): number {
  let v = 0
  for (let i = 0; i < size; i++) v = v * 256 + buf[pos + i]
  return v
}

function readFloat(
  buf: Uint8Array,
  pos: number,
  size: number
): number | undefined {
  const view = new DataView(buf.buffer, buf.byteOffset + pos, size)
  if (size === 4) return view.getFloat32(0)
  if (size === 8) return view.getFloat64(0)
  return undefined
}

/** 在 Info 元素体内取时长（秒）。 */
function parseInfo(body: Uint8Array): number | undefined {
  let pos = 0
  let scale = 1_000_000
  let duration: number | undefined
  while (pos < body.length) {
    const id = readVint(body, pos, true)
    if (!id) break
    const size = readVint(body, pos + id.length, false)
    if (!size || size.unknown) break
    const start = pos + id.length + size.length
    if (start + size.value > body.length) break
    if (id.value === TIMECODE_SCALE) scale = readUint(body, start, size.value)
    if (id.value === DURATION) duration = readFloat(body, start, size.value)
    pos = start + size.value
  }
  return duration !== undefined && duration > 0
    ? (duration * scale) / 1e9
    : undefined
}

async function matroskaDuration(src: ByteSource): Promise<number | undefined> {
  let offset = 0
  let segmentEnd = src.size
  for (let step = 0; step < MAX_STEPS && offset < segmentEnd; step++) {
    const head = await src.read(offset, 16)
    const id = readVint(head, 0, true)
    if (!id) return undefined
    const size = readVint(head, id.length, false)
    if (!size) return undefined
    const bodyStart = offset + id.length + size.length
    if (id.value === SEGMENT) {
      // 进入 Segment 内部逐个看子元素
      if (!size.unknown) segmentEnd = Math.min(src.size, bodyStart + size.value)
      offset = bodyStart
      continue
    }
    if (id.value === INFO) {
      if (size.unknown || size.value > 1024 * 1024) return undefined
      return parseInfo(await src.read(bodyStart, size.value))
    }
    if (id.value === CLUSTER || size.unknown) return undefined
    if (step === 0 && id.value !== EBML_HEADER) return undefined
    offset = bodyStart + size.value
  }
  return undefined
}

// —————————————————————————— ISO BMFF ——————————————————————————

const fourcc = (buf: Uint8Array, pos: number): string =>
  String.fromCharCode(buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3])

/** box 头：类型、头长、总长（0 表示到文件尾）。 */
function boxHeader(
  head: Uint8Array,
  remaining: number
): { type: string; headerSize: number; size: number } | undefined {
  if (head.length < 8) return undefined
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
  let size = view.getUint32(0)
  const type = fourcc(head, 4)
  let headerSize = 8
  if (size === 1) {
    if (head.length < 16) return undefined
    size = Number(view.getBigUint64(8))
    headerSize = 16
  } else if (size === 0) {
    size = remaining
  }
  if (size < headerSize) return undefined
  return { type, headerSize, size }
}

/** mvhd 体 → 秒。 */
function parseMvhd(body: Uint8Array): number | undefined {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
  const version = body[0]
  const timescale = version === 1 ? view.getUint32(20) : view.getUint32(12)
  const duration =
    version === 1 ? Number(view.getBigUint64(24)) : view.getUint32(16)
  return timescale > 0 && duration > 0 ? duration / timescale : undefined
}

async function bmffDuration(src: ByteSource): Promise<number | undefined> {
  let offset = 0
  let end = src.size
  for (let step = 0; step < MAX_STEPS && offset + 8 <= end; step++) {
    const box = boxHeader(await src.read(offset, 16), end - offset)
    if (!box) return undefined
    if (box.type === 'moov') {
      // 进入 moov，找 mvhd（通常是第一个子 box）
      end = Math.min(end, offset + box.size)
      offset += box.headerSize
      continue
    }
    if (box.type === 'mvhd') {
      const body = await src.read(offset + box.headerSize, 32)
      return body.length >= 32 ? parseMvhd(body) : undefined
    }
    offset += box.size
  }
  return undefined
}

// —————————————————————————— 入口 ——————————————————————————

/** 从字节来源探测时长（秒）。 */
export async function probeDuration(
  src: ByteSource
): Promise<number | undefined> {
  if (src.size < 16) return undefined
  const head = await src.read(0, 12)
  if (readUint(head, 0, 4) === EBML_HEADER) return matroskaDuration(src)
  if (fourcc(head, 4) === 'ftyp') return bmffDuration(src)
  return undefined
}

/** 探测文件时长（秒）；读不到或格式不支持返回 undefined。 */
export async function probeFileDuration(
  path: string
): Promise<number | undefined> {
  let handle
  try {
    handle = await open(path, 'r')
    const { size } = await handle.stat()
    const fh = handle
    // 小块读取做一层缓存：EBML / box 头常在同一个 64 KiB 块里
    let cacheStart = -1
    let cache = new Uint8Array(0)
    const read = async (
      offset: number,
      length: number
    ): Promise<Uint8Array> => {
      if (
        cacheStart >= 0 &&
        offset >= cacheStart &&
        offset + length <= cacheStart + cache.length
      ) {
        return cache.subarray(offset - cacheStart, offset - cacheStart + length)
      }
      const want = Math.max(length, CHUNK)
      const buffer = new Uint8Array(Math.min(want, Math.max(0, size - offset)))
      const { bytesRead } = await fh.read(buffer, 0, buffer.length, offset)
      cacheStart = offset
      cache = buffer.subarray(0, bytesRead)
      return cache.subarray(0, Math.min(length, bytesRead))
    }
    return await probeDuration({ size, read })
  } catch {
    return undefined
  } finally {
    await handle?.close()
  }
}

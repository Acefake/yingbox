/**
 * 下载断点续传的磁盘约定：未完成的数据写在 `<成品>.partial`，旁边放一份进度记录。
 *
 * - HLS：`<partial>.segs`。首行是清单指纹（JSON），之后每写完一个单元（初始化段或分片）
 *   追加一行「序号 字节数 sha1」。续传时逐个单元重读 .partial 校验哈希，截断到最后一个
 *   校验通过的单元，从下一个单元接着下。清单换了（指纹不同）就从头下。
 * - 直链：`<partial>.json`，记下地址指纹与服务器给的校验值（ETag / Last-Modified / 总长），
 *   续传时据此发 Range + If-Range，见 direct.ts。
 *
 * 数据先写、记录后写：进程崩溃时记录永远不会领先于数据；断电等导致数据没落盘时，
 * 哈希校验会把那部分丢掉重下。
 */
import { createHash } from 'node:crypto'
import {
  type FileHandle,
  open,
  readFile,
  readdir,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'

/** 进度记录文件后缀（HLS 分片清单 / 直链校验信息）。 */
export const SEGMENT_LOG_SUFFIX = '.segs'
export const DIRECT_META_SUFFIX = '.json'

/** 地址去掉查询串：签名参数每次解析都会变，内容不变。 */
export const urlIdentity = (url: string): string => {
  const u = new URL(url)
  return `${u.origin}${u.pathname}`
}

const sha1 = (data: Uint8Array): string =>
  createHash('sha1').update(data).digest('hex')

/** 清单指纹：所有单元（初始化段 + 分片）地址的身份串，顺序敏感。 */
export const playlistFingerprint = (uris: readonly string[]): string =>
  sha1(Buffer.from(uris.map(urlIdentity).join('\n')))

/** 以 r+ 打开（保留已有内容），不存在时新建。 */
export async function openForResume(path: string): Promise<FileHandle> {
  try {
    return await open(path, 'r+')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return open(path, 'w')
  }
}

interface LogEntry {
  index: number
  size: number
  hash: string
}

const parseLog = (text: string, fingerprint: string): LogEntry[] => {
  const [head, ...lines] = text.split('\n')
  try {
    if ((JSON.parse(head) as { fp?: string }).fp !== fingerprint) return []
  } catch {
    return []
  }
  const entries: LogEntry[] = []
  for (const line of lines) {
    const m = line.match(/^(\d+) (\d+) ([0-9a-f]{40})$/)
    // 半行（写到一半崩溃）及之后的全部作废；位置对不对由 verifiedPrefix 按哈希判断
    if (!m) break
    entries.push({ index: Number(m[1]), size: Number(m[2]), hash: m[3] })
  }
  return entries
}

/** 逐个单元重读 .partial 校验，返回校验通过的前缀。 */
async function verifiedPrefix(
  partial: string,
  entries: LogEntry[]
): Promise<{ units: number; bytes: number }> {
  if (!entries.length) return { units: 0, bytes: 0 }
  let handle: FileHandle
  try {
    handle = await open(partial, 'r')
  } catch {
    return { units: 0, bytes: 0 }
  }
  let bytes = 0
  let units = 0
  try {
    for (const entry of entries) {
      const buf = Buffer.alloc(entry.size)
      const { bytesRead } = await handle.read(buf, 0, entry.size, bytes)
      if (bytesRead !== entry.size || sha1(buf) !== entry.hash) break
      bytes += entry.size
      units++
    }
  } finally {
    await handle.close()
  }
  return { units, bytes }
}

/** 一次可续传的 HLS 写入：数据文件 + 进度记录。 */
export interface SegmentWriter {
  /** 已校验、可跳过的单元数 */
  readonly start: number
  /** 已校验的字节数（= 下一个单元的写入位置） */
  readonly bytes: number
  /** 按序写入第 index 个单元并记账 */
  write(index: number, data: Uint8Array): Promise<void>
  close(): Promise<void>
}

/**
 * 打开（或续上）一个 HLS .partial：校验已下单元、截断尾部残片、重写进度记录。
 * 指纹不同或没有记录时从 0 开始。
 */
export async function openSegmentWriter(
  partial: string,
  fingerprint: string
): Promise<SegmentWriter> {
  const logFile = partial + SEGMENT_LOG_SUFFIX
  const text = await readFile(logFile, 'utf-8').catch(() => '')
  const entries = parseLog(text, fingerprint)
  const { units, bytes } = await verifiedPrefix(partial, entries)
  const data = await openForResume(partial)
  let log: FileHandle | undefined
  try {
    await data.truncate(bytes)
    const kept = entries
      .slice(0, units)
      .map(e => `${e.index} ${e.size} ${e.hash}\n`)
      .join('')
    await writeFile(
      logFile,
      `${JSON.stringify({ v: 1, fp: fingerprint })}\n${kept}`
    )
    log = await open(logFile, 'a')
  } catch (error) {
    await data.close().catch(() => {})
    throw error
  }
  const logHandle = log
  let position = bytes
  let expected = units
  return {
    start: units,
    bytes,
    async write(index, chunk) {
      if (index !== expected) throw new Error(`分片写入乱序：${index}`)
      await data.write(chunk, 0, chunk.byteLength, position)
      position += chunk.byteLength
      expected++
      await logHandle.write(`${index} ${chunk.byteLength} ${sha1(chunk)}\n`)
    },
    async close() {
      await Promise.allSettled([data.close(), logHandle.close()])
    },
  }
}

/** 续传用的临时文件：.partial 及其进度记录。 */
export const isResumeTemp = (name: string): boolean =>
  /\.partial(?:\.segs|\.json)?$/.test(name)

/**
 * 丢弃某个番号目录里的续传临时文件（任务被移除时）；目录因此变空就一并删掉。
 * 成品文件不动。
 */
export async function discardResumeTemps(dir: string): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[])
  await Promise.all(
    names.filter(isResumeTemp).map(n => rm(join(dir, n), { force: true }))
  )
  await rmdir(dir).catch(() => {}) // 非空（有成品）或不存在时保留
}

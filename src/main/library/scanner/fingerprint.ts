/**
 * 文件指纹：OpenSubtitles moviehash（文件大小 + 头尾各 64 KiB），复用 P1 的纯函数实现。
 * 用于移动识别，P3 也拿它向 OpenSubtitles 查片。
 */
import { open } from 'node:fs/promises'
import { parse } from 'node:path'
import { computeMovieHash } from '../../../shared/library/identify'

/**
 * 单个文件的读取时限：挂载的网盘（CloudDrive2 之类）上读头尾常要几秒，卡住时系统调用可能一直不返回，
 * 没有时限的话这条后台任务会永远占着队列的一个并发位置，后面的任务全在排队。
 */
export const FINGERPRINT_TIMEOUT_MS = 15_000

/** 给一个 Promise 加时限：到点还没结果就当失败（undefined），底层调用留给系统自己收尾。 */
export function withTimeout<T>(
  task: Promise<T>,
  ms: number
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>(resolve => {
    timer = setTimeout(() => resolve(undefined), ms)
  })
  return Promise.race([task, timeout]).finally(() => clearTimeout(timer))
}

async function hashOf(path: string): Promise<string | undefined> {
  let handle
  try {
    handle = await open(path, 'r')
    const { size } = await handle.stat()
    const fh = handle
    return await computeMovieHash({
      size,
      read: async (offset, length) => {
        const buffer = new Uint8Array(length)
        const { bytesRead } = await fh.read(buffer, 0, length, offset)
        return buffer.subarray(0, bytesRead)
      },
    })
  } catch {
    return undefined
  } finally {
    await handle?.close().catch(() => {})
  }
}

/**
 * 每个盘同时放任不管的卡住读取上限：超时只是不再等，底层读取还挂着（占系统线程池，网盘上还是一条没收尾的下载），
 * 不设上限的话每过一个时限就多叠一批。线程池默认 4 条；检查在发起读取时、计数在超时后，
 * 最坏会超出 FINGERPRINT_CONCURRENCY - 1 条，所以上限取 2，最坏 4 条。
 */
export const MAX_STALLED_READS = 2

type HashOf = (path: string) => Promise<string | undefined>

/**
 * 给读指纹的函数包上时限和背压：某个盘上卡住的读取没收尾前攒够 MAX_STALLED_READS 条，
 * 该盘新来的直接按失败处理；别的盘不受影响。
 */
export function createFingerprinter(
  hash: HashOf,
  maxStalled = MAX_STALLED_READS
): (path: string, timeoutMs?: number) => Promise<string | undefined> {
  const stalledByDrive = new Map<string, number>()
  const bump = (drive: string, delta: number): void => {
    stalledByDrive.set(drive, (stalledByDrive.get(drive) ?? 0) + delta)
  }
  return async (path, timeoutMs = FINGERPRINT_TIMEOUT_MS) => {
    const drive = parse(path).root.toLowerCase()
    if ((stalledByDrive.get(drive) ?? 0) >= maxStalled) return undefined
    const read = hash(path)
    const settled = await withTimeout(
      read.then(value => ({ value })),
      timeoutMs
    )
    if (settled) return settled.value
    bump(drive, 1)
    const release = (): void => bump(drive, -1)
    read.then(release, release)
    return undefined
  }
}

/** 计算文件指纹；文件读不到、读超时、卡住的读取太多时返回 undefined。 */
export const fingerprintFile = createFingerprinter(hashOf)

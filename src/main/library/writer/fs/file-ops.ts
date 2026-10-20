/**
 * 写出层的文件操作：原子写（临时文件 + rename）、内容未变跳过、移动（跨盘时 复制 → 校验 → 删除）。
 *
 * 临时文件名以点开头（`.名字.yb-<随机>.tmp`），扫描器忽略点开头的文件，写到一半被扫描也不会入库；
 * 临时文件与目标同目录，rename 在同一文件系统内是原子的，播放器 / 扫描器只会看到旧文件或完整的新文件。
 */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  utimes,
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** SHA-1 十六进制。 */
export function sha1(data: Uint8Array | string): string {
  return createHash('sha1').update(data).digest('hex')
}

/** 同目录下的临时文件名。 */
export function tempPathFor(target: string, suffix = 'tmp'): string {
  return join(
    dirname(target),
    `.${basename(target)}.yb-${randomUUID().slice(0, 8)}.${suffix}`
  )
}

const isCode = (error: unknown, ...codes: string[]): boolean =>
  codes.includes((error as NodeJS.ErrnoException)?.code ?? '')

/** 读文件；不存在返回 null。 */
export async function readIfExists(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path)
  } catch (error) {
    if (isCode(error, 'ENOENT', 'ENOTDIR')) return null
    throw error
  }
}

/** 写完后的文件状态。 */
export interface WrittenStat {
  size: number
  mtime: number
}

/** 原子写：写临时文件、落盘、rename 覆盖目标。目录不存在时创建。 */
export async function writeAtomic(
  target: string,
  data: Uint8Array | string
): Promise<WrittenStat> {
  await mkdir(dirname(target), { recursive: true })
  const temp = tempPathFor(target)
  try {
    const handle = await open(temp, 'w')
    try {
      await handle.writeFile(data)
      await handle.datasync()
    } finally {
      await handle.close()
    }
    await rename(temp, target)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
  const s = await stat(target)
  return { size: s.size, mtime: s.mtimeMs }
}

/** writeIfChanged 的结果。 */
export interface WriteResult extends WrittenStat {
  /** false 表示磁盘内容与要写的完全相同，没有写。 */
  changed: boolean
  hash: string
}

/**
 * 内容不同才写：读出已有文件比对 SHA-1，相同就跳过（不改 mtime，不触发扫描与播放器刷新）。
 * existing 可由调用方传入（合并 NFO 时已经读过）。
 */
export async function writeIfChanged(
  target: string,
  data: Uint8Array | string,
  existing?: Buffer | null
): Promise<WriteResult> {
  const hash = sha1(data)
  const current = existing === undefined ? await readIfExists(target) : existing
  if (current && sha1(current) === hash) {
    const s = await stat(target)
    return { changed: false, hash, size: s.size, mtime: s.mtimeMs }
  }
  return { changed: true, hash, ...(await writeAtomic(target, data)) }
}

// —————————————————————————— 移动 ——————————————————————————

/** 可注入的底层操作（测试用来模拟跨盘）。 */
export interface MoveOps {
  rename(from: string, to: string): Promise<void>
}

const defaultOps: MoveOps = { rename }

/** 流式复制并计算源文件 SHA-1。 */
async function copyWithHash(from: string, to: string): Promise<string> {
  const hash = createHash('sha1')
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk)
      done(null, chunk)
    },
  })
  await pipeline(
    createReadStream(from),
    tap,
    createWriteStream(to, { flags: 'wx' })
  )
  return hash.digest('hex')
}

/** 流式计算文件 SHA-1。 */
async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha1')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/** 跨盘移动单个文件：复制到目标目录的临时文件 → 校验哈希 → 保留时间戳 → rename → 删除源。 */
async function copyVerifyDelete(from: string, to: string): Promise<void> {
  const source = await stat(from)
  const temp = tempPathFor(to, 'part')
  try {
    const expected = await copyWithHash(from, temp)
    if ((await hashFile(temp)) !== expected) {
      throw new Error('复制后校验失败（内容不一致）')
    }
    await utimes(temp, source.atime, source.mtime)
    await rename(temp, to)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
  await rm(from)
}

/** 跨盘移动目录：递归复制 → 逐个比对大小 → 删除源。 */
async function copyDirectory(from: string, to: string): Promise<void> {
  const temp = tempPathFor(to, 'part')
  try {
    await cp(from, temp, {
      recursive: true,
      preserveTimestamps: true,
      errorOnExist: true,
    })
    await rename(temp, to)
  } catch (error) {
    await rm(temp, { recursive: true, force: true }).catch(() => {})
    throw error
  }
  await rm(from, { recursive: true })
}

/** 两个路径是否指向同一个文件（大小写不敏感的文件系统上只改大小写时为 true）。 */
async function sameFile(a: string, b: string): Promise<boolean> {
  try {
    const [x, y] = await Promise.all([lstat(a), lstat(b)])
    return x.dev === y.dev && x.ino === y.ino
  } catch {
    return false
  }
}

/** 路径是否存在（不跟随符号链接）。 */
export async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isCode(error, 'ENOENT', 'ENOTDIR')) return false
    throw error
  }
}

/**
 * 移动文件或目录。目标已存在（且不是同一个文件）时拒绝，绝不覆盖；
 * 同盘 rename，跨盘（EXDEV）走 复制 → 校验 → 删除。返回是否跨盘。
 */
export async function movePath(
  from: string,
  to: string,
  ops: MoveOps = defaultOps
): Promise<{ crossDevice: boolean }> {
  if ((await exists(to)) && !(await sameFile(from, to))) {
    throw new Error('目标已存在')
  }
  await mkdir(dirname(to), { recursive: true })
  try {
    await ops.rename(from, to)
    return { crossDevice: false }
  } catch (error) {
    if (!isCode(error, 'EXDEV')) throw error
  }
  const s = await lstat(from)
  if (s.isDirectory()) await copyDirectory(from, to)
  else await copyVerifyDelete(from, to)
  return { crossDevice: true }
}

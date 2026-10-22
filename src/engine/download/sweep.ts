/**
 * 清扫孤儿续传临时文件。
 *
 * 失败 / 取消的任务会留下 .partial 供续传（见 resume.ts），移除任务时才删。但有些临时文件
 * 再也等不到移除：老版本移除时没清、改下载目录前留下的、失败后一直没管的。引擎启动读完
 * 队列后扫一遍，把这些超过期限没动过的删掉。
 *
 * 只碰确定是自己写的东西：下载根目录下名字是合法番号的子目录里，名为
 * `<番号>.<扩展名>.partial[.segs|.json]` 的文件。用户放进下载目录的其他文件一律不动。
 */
import { readdir, rm, rmdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeCode } from './queue'

/** 临时文件多久没修改算孤儿。 */
export const ORPHAN_TEMP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `<code>.<任意>.partial`，可带 .segs / .json 进度记录。 */
const tempPattern = (code: string): RegExp =>
  new RegExp(`^${escapeRegExp(code)}\\..+\\.partial(?:\\.segs|\\.json)?$`)

/** 读目录，不存在或读不了时当作空。 */
const list = (dir: string): Promise<string[]> =>
  readdir(dir).catch(() => [] as string[])

/**
 * 扫这些下载根目录（重复、不存在的都可以），删掉不属于等待 / 进行中任务、且超过
 * maxAgeMs 没修改的续传临时文件；番号目录因此变空就一并删掉。
 *
 * isPending 在处理每个番号目录前现问一次，扫的途中被重试的任务也不会被误删。
 * 单个文件删不掉（被占用等）跳过，不影响其余。
 */
export async function sweepOrphanTemps(
  roots: readonly string[],
  isPending: (code: string) => boolean,
  options: { now?: number; maxAgeMs?: number } = {}
): Promise<void> {
  const now = options.now ?? Date.now()
  const maxAge = options.maxAgeMs ?? ORPHAN_TEMP_MAX_AGE_MS
  for (const root of new Set(roots)) {
    for (const code of await list(root)) {
      if (normalizeCode(code) !== code) continue
      const dir = join(root, code)
      const pattern = tempPattern(code)
      const temps = (await list(dir)).filter(n => pattern.test(n))
      if (!temps.length || isPending(code)) continue
      for (const name of temps) {
        const path = join(dir, name)
        const info = await stat(path).catch(() => undefined)
        if (!info?.isFile() || now - info.mtimeMs <= maxAge) continue
        await rm(path, { force: true }).catch(() => {})
      }
      await rmdir(dir).catch(() => {}) // 非空（成品、未过期的临时文件）时保留
    }
  }
}

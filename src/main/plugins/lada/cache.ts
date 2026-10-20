/**
 * 续跑 / 区间的缓存目录（userData/lada-cache）：分段、进度文件、区间产物，
 * 以及设置页的「缓存大小 / 清理缓存」。
 */
import { app } from 'electron'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { LadaResumeProgress } from '../../../shared/lada'
import { runTool } from '../process'
import { isResumeProgressFile, parseDuration, sortParts } from './rules'

export const cacheRoot = (): string =>
  join(app.getPath('userData'), 'lada-cache')
export const keyFor = (input: string): string =>
  createHash('sha1').update(input.toLowerCase()).digest('hex').slice(0, 16)
/** 某个原片的续跑缓存目录 */
export const dirFor = (input: string): string =>
  join(cacheRoot(), keyFor(input))
export const partPath = (input: string, index: number): string =>
  join(dirFor(input), `part${index}.mp4`)
const progressPath = (input: string): string =>
  join(dirFor(input), 'progress.json')
/** 区间去码的产物目录（不写回片库，免得被当成新片子） */
export const rangeDirFor = (input: string): string =>
  join(cacheRoot(), 'ranges', keyFor(input))

/** 读续跑进度；没有或已处理不足 1 秒时返回 null */
export function readProgress(input: string): LadaResumeProgress | null {
  const file = progressPath(input)
  if (!existsSync(file)) return null
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as LadaResumeProgress
    if (!data || typeof data.doneSeconds !== 'number' || data.doneSeconds <= 1)
      return null
    return { ...data, input }
  } catch {
    return null
  }
}

/** 原子写续跑进度 */
export function writeProgress(progress: LadaResumeProgress): void {
  const dir = dirFor(progress.input)
  mkdirSync(dir, { recursive: true })
  const file = progressPath(progress.input)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(progress, null, 2))
  renameSync(tmp, file)
}

/** 已缓存的分段（按序号） */
export function partsOf(input: string): string[] {
  const dir = dirFor(input)
  if (!existsSync(dir)) return []
  return sortParts(readdirSync(dir)).map(n => join(dir, n))
}

/** ffprobe 读媒体时长 */
export async function durationOf(
  ffprobe: string,
  file: string
): Promise<number | null> {
  const { code, out } = await runTool(ffprobe, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1',
    file,
  ])
  if (code !== 0) return null
  return parseDuration(out)
}

/** 缓存目录总字节数 */
export function cacheSize(): number {
  try {
    let total = 0
    for (const dir of readdirSync(cacheRoot())) {
      const path = join(cacheRoot(), dir)
      for (const name of readdirSync(path)) {
        try {
          total += statSync(join(path, name)).size
        } catch {
          /* ignore */
        }
      }
    }
    return total
  } catch {
    return 0
  }
}

/** 清理可再生的缓存，保留暂停任务的进度 */
export function clearCache(): { success: boolean; freed: number } {
  // 只清"可再生"的东西：区间产物、拼接中间文件、转 TS 的碎片。
  // part*.mp4 与 progress.json 是**暂停任务的进度**，清掉就等于让人白跑，必须留着。
  let freed = 0
  const drop = (path: string, dir: boolean): void => {
    try {
      freed += dir ? 0 : statSync(path).size
      rmSync(path, { recursive: dir, force: true })
    } catch {
      /* 占用中就留给下次 */
    }
  }
  drop(join(cacheRoot(), 'ranges'), true)
  let keys: string[] = []
  try {
    keys = readdirSync(cacheRoot())
  } catch {
    return { success: true, freed }
  }
  for (const key of keys) {
    if (key === 'ranges') continue
    const dir = join(cacheRoot(), key)
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (isResumeProgressFile(name)) continue
      drop(join(dir, name), false)
    }
  }
  return { success: true, freed }
}

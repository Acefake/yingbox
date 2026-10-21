/**
 * lada 临时目录：半成品视频、归属记录（*.owner.json）、追播分片、机器级任务锁。
 *
 * 启动时清扫过期锁与**无主的**半成品；带归属记录的半成品交给续跑模块认领。
 */
import { app } from 'electron'
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { type JobLock, clearStaleLock, readLock } from './lock'
import { classifyTempEntry, sidecarVideo, tempVideoFor } from './rules'

/** lada 临时目录（也用于放锁、追播分片） */
export const tempDirPath = (): string => join(app.getPath('temp'), 'yingbox-lada')

/** lada 在临时目录里写的"纯视频半成品"路径（与它内部的命名规则一致） */
export function ladaTempVideo(output: string): string {
  return tempVideoFor(tempDirPath(), output)
}

/** 半成品的归属记录路径 */
export const sidecarFor = (output: string): string => `${ladaTempVideo(output)}.owner.json`

/** 删除文件；进程刚被杀时文件可能还被占着，重试几次，别把垃圾留下 */
export function dropFile(file: string): void {
  let attempt = 0
  const retry = (): void => {
    attempt += 1
    try {
      rmSync(file, { force: true })
    } catch {
      if (attempt < 6) setTimeout(retry, 400)
    }
  }
  retry()
}

/** 任务失败 / 取消后清掉半成品与归属记录 */
export function cleanupTemp(output: string): void {
  try {
    const tmp = ladaTempVideo(output)
    if (existsSync(tmp)) dropFile(tmp)
    // 归属记录跟着半成品一起清，否则 %TEMP% 里会攒一堆没人认的小文件
    const sidecar = `${tmp}.owner.json`
    if (existsSync(sidecar)) dropFile(sidecar)
  } catch {
    /* 清理失败不影响主流程；下次启动会清扫 */
  }
}

/** 别的影盒实例是否正在跑任务（跨实例可见）——界面据此提示用户 */
export function otherInstanceJob(): JobLock | null {
  const lock = readLock(tempDirPath())
  return lock && lock.pid !== process.pid ? lock : null
}

/** 清扫临时目录顶层：无主半成品超过 10 分钟删，孤立的归属记录删；目录读不到返回 false */
function sweepPartials(dir: string): boolean {
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return false
  }
  const cutoff = Date.now() - 10 * 60 * 1000
  for (const name of names) {
    const kind = classifyTempEntry(name)
    // 归属记录对应的半成品已经没了，这条记录本身就是垃圾
    if (kind === 'sidecar') {
      if (!existsSync(join(dir, sidecarVideo(name)))) {
        try {
          rmSync(join(dir, name), { force: true })
        } catch {
          /* 下次再说 */
        }
      }
      continue
    }
    if (kind !== 'partial') continue
    const file = join(dir, name)
    // 带"归属记录"的半成品是**能续跑的成果**，交给续跑模块认领，绝不删
    if (existsSync(`${file}.owner.json`)) continue
    try {
      if (statSync(file).mtimeMs > cutoff) continue
      rmSync(file, { force: true })
    } catch {
      /* 占用中就留给下次 */
    }
  }
  return true
}

/**
 * 「边跑边看」的分片目录只是看的时候的缓存（分片随时能重新切），但一个会话
 * 能攒到几个 G。正常停止会自己删；崩溃/被杀就会留下，所以这里兜底清掉。
 * 门槛设 6 小时：绝不会碰到别的窗口正在看的会话（那时它随时在写新分片）。
 */
function sweepLiveSessions(dir: string): void {
  const liveRoot = join(dir, 'live')
  const liveCutoff = Date.now() - 6 * 60 * 60 * 1000
  try {
    for (const name of readdirSync(liveRoot)) {
      const session = join(liveRoot, name)
      try {
        if (statSync(session).mtimeMs > liveCutoff) continue
        rmSync(session, { recursive: true, force: true })
      } catch {
        /* 占用中就留给下次 */
      }
    }
  } catch {
    /* 没有 live 目录就算了 */
  }
}

/** 启动时清扫：过期锁与**无主的**半成品临时视频 */
export function sweepOrphans(): void {
  const dir = tempDirPath()
  try {
    clearStaleLock(dir)
    // 别的实例正在跑就别动它的文件
    const lock = readLock(dir)
    if (lock && lock.pid !== process.pid) return
    // 临时目录都读不到就不必再看 live 子目录
    if (sweepPartials(dir)) sweepLiveSessions(dir)
  } catch {
    /* 清扫失败不影响主流程 */
  }
}

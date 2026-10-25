/**
 * 杜比视界播放会话的编码器一侧：会话状态、启停 ffmpeg（每轮最多 RUN_SEGMENTS 段）、分片就绪集合、
 * 发完分片后的清理与续编。启停编码器的操作经会话的串行队列执行（serial），HTTP 一侧见 transcode.ts。
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'

import type { DvOutput } from '../../shared/dolby-vision'
import { killTree, waitForExit } from '../plugins/process'

import { buildTranscodeArgs, segmentFile } from './filters'
import { type EncoderState, prunable, resumeFrom } from './playlist'

/** 编码器 stderr 只留最后这么多字符（出错时写日志） */
const STDERR_TAIL = 2000

/** 记一条错误日志（返回可直接交给 .catch 的函数）。 */
export const logError =
  (what: string) =>
  (error: unknown): void =>
    console.error(`[dolby-vision] ${what}：`, error)

/** 开一个会话需要的全部信息（能力与片源已由调用方探测好）。 */
export interface SessionPlan {
  input: string
  ffmpeg: string
  encoder: string
  output: DvOutput
  applyDolbyVision: boolean
  duration: number
  width?: number
  height?: number
  startAt: number
}

/** 一个播放会话。 */
export interface Session {
  id: string
  token: string
  dir: string
  plan: SessionPlan
  count: number
  server: Server
  child: ChildProcess | null
  runningFrom: number | null
  ready: Set<number>
  playing: number
  stderr: string
  /** 编码器异常退出的原因（等分片的请求据此尽快失败） */
  failed: string
  closed: boolean
  /** 启停编码器的操作串行执行（并发的分片请求不会各自重启一次） */
  queue: Promise<void>
  /** 串行队列里还没做完的操作数：不为 0 时编码器可能正在重启，等分片的请求不能放弃 */
  pending: number
}

/** 读分片目录，刷新已编好的分片集合（.tmp 是还在写的，不算）。 */
export async function refreshReady(s: Session): Promise<void> {
  const names = await fs.readdir(s.dir).catch(() => [] as string[])
  s.ready = new Set(
    names
      .map(name => /^seg(\d{5})\.m4s$/.exec(name))
      .filter((m): m is RegExpExecArray => m !== null)
      .map(m => Number(m[1]))
  )
}

/** 把启停编码器的操作排进会话的串行队列。 */
export function serial(s: Session, task: () => Promise<void>): Promise<void> {
  s.pending++
  const run = s.queue.then(task, task).finally(() => {
    s.pending--
  })
  s.queue = run.catch(() => {})
  return run
}

export const stateOf = (s: Session): EncoderState => ({
  runningFrom: s.runningFrom,
  ready: s.ready,
})

/** 删一个文件；失败（Windows 上文件正被读取等）只记日志，不影响播放。 */
export const removeQuietly = (file: string): Promise<void> =>
  fs.rm(file, { force: true }).catch(logError(`删除 ${file} 失败`))

/** 停掉编码器并等它退出；删掉没写完的 .tmp。 */
export async function stopEncoder(s: Session): Promise<void> {
  const child = s.child
  s.child = null
  s.runningFrom = null
  if (child) {
    await killTree(child)
    await waitForExit(child, 3000)
  }
  const names = await fs.readdir(s.dir).catch(() => [] as string[])
  await Promise.all(
    names
      .filter(n => n.endsWith('.tmp'))
      .map(n => removeQuietly(join(s.dir, n)))
  )
}

/** 从第 index 段（重新）开始编码一轮。 */
export async function startEncoder(s: Session, index: number): Promise<void> {
  await stopEncoder(s)
  if (s.closed) return
  s.failed = ''
  s.stderr = ''
  const args = buildTranscodeArgs({
    ...s.plan,
    startIndex: index,
    dir: s.dir,
    join,
  })
  const child = spawn(s.plan.ffmpeg, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  })
  s.child = child
  s.runningFrom = index
  child.stderr?.on('data', chunk => {
    s.stderr = (s.stderr + String(chunk)).slice(-STDERR_TAIL)
  })
  child.once('error', error => {
    if (s.child !== child) return
    s.child = null
    s.runningFrom = null
    s.failed = error.message
    console.error('[dolby-vision] 编码器启动失败：', error.message)
  })
  child.once('exit', code => {
    if (s.child !== child) return // 被重启替换掉的旧进程
    s.child = null
    s.runningFrom = null
    if (code !== 0 && !s.closed) {
      s.failed = s.stderr.trim().split('\n').at(-1) || `ffmpeg 退出码 ${code}`
      console.error('[dolby-vision] 编码失败：', s.stderr.trim())
    }
  })
}

/** 分片发出去之后：记播放位置、删旧分片、一轮编完且追近了就续编。 */
export async function afterServe(s: Session, index: number): Promise<void> {
  s.playing = index
  await refreshReady(s)
  await Promise.all(
    prunable(s.ready, index).map(i =>
      removeQuietly(join(s.dir, segmentFile(i)))
    )
  )
  const next = resumeFrom(stateOf(s), index, s.count)
  if (next !== null && !s.closed) await startEncoder(s, next)
}

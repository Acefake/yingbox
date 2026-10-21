/**
 * 去马赛克（lada）整片任务调度。
 *
 * lada 是 AGPL-3.0 的独立外部工具，这里只以子进程方式调用它，不打包、不链接。
 * 职责：起任务 → 解析进度 → 完成后交出 .restored.mp4。
 * 单并发：6GB 显存只够跑一个（跨实例靠 lock.ts 的机器级锁）。
 */
import { app } from 'electron'
import { type ChildProcess, spawn } from 'child_process'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { LadaJob } from '../../../shared/lada'
import { parseLadaLine, restoredPathFor } from '../../../shared/lada'
import { lada } from '../../../shared/contract/lada'
import { emit } from '../../rpc'
import { killTree } from '../process'
import { acquireLock, readLock, releaseLock } from './lock'
import { applyProgress, exitError, foreignJobMessage, ladaArgs, splitProgress, videoExtProblem } from './rules'
import { cleanupTemp, dropFile, sidecarFor, tempDirPath } from './temp'
import { detectCli } from './tools'

let job: LadaJob | null = null
let child: ChildProcess | null = null
/** lada 进程真的退出的信号（见 waitForLadaExit） */
let childExit: Promise<void> | null = null
let cancelled = false

/** 主进程内部监听任务结束（续跑要靠它在跑完剩余部分后自动拼接） */
const finishedListeners: ((job: LadaJob) => void)[] = []

/** 快照，避免把内部可变对象直接发给渲染层 */
export const snapshot = (): LadaJob | null => (job ? { ...job } : null)

/** 当前任务快照（追播用来判断 lada 是否已结束） */
export const currentJob = snapshot

export function onJobFinished(cb: (job: LadaJob) => void): void {
  finishedListeners.push(cb)
}

/** 校验输入：必须是存在的本地视频文件 */
function validateInput(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error('缺少文件路径')
  const filePath = input.trim()
  if (!isAbsolute(filePath)) throw new Error('必须是绝对路径')
  if (!existsSync(filePath)) throw new Error('文件不存在')
  if (!statSync(filePath).isFile()) throw new Error('不是文件')
  const problem = videoExtProblem(filePath)
  if (problem) throw new Error(problem)
  return filePath
}

function finish(state: LadaJob['state'], error?: string): void {
  if (!job) return
  job.state = state
  job.finishedAt = Date.now()
  if (error) job.error = error
  if (state === 'done') {
    job.percent = 100
    // lada 自己会删掉临时视频，但归属记录是影盒写的，成功时也得收掉
    const sidecar = sidecarFor(job.output)
    if (existsSync(sidecar)) dropFile(sidecar)
  } else {
    cleanupTemp(job.output)
  }
  const done = snapshot()
  child = null
  releaseLock(tempDirPath(), process.pid)
  emit(lada, 'progress', done)
  emit(lada, 'finished', done)
  if (done) for (const cb of finishedListeners) {
    try {
      cb(done)
    } catch {
      /* 监听者出错不影响别人 */
    }
  }
}

/** 抢机器级锁并写归属记录；抢不到抛错 */
function claim(input: string, source: string, output: string): void {
  // 机器级单任务：另一个影盒实例（甚至另一个窗口）在跑时也要拦住，否则两个 lada
  // 会一起抢显存互相打死（真实踩过）
  const foreign = readLock(tempDirPath())
  if (foreign) throw new Error(foreignJobMessage(foreign.input))
  if (!acquireLock(tempDirPath(), { pid: process.pid, input, startedAt: Date.now(), tag: app.getName() })) {
    throw new Error('已有一个去码任务在跑（可能来自另一个影盒窗口），请等它结束')
  }
  try {
    mkdirSync(tempDirPath(), { recursive: true })
  } catch {
    /* 交给 lada 自己创建 */
  }
  // 记下"这份半成品属于哪个源文件"，这样即使进程被杀，下次启动也能把它
  // 认领成可续跑的进度，而不是当垃圾删掉（这个坑真实踩过）
  try {
    writeFileSync(sidecarFor(output), JSON.stringify({ input, source, output, startedAt: Date.now() }))
  } catch {
    /* 记录失败不影响跑任务 */
  }
}

/** 启动一个去码任务（供 IPC、「边跑边看」、续跑与区间共用） */
export function startJob(input: string, opts?: { source?: string; output?: string }): LadaJob {
  const cli = detectCli()
  if (!cli) throw new Error('没找到 lada-cli，请在设置里指定路径（或在环境变量 YINGBOX_LADA_CLI 里给出）')
  const source = opts?.source ?? input
  const output = opts?.output ?? restoredPathFor(input)
  claim(input, source, output)

  cancelled = false
  job = {
    state: 'running',
    input,
    output,
    percent: null,
    fps: null,
    frames: null,
    message: '正在启动 lada（首次加载模型约 20-40 秒）…',
    startedAt: Date.now(),
  }
  emit(lada, 'progress', snapshot())

  const service = spawn(cli, ladaArgs(source, output, tempDirPath()), {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child = service
  // 记录"进程真的退出"这件事：taskkill 返回 ≠ lada 已经没了。
  // 谁要在杀掉之后马上再起一个 lada，必须等这个（否则两个 lada 抢显存一起死）。
  childExit = new Promise<void>(resolve => {
    service.once('close', () => resolve())
  })

  let buffer = ''
  let lastEmit = 0
  const onChunk = (chunk: Buffer | string): void => {
    const { lines, rest } = splitProgress(buffer + chunk.toString())
    buffer = rest
    for (const line of lines) {
      const parsed = parseLadaLine(line)
      if (job) applyProgress(job, parsed)
    }
    const now = Date.now()
    if (now - lastEmit > 150) {
      lastEmit = now
      emit(lada, 'progress', snapshot())
    }
  }
  service.stdout?.on('data', onChunk)
  service.stderr?.on('data', onChunk)

  service.once('error', err => {
    if (job && job.state === 'running') finish('failed', `lada 启动失败：${err.message}`)
  })
  service.once('exit', code => {
    if (!job || job.state !== 'running') return
    if (cancelled) return finish('cancelled')
    if (code === 0 && existsSync(output)) return finish('done')
    finish('failed', exitError(code, job.message))
  })

  return { ...job }
}

/** 取消当前任务：lada 是 PyInstaller 打包的，会带子进程，整棵树一起收。 */
export function cancelCurrentJob(): void {
  if (!child || !job) return
  cancelled = true
  void killTree(child).then(() => finish('cancelled'))
}

/** 退出时：取消在跑的任务并等进程真的退出 */
export async function stopForQuit(): Promise<void> {
  if (job?.state !== 'running') return
  cancelCurrentJob()
  await childExit
}

/**
 * 等当前 lada 进程**真的**退出，最多等 20 秒。
 * `taskkill` 一返回 `cancelJob` 就会把状态改成 cancelled，但那时进程往往还在收尾——
 * 此时立刻再起一个 lada，两个会一起抢显存互相打死（6GB 卡上必现，已实测）。
 */
export async function waitForLadaExit(): Promise<void> {
  const pending = childExit
  if (pending) {
    await Promise.race([pending, new Promise<void>(resolve => setTimeout(resolve, 20_000))])
  }
  // 再给驱动一点回收显存的时间
  await new Promise<void>(resolve => setTimeout(resolve, 1_000))
}

/** 播放时优先选择已修复的产物 */
export function playablePath(input: unknown): { path: string; restored: boolean } {
  const filePath = validateInput(input)
  const restored = restoredPathFor(filePath)
  return existsSync(restored) ? { path: restored, restored: true } : { path: filePath, restored: false }
}

/** 发起整片去码；已有任务在跑时返回失败 */
export function startTask(input: string): { success: boolean; job?: LadaJob; error?: string } {
  try {
    if (job && job.state === 'running') throw new Error('已有一个去码任务在跑，请先取消')
    return { success: true, job: startJob(validateInput(input)) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 插件健康：在跑时带上最后一条进度文字 */
export const jobHealth = (): { running: boolean; detail?: string } => ({
  running: job?.state === 'running',
  detail: job?.message,
})

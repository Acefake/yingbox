/**
 * 跑 ffmpeg / ffprobe / whisper-cli：按行回调输出、AbortSignal 取消时结束整棵进程树。
 */
import { spawn } from 'node:child_process'
import { killTree, relayLines } from '../plugins/process'

/** 进程结果：退出码与最后若干行输出（报错时给用户看） */
export interface ProcessResult {
  code: number
  tail: string[]
}

/** 进程没能启动（可执行文件不存在等） */
export class SpawnError extends Error {
  constructor(
    readonly bin: string,
    readonly code: string
  ) {
    super(`无法启动 ${bin}（${code}）`)
    this.name = 'SpawnError'
  }
}

/** 进程函数的形状（便于注入 mock） */
export type ProcessRun = (
  bin: string,
  args: string[],
  options: { signal: AbortSignal; onLine?: (line: string) => void }
) => Promise<ProcessResult>

/** 跑到结束；取消时结束进程树并以 AbortError 拒绝 */
export const runProcess: ProcessRun = (bin, args, options) =>
  new Promise((resolve, reject) => {
    options.signal.throwIfAborted()
    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const tail: string[] = []
    const onLine = (line: string): void => {
      tail.push(line)
      if (tail.length > 20) tail.shift()
      options.onLine?.(line)
    }
    relayLines(child.stdout, onLine)
    relayLines(child.stderr, onLine)
    const onAbort = (): void => void killTree(child)
    options.signal.addEventListener('abort', onAbort, { once: true })
    child.once('error', error => {
      options.signal.removeEventListener('abort', onAbort)
      reject(new SpawnError(bin, (error as NodeJS.ErrnoException).code ?? '?'))
    })
    child.once('exit', code => {
      options.signal.removeEventListener('abort', onAbort)
      if (options.signal.aborted) {
        reject(options.signal.reason)
        return
      }
      resolve({ code: code ?? -1, tail })
    })
  })

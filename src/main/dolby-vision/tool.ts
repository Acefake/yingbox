/**
 * 杜比视界模块跑 ffmpeg / ffprobe 的一次性命令：异步、带超时（Vulkan 初始化在坏驱动上可能卡住），从不抛错。
 * stdout 与 stderr 分开收：ffprobe 的 JSON 只从 stdout 取（probe.ts），stderr 只用于日志。
 */
import { spawn } from 'node:child_process'

import { killTree } from '../plugins/process'

/** 跑命令时每路输出的上限：ffprobe JSON 与 ffmpeg 错误日志都远小于它 */
const MAX_OUTPUT = 4 * 1024 * 1024

/** 起进程失败时的 code */
export const TOOL_SPAWN_FAILED = -1
/** 超时被杀时的 code */
export const TOOL_TIMED_OUT = -2

/** 一次命令的结果。 */
export interface DvToolResult {
  /** 退出码；TOOL_SPAWN_FAILED 起不来，TOOL_TIMED_OUT 超时被杀 */
  code: number
  stdout: string
  stderr: string
  /** 起不来时的系统错误码（如 ENOENT = 找不到程序） */
  error?: string
}

/** 一次性跑命令的函数形状（能力探测与识别的测试注入假的）。 */
export type ToolRunner = (
  bin: string,
  args: readonly string[],
  timeoutMs: number
) => Promise<DvToolResult>

/**
 * 跑一次命令到结束或超时。等 close（stdio 全部读完）才收尾，输出不会被截断；
 * 超时杀掉整棵进程树。
 */
export const runWithTimeout: ToolRunner = (bin, args, timeoutMs) =>
  new Promise(resolve => {
    const child = spawn(bin, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (code: number, error?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr, ...(error ? { error } : {}) })
    }
    const timer = setTimeout(() => {
      void killTree(child)
      finish(TOOL_TIMED_OUT)
    }, timeoutMs)
    child.stdout?.on('data', d => {
      if (stdout.length < MAX_OUTPUT) stdout += d
    })
    child.stderr?.on('data', d => {
      if (stderr.length < MAX_OUTPUT) stderr += d
    })
    child.once('error', (e: NodeJS.ErrnoException) =>
      finish(TOOL_SPAWN_FAILED, e.code ?? 'spawn-failed')
    )
    child.once('close', code => finish(code ?? TOOL_SPAWN_FAILED))
  })

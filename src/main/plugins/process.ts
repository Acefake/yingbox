import { type ChildProcess, spawn } from 'child_process'

/**
 * 插件子进程的公共工具：结束进程树、等待退出、按行转发日志、跑一次性命令。
 * Amane / Lada / mpv 原先各写一份 taskkill 与退出等待，统一收在这里。
 */

/** 子进程是否已经退出（exitCode 或 signalCode 任一有值）。 */
export function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

/**
 * 等子进程退出，最多等 timeoutMs。
 * @returns 在时限内退出返回 true，超时返回 false
 */
export function waitForExit(
  child: ChildProcess,
  timeoutMs: number
): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true)
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit)
      resolve(false)
    }, timeoutMs)
    timer.unref?.()
    const onExit = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    child.once('exit', onExit)
  })
}

/**
 * 强制结束子进程及其子孙进程。
 * Windows 用 `taskkill /T /F` 收整棵树（PyInstaller 打包的 Amane、lada 都会再起子进程）；
 * taskkill 起不来时退回 child.kill()。其它平台直接 child.kill()。
 * 返回时终止信号已发出，但进程不一定已退出；要确认退出请再 await waitForExit。
 */
export function killTree(child: ChildProcess): Promise<void> {
  if (hasExited(child)) return Promise.resolve()
  if (process.platform !== 'win32' || !child.pid) {
    child.kill()
    return Promise.resolve()
  }
  return new Promise(resolve => {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    })
    killer.once('error', () => {
      child.kill()
      resolve()
    })
    killer.once('exit', () => resolve())
  })
}

/** stopProcess 的选项。 */
export interface StopOptions {
  /** 先尝试的体面退出（如给 mpv 发 quit 命令）；失败或超时再强杀 */
  graceful?: () => Promise<unknown> | void
  /** 体面退出的等待时间，默认 1500ms */
  graceMs?: number
  /** 强杀后的等待时间，默认 3000ms */
  killWaitMs?: number
}

/**
 * 停止子进程：有 graceful 时先体面退出，超时后强杀进程树，再等它真正退出。
 * @returns 进程是否已确认退出
 */
export async function stopProcess(
  child: ChildProcess,
  options: StopOptions = {}
): Promise<boolean> {
  if (hasExited(child)) return true
  if (options.graceful) {
    try {
      await options.graceful()
    } catch {
      /* 体面退出失败就走强杀 */
    }
    if (await waitForExit(child, options.graceMs ?? 1500)) return true
  }
  await killTree(child)
  return waitForExit(child, options.killWaitMs ?? 3000)
}

/**
 * 把子进程输出按行转发给 log，每行截断到 500 字符。
 * 不转发时也必须把流读空，否则管道写满会卡住子进程。
 */
export function relayLines(
  stream: NodeJS.ReadableStream | null | undefined,
  log: ((line: string) => void) | null
): void {
  if (!stream) return
  if (!log) {
    stream.resume()
    return
  }
  let pending = ''
  stream.on('data', (chunk: Buffer | string) => {
    pending += chunk.toString()
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const raw of lines) {
      const line = raw.trim()
      if (line) log(line.slice(0, 500))
    }
  })
}

/** runTool 的结果：退出码（启动失败为 -1）与合并后的 stdout+stderr。 */
export interface ToolResult {
  code: number
  out: string
}

/** 跑一次性命令行工具（ffmpeg / ffprobe）到结束，收集全部输出；从不抛错。 */
export function runTool(bin: string, args: string[]): Promise<ToolResult> {
  return new Promise(resolve => {
    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let out = ''
    child.stdout?.on('data', d => {
      out += d
    })
    child.stderr?.on('data', d => {
      out += d
    })
    child.once('error', () => resolve({ code: -1, out }))
    child.once('exit', code => resolve({ code: code ?? -1, out }))
  })
}

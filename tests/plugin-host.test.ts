import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import type { ChildProcess } from 'child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawned = vi.hoisted(() => ({
  calls: [] as Array<{ bin: string; args: string[] }>,
  /** taskkill 的行为：'exit' 正常结束，'error' 起不来 */
  taskkill: 'exit' as 'exit' | 'error',
}))

vi.mock('child_process', async importOriginal => {
  const real = await importOriginal<typeof import('child_process')>()
  return {
    ...real,
    spawn: (bin: string, args: string[], opts: object) => {
      if (bin !== 'taskkill') return real.spawn(bin, args, opts)
      spawned.calls.push({ bin, args })
      const killer = new EventEmitter()
      setTimeout(() => killer.emit(spawned.taskkill), 1)
      return killer
    },
  }
})

import {
  type Plugin,
  installPluginHost,
  pluginHealth,
  registerPlugin,
  stopAllPlugins,
  unregisterPlugin,
} from '../src/main/plugins/host'
import {
  killTree,
  relayLines,
  runTool,
  stopProcess,
  waitForExit,
} from '../src/main/plugins/process'

/** 假子进程：kill() 后 exitAfterKill 毫秒内退出（null = 永不退出）。 */
function fakeChild(exitAfterKill: number | null = 1): ChildProcess & {
  killed: boolean
  exit(): void
} {
  const child = new EventEmitter() as ChildProcess & {
    killed: boolean
    exit(): void
  }
  Object.assign(child, { pid: 4242, exitCode: null, signalCode: null })
  child.exit = () => {
    Object.assign(child, { exitCode: 0 })
    child.emit('exit', 0)
  }
  child.kill = vi.fn(() => {
    if (exitAfterKill !== null) setTimeout(() => child.exit(), exitAfterKill)
    return true
  }) as ChildProcess['kill']
  return child
}

const ids: string[] = []

function plugin(id: string, overrides: Partial<Plugin> = {}): Plugin {
  ids.push(id)
  return registerPlugin({
    id,
    stop: vi.fn(),
    health: () => ({ running: true }),
    ...overrides,
  })
}

const realPlatform = process.platform
const setPlatform = (value: string): void => {
  Object.defineProperty(process, 'platform', { value })
}

beforeEach(() => {
  spawned.calls = []
  spawned.taskkill = 'exit'
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  ids.splice(0).forEach(unregisterPlugin)
  setPlatform(realPlatform)
  vi.restoreAllMocks()
})

describe('插件宿主', () => {
  it('只停止正在运行的插件，且并行停止', async () => {
    const order: string[] = []
    const slow = (id: string) => async () => {
      order.push(`${id}:start`)
      await new Promise(r => setTimeout(r, 20))
      order.push(`${id}:end`)
    }
    plugin('a', { stop: vi.fn(slow('a')) })
    plugin('b', { stop: vi.fn(slow('b')) })
    const idle = plugin('idle', { health: () => ({ running: false }) })
    expect(await stopAllPlugins()).toEqual([])
    expect(idle.stop).not.toHaveBeenCalled()
    expect(order.slice(0, 2)).toEqual(['a:start', 'b:start'])
  })

  it('单个插件抛错或超时不影响其它插件，并返回失败名单', async () => {
    plugin('boom', {
      stop: () => {
        throw new Error('x')
      },
    })
    plugin('hang', { stop: () => new Promise(() => {}) })
    const ok = plugin('ok')
    const failed = await stopAllPlugins(30)
    expect(failed.sort()).toEqual(['boom', 'hang'])
    expect(ok.stop).toHaveBeenCalledOnce()
  })

  it('health 抛错时记为未运行', () => {
    plugin('bad', {
      health: () => {
        throw new Error('坏了')
      },
    })
    expect(pluginHealth().bad).toEqual({ running: false, detail: '坏了' })
  })

  it('退出时先拦住退出、等插件停完再 quit，第二次放行', async () => {
    let release!: () => void
    const stop = vi.fn(() => new Promise<void>(r => (release = r)))
    plugin('p', { stop })
    const app = new EventEmitter() as EventEmitter & { quit(): void }
    app.quit = vi.fn(() => {
      app.emit('before-quit', event())
    })
    const prevented: boolean[] = []
    const event = () => {
      const e = { preventDefault: () => (e.prevented = true), prevented: false }
      setTimeout(() => prevented.push(e.prevented))
      return e
    }
    installPluginHost(app)

    const first = event()
    app.emit('before-quit', first)
    app.emit('before-quit', event()) // 停止中又触发一次：仍拦住，不重复停
    expect(first.prevented).toBe(true)
    expect(stop).toHaveBeenCalledOnce()
    expect(app.quit).not.toHaveBeenCalled()

    release()
    await new Promise(r => setTimeout(r, 5))
    expect(app.quit).toHaveBeenCalledOnce()
    expect(prevented).toEqual([true, true, false])
  })
})

describe('插件进程工具', () => {
  it('waitForExit 区分按时退出与超时', async () => {
    const child = fakeChild()
    setTimeout(() => child.exit(), 5)
    expect(await waitForExit(child, 100)).toBe(true)
    expect(await waitForExit(fakeChild(), 10)).toBe(false)
  })

  it('体面退出成功时不强杀', async () => {
    const child = fakeChild()
    const graceful = vi.fn(() => setTimeout(() => child.exit(), 2))
    expect(await stopProcess(child, { graceful, graceMs: 100 })).toBe(true)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('体面退出超时后强杀并等到退出', async () => {
    setPlatform('linux')
    const child = fakeChild()
    const ok = await stopProcess(child, { graceful: () => {}, graceMs: 10 })
    expect(ok).toBe(true)
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('强杀后仍不退出时返回 false', async () => {
    setPlatform('linux')
    expect(await stopProcess(fakeChild(null), { killWaitMs: 10 })).toBe(false)
  })

  it('Windows 用 taskkill /T /F 收整棵进程树', async () => {
    setPlatform('win32')
    const child = fakeChild()
    await killTree(child)
    expect(spawned.calls).toEqual([
      { bin: 'taskkill', args: ['/pid', '4242', '/T', '/F'] },
    ])
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('taskkill 起不来时退回 child.kill()', async () => {
    setPlatform('win32')
    spawned.taskkill = 'error'
    const child = fakeChild()
    await killTree(child)
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('已退出的进程不再发信号', async () => {
    const child = fakeChild()
    child.exit()
    await killTree(child)
    expect(child.kill).not.toHaveBeenCalled()
    expect(spawned.calls).toEqual([])
  })

  it('relayLines 按行转发、跳过空行、截断超长行；不转发时读空管道', () => {
    const stream = new PassThrough()
    const lines: string[] = []
    relayLines(stream, line => lines.push(line))
    stream.write('a\n\n  b  \npart')
    stream.write(`ial\n${'x'.repeat(600)}\n`)
    expect(lines).toEqual(['a', 'b', 'partial', 'x'.repeat(500)])

    const drained = new PassThrough()
    relayLines(drained, null)
    expect(drained.readableFlowing).toBe(true)
  })

  it('runTool 收集输出与退出码；命令不存在时返回 -1 不抛错', async () => {
    const result = await runTool(process.execPath, [
      '-e',
      'process.stdout.write("out");process.stderr.write("err");process.exit(3)',
    ])
    expect(result.code).toBe(3)
    expect(result.out).toContain('out')
    expect(result.out).toContain('err')
    expect((await runTool('no-such-binary-yingbox', [])).code).toBe(-1)
  })
})

describe('生命周期只在插件宿主里', () => {
  it('src/main 其它文件不再自己挂 before-quit 或调用 taskkill', async () => {
    const { readdirSync, readFileSync } = await import('fs')
    const { join } = await import('path')
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== 'plugins') walk(path)
        } else if (/\.ts$/.test(entry.name)) {
          const text = readFileSync(path, 'utf8')
          if (/before-quit|'taskkill'/.test(text)) offenders.push(path)
        }
      }
    }
    walk(join(__dirname, '../src/main'))
    expect(offenders).toEqual([])
  })
})

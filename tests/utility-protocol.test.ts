// test-affected: repo-wide（读 src 源码文本或跑 eslint，vitest 依赖图看不到这层依赖）
/**
 * 统一线协议（src/shared/utility/protocol.ts）：两种 utilityProcess 子进程的真实入口都说同一套信封，
 * 旧信封（在线引擎的 ToEngine / FromEngine、媒体库的 HostMessage / EngineMessage / RpcRequest /
 * RpcResponse）与只属于旧信封的 kind 在 src 里再也找不到。
 */
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FromUtility, ToUtility } from '../src/shared/utility/protocol'

vi.mock('electron', () => ({ net: undefined }))
vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
}))

const ROOT = join(__dirname, '..')
const realArgv = process.argv
const proc = process as unknown as { parentPort?: unknown }

/** 用假 parentPort 加载一个子进程入口，返回发消息与收到的消息。 */
async function boot(
  entry: string,
  argv: string[]
): Promise<{
  send: (message: ToUtility, ports?: unknown[]) => void
  received: FromUtility[]
}> {
  vi.resetModules()
  const received: FromUtility[] = []
  let listener: (e: { data: ToUtility; ports: unknown[] }) => void = () => {}
  proc.parentPort = {
    postMessage: (m: FromUtility) => received.push(m),
    on: (_event: string, fn: typeof listener) => (listener = fn),
  }
  process.argv = [realArgv[0], 'entry.js', ...argv]
  await import(entry)
  return {
    send: (data, ports = []) => listener({ data, ports }),
    received,
  }
}

afterEach(() => {
  process.argv = realArgv
  delete proc.parentPort
})

describe('统一线协议：真实入口', () => {
  it('在线引擎：报 ready；call → result（value / error.message）', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'wire-engine-'))
    const { send, received } = await boot('../src/engine/index', [userData])
    expect(received).toContainEqual({ kind: 'ready' })
    send({ kind: 'call', id: 1, method: 'download:list', args: [] })
    send({ kind: 'call', id: 2, method: 'nope:x', args: [] })
    await vi.waitFor(() =>
      expect(received.filter(m => m.kind === 'result')).toHaveLength(2)
    )
    expect(received).toContainEqual(
      expect.objectContaining({ kind: 'result', id: 1, ok: true })
    )
    expect(received).toContainEqual({
      kind: 'result',
      id: 2,
      ok: false,
      error: { message: '[engine] 未实现 nope:x' },
    })
  }, 30_000)

  it('媒体库引擎：报 ready；call（参数为 args[0]）→ result，错误带 code', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wire-library-'))
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never)
    const { send, received } = await boot('../src/main/library/engine/entry', [
      join(dir, 'library.db'),
      join(dir, 'media'),
    ])
    await vi.waitFor(() => expect(received).toContainEqual({ kind: 'ready' }))
    send({ kind: 'call', id: 1, method: 'listLibraries', args: [undefined] })
    send({ kind: 'call', id: 2, method: 'getItem', args: [{ itemId: 'x' }] })
    send({ kind: 'call', id: 3, method: 'getItem', args: [{ itemId: 404 }] })
    await vi.waitFor(() =>
      expect(received.filter(m => m.kind === 'result')).toHaveLength(3)
    )
    expect(received).toContainEqual({
      kind: 'result',
      id: 3,
      ok: true,
      value: null,
    })
    expect(received).toContainEqual({
      kind: 'result',
      id: 1,
      ok: true,
      value: [],
    })
    expect(received).toContainEqual({
      kind: 'result',
      id: 2,
      ok: false,
      error: expect.objectContaining({ code: 'invalid-params' }),
    })
    send({ kind: 'shutdown' })
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
    exit.mockRestore()
  }, 30_000)
})

/** src 下所有 .ts / .vue 文件。 */
function sources(dir = join(ROOT, 'src')): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|vue)$/.test(name) ? [path] : []
  })
}

describe('统一线协议：旧信封已删除', () => {
  const files = sources().map(path => ({
    path: relative(ROOT, path).replaceAll('\\', '/'),
    text: readFileSync(path, 'utf8'),
  }))

  it('只属于旧信封的 kind 在 src 里找不到', () => {
    const old =
      /kind\s*(?::|===|!==)\s*'(request|response|hostResult|images-cached)'|case\s+'(request|response|hostResult|images-cached)'/
    expect(files.filter(f => old.test(f.text)).map(f => f.path)).toEqual([])
  })

  it('旧信封类型不再导出，信封只在 shared/utility/protocol.ts 定义一处', () => {
    const oldTypes =
      /export\s+(type|interface)\s+(ToEngine|FromEngine|HostMessage|EngineMessage|RpcRequest|RpcResponse|SubscribeMessage|ShutdownMessage|ReadyMessage|ImagesCachedMessage)\b/
    expect(files.filter(f => oldTypes.test(f.text)).map(f => f.path)).toEqual(
      []
    )
    const envelope = /export\s+type\s+(ToUtility|FromUtility)\b/
    expect(files.filter(f => envelope.test(f.text)).map(f => f.path)).toEqual([
      'src/shared/utility/protocol.ts',
    ])
  })
})

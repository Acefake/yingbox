import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { spawn } = vi.hoisted(() => ({
  spawn: vi.fn(
    (
      _command: string,
      _args: string[],
      _options: { env: NodeJS.ProcessEnv }
    ) => ({
      on: vi.fn(),
    })
  ),
}))

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
  spawn,
}))

beforeEach(() => {
  vi.resetModules()
  spawn.mockClear()
  vi.stubEnv('YINGBOX_SKIP_DEPS_CHECK', '1')
  vi.stubEnv('NO_SANDBOX', process.env.NO_SANDBOX)
})
afterEach(() => vi.unstubAllEnvs())

describe('桌面启动环境', () => {
  it.each(['1', undefined])(
    '父进程 ELECTRON_RUN_AS_NODE=%s 时，桌面子进程仍使用 Electron 模式',
    async value => {
      vi.stubEnv('ELECTRON_RUN_AS_NODE', value)
      await import('../../scripts/dev-app.mjs')
      expect(spawn).toHaveBeenCalledTimes(1)
      const [command, args, options] = spawn.mock.calls[0]
      expect(command).toBe(process.execPath)
      expect(args.some(arg => arg.endsWith('electron-vite.js'))).toBe(true)
      expect(options.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
      expect(process.env.ELECTRON_RUN_AS_NODE).toBe(value)
      expect(options.env.PATH).toBe(process.env.PATH)
      expect(options.env.YINGBOX_SKIP_DEPS_CHECK).toBe('1')
    }
  )
})

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { runInstallation } =
  require('../resources/update-companion/install.cjs') as {
    runInstallation: (
      config: { parentPid: number; installer: string; args: string[] },
      deps: {
        parentAlive: (pid: number) => boolean
        sleep: (ms: number) => Promise<void>
        now: () => number
        install: (file: string, args: string[]) => Promise<void>
        stage: (value: string) => void
        log: (value: string) => void
      }
    ) => Promise<void>
  }

const config = {
  parentPid: 123,
  installer: 'setup.exe',
  args: ['/S', '--updated', '--force-run'],
}

describe('独立更新安装流程', () => {
  it('旧程序退出前不启动安装器，退出后携带明确的静默标记', async () => {
    let alive = true
    const stages: string[] = []
    const install = vi.fn(async () => {
      expect(alive).toBe(false)
    })
    await runInstallation(config, {
      parentAlive: () => alive,
      sleep: async () => {
        alive = false
      },
      now: () => 0,
      install,
      stage: stage => stages.push(stage),
      log: () => {},
    })
    expect(stages).toEqual(['exiting', 'installing', 'starting'])
    expect(install).toHaveBeenCalledWith(
      'setup.exe',
      expect.arrayContaining(['/S', '--yingbox-update-ui'])
    )
  })

  it('旧程序不退出时超时并停止，不能无限显示安装中', async () => {
    let now = 0
    const install = vi.fn()
    await expect(
      runInstallation(config, {
        parentAlive: () => true,
        sleep: async ms => {
          now += ms
        },
        now: () => now,
        install,
        stage: () => {},
        log: () => {},
      })
    ).rejects.toThrow('旧版本未能退出')
    expect(now).toBe(30_000)
    expect(install).not.toHaveBeenCalled()
  })

  it('安装失败后不发布正在启动阶段', async () => {
    const stages: string[] = []
    await expect(
      runInstallation(config, {
        parentAlive: () => false,
        sleep: async () => {},
        now: () => 0,
        install: async () => {
          throw new Error('安装失败')
        },
        stage: stage => stages.push(stage),
        log: () => {},
      })
    ).rejects.toThrow('安装失败')
    expect(stages).toEqual(['exiting', 'installing'])
  })

  it('安装脚本在独立更新窗口路径保持静默', () => {
    const nsh = readFileSync('build/installer.nsh', 'utf8')
    expect(nsh).toContain('--yingbox-update-ui')
    expect(nsh).toMatch(/SetSilent silent/)
  })
})

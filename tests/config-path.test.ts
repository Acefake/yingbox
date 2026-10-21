import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/**
 * userData 目录如果只在模块加载时求值一次，config.json 就会冻结在启动瞬间的 profile 上。
 * electron-vite preview 以 out/main/index.js 为入口启动时 app name 会退化成 "Electron"，
 * 主进程随后修正 userData 也救不回来——下载目录等设置仍写进 %APPDATA%\Electron，
 * 换个入口启动就“看起来没保存”。
 */
const state = {
  userData: join('C:', 'Users', 'tester', 'AppData', 'Roaming', 'Electron'),
}

vi.mock('electron', () => ({
  app: {
    getPath: (name: string): string =>
      name === 'userData' ? state.userData : join('C:', 'Users', 'tester'),
  },
}))

describe('config.json 路径', () => {
  it('按调用时的 userData 解析，不会把设置写进已经过期的 profile', async () => {
    const { getConfigPath } = await import('../src/main/config')

    state.userData = join(
      'C:',
      'Users',
      'tester',
      'AppData',
      'Roaming',
      'yingbox'
    )

    expect(getConfigPath()).toBe(join(state.userData, 'config.json'))
  })
})

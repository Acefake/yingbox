import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {} }))
import {
  UPDATE_QUIT_FORCE_EXIT_MS,
  pruneUpdateCompanions,
  quitForCompanionInstall,
  syncUpdateCompanionApp,
} from '../src/main/updater/companion'

it('只清理已退出的历史运行时，保留当前、存活进程和未知目录', async () => {
  const root = await mkdtemp(join(tmpdir(), 'yb-companion-cleanup-'))
  try {
    for (const [version, pid] of [
      ['1.0.1', 2147483647],
      ['1.0.2', process.pid],
      ['1.0.3', 2147483647],
    ] as const) {
      const helper = join(root, version, 'resources', 'app')
      await mkdir(helper, { recursive: true })
      await writeFile(join(helper, 'helper.pid'), String(pid))
    }
    await mkdir(join(root, 'notes'))
    await mkdir(join(root, '1.0.0'))
    await pruneUpdateCompanions(root, '1.0.3')
    await expect(access(join(root, '1.0.1'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    for (const name of ['1.0.0', '1.0.2', '1.0.3', 'notes'])
      await expect(access(join(root, name))).resolves.toBeUndefined()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('已准备过的更新窗口仍会刷新安装脚本', async () => {
  const root = await mkdtemp(join(tmpdir(), 'yb-companion-sync-'))
  try {
    const companion = join(root, 'companion')
    const renderer = join(root, 'renderer')
    const helper = join(root, 'helper')
    await mkdir(companion, { recursive: true })
    await mkdir(renderer, { recursive: true })
    await mkdir(helper, { recursive: true })
    await writeFile(join(helper, 'main.cjs'), 'old')
    await writeFile(join(companion, 'main.cjs'), 'new-main')
    await writeFile(join(companion, 'install.cjs'), 'new-install')
    await writeFile(join(renderer, 'update.html'), 'ui')
    await syncUpdateCompanionApp(helper, { companion, renderer })
    expect(await readFile(join(helper, 'main.cjs'), 'utf8')).toBe('new-main')
    expect(await readFile(join(helper, 'install.cjs'), 'utf8')).toBe(
      'new-install'
    )
    expect(
      await readFile(join(helper, 'renderer', 'update.html'), 'utf8')
    ).toBe('ui')
    expect(
      JSON.parse(await readFile(join(helper, 'package.json'), 'utf8'))
    ).toEqual({
      name: 'yingbox-update-companion',
      main: 'main.cjs',
    })
    await writeFile(join(helper, 'renderer', 'update.html'), 'cached-ui')
    await syncUpdateCompanionApp(helper, { companion })
    expect(
      await readFile(join(helper, 'renderer', 'update.html'), 'utf8')
    ).toBe('cached-ui')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('更新退出先走 quit，超时再强制 exit', () => {
  vi.useFakeTimers()
  try {
    const host = { quit: vi.fn(), exit: vi.fn() }
    quitForCompanionInstall(host)
    expect(host.quit).toHaveBeenCalledOnce()
    expect(host.exit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(UPDATE_QUIT_FORCE_EXIT_MS)
    expect(host.exit).toHaveBeenCalledWith(0)
  } finally {
    vi.useRealTimers()
  }
})

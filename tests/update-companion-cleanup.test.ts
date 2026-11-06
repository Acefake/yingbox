import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {} }))
import { pruneUpdateCompanions } from '../src/main/updater/companion'

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

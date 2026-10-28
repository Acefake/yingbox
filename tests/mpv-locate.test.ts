import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const { appPath } = vi.hoisted(() => ({ appPath: vi.fn() }))
vi.mock('electron', () => ({ app: { getAppPath: appPath } }))
vi.mock('../src/main/mpv-install', () => ({
  canInstallMpv: () => false,
  userMpvDir: () => join(tmpdir(), 'yingbox-test-mpv-absent'),
}))

import { findMpvExecutable } from '../src/main/mpv-locate'

let directory = ''
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

it('发现项目内直接放在 mpv 目录的播放器', async () => {
  directory = await mkdtemp(join(tmpdir(), 'yingbox-mpv-locate-'))
  const folder = join(directory, 'resources', 'mpv')
  await mkdir(folder, { recursive: true })
  const exe = join(folder, process.platform === 'win32' ? 'mpv.exe' : 'mpv')
  await writeFile(exe, '')
  appPath.mockReturnValue(directory)
  expect(findMpvExecutable()).toBe(exe)
})

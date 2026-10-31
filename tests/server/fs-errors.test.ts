import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listDirectory } from '../../src/server/routes/fs'
import { type Harness, startServer } from './server-harness'

const readdir = vi.hoisted(() => vi.fn())
vi.mock('node:fs/promises', async importOriginal => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  readdir: (...args: unknown[]) => readdir(...args),
}))
let work: string | undefined
let server: Harness | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
  if (work) await rm(work, { recursive: true, force: true })
  work = undefined
  vi.clearAllMocks()
})

describe('添加文件夹的错误边界', () => {
  it('目录被删除或选到文件时返回不存在，不抛出 500', async () => {
    work = await mkdtemp(join(tmpdir(), 'yingbox-fs-'))
    const file = join(work, 'video.mp4')
    await writeFile(file, 'video')
    expect(await listDirectory(file, [work])).toBeNull()
    expect(await listDirectory(join(work, 'missing'), [work])).toBeNull()
    const dir = join(work, 'deleted')
    await mkdir(dir)
    readdir.mockRejectedValue(
      Object.assign(new Error('gone'), { code: 'ENOENT' })
    )
    expect(await listDirectory(dir, [work])).toBeNull()
  })
  it('读取 NAS 目录权限不足时返回 403 和挂载提示', async () => {
    work = await mkdtemp(join(tmpdir(), 'yingbox-fs-'))
    readdir.mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'EACCES' })
    )
    await expect(listDirectory(work, [work])).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('Docker 挂载'),
    })
  })
  it('入库 RPC 拒绝普通文件和不存在的目录', async () => {
    server = await startServer({
      fetch: async () => new Response('', { status: 404 }),
      env: { YINGBOX_ONLINE: 'off', YINGBOX_NETDISK: 'off' },
    })
    for (const root of [
      server.write('video.mp4', 'video'),
      join(server.media, 'missing'),
    ]) {
      expect(
        await server.rpc('addLibrary', { root, kind: 'movie' })
      ).toMatchObject({ ok: false, error: { code: 'invalid-params' } })
    }
  })
})

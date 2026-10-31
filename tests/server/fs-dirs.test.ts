/**
 * 目录浏览：权限失败回 JSON（不再冒泡成纯文本 500），并打出路径和错误码。
 * withFileTypes 在部分网络盘上会失败时，退回按名字再确认目录。
 */
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Router } from '../../src/server/http/router'
import {
  listDirectory,
  mediaRootAccessError,
  registerFsRoutes,
} from '../../src/server/routes/fs'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readdir: vi.fn((...args: Parameters<typeof actual.readdir>) =>
      actual.readdir(...args)
    ),
  }
})

const dirs: string[] = []
const actualFs =
  vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')

afterEach(async () => {
  const actual = await actualFs
  vi.mocked(fsp.readdir).mockImplementation((...args) =>
    actual.readdir(...args)
  )
  for (const dir of dirs.splice(0)) {
    spawnSync('chmod', ['-R', 'u+rwx', dir])
    rmSync(dir, { recursive: true, force: true })
  }
})

function workDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yingbox-fs-'))
  dirs.push(dir)
  return dir
}

async function get(
  router: Router,
  path: string
): Promise<{
  status: number
  body: { error?: string; dirs?: { name: string }[] }
}> {
  const url = new URL(`http://nas${path}`)
  const match = router.match('GET', url.pathname)
  if (!match || match === 'method-not-allowed') throw new Error('no route')
  const response = await match.handler(new Request(url), {
    url,
    params: match.params,
  })
  return {
    status: response.status,
    body: (await response.json()) as {
      error?: string
      dirs?: { name: string }[]
    },
  }
}

describe('目录浏览失败', () => {
  it('根目录没权限时回 403 JSON，日志带路径和 EACCES', async () => {
    const root = workDir()
    chmodSync(root, 0)
    const logs: string[] = []
    const router = new Router()
    registerFsRoutes(router, [root], message => logs.push(message))

    const res = await get(router, '/api/fs/dirs')
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/没有权限读取/)
    expect(res.body.error).toContain(root)
    expect(res.body.error).toContain('EACCES')
    expect(logs.join('\n')).toMatch(/读取目录失败/)
    expect(logs.join('\n')).toContain(`path=${root}`)
    expect(logs.join('\n')).toContain('code=EACCES')
    chmodSync(root, 0o755)
  })

  it('进入不可读子目录同样回 403，而不是纯文本 500', async () => {
    const root = workDir()
    const locked = join(root, 'locked')
    mkdirSync(locked)
    chmodSync(locked, 0o111)
    const logs: string[] = []
    const router = new Router()
    registerFsRoutes(router, [root], message => logs.push(message))

    const res = await get(
      router,
      `/api/fs/dirs?path=${encodeURIComponent(locked)}`
    )
    expect(res.status).toBe(403)
    expect(res.body.error).toContain('EACCES')
    expect(logs[0]).toContain(`path=${locked}`)
    chmodSync(locked, 0o755)
  })

  it('根目录外或不存在的路径仍是 404', async () => {
    const root = workDir()
    const outside = workDir()
    const router = new Router()
    registerFsRoutes(router, [root])
    expect(
      (await get(router, `/api/fs/dirs?path=${encodeURIComponent(outside)}`))
        .status
    ).toBe(404)
    expect(
      (
        await get(
          router,
          `/api/fs/dirs?path=${encodeURIComponent(join(root, 'missing'))}`
        )
      ).body.error
    ).toBe('目录不存在或不在媒体根目录内')
  })

  it('启动检查把不可读根目录和进程 uid/gid 写进说明', async () => {
    const root = workDir()
    chmodSync(root, 0)
    const message = await mediaRootAccessError(root)
    expect(message).toMatch(/EACCES/)
    expect(message).toContain(root)
    expect(message).toMatch(/uid=\d+ gid=\d+/)
    chmodSync(root, 0o755)
  })
})

describe('目录浏览列表', () => {
  it('列出子目录和仍在根目录内的链接，跳过文件、隐藏项和逃出根目录的链接', async () => {
    const parent = workDir()
    const root = join(parent, 'media')
    const outside = join(parent, 'outside')
    mkdirSync(join(root, 'Shows'), { recursive: true })
    mkdirSync(outside)
    writeFileSync(join(root, 'movie.mkv'), 'x')
    mkdirSync(join(root, '.hidden'))
    symlinkSync(join(root, 'Shows'), join(root, 'link-in'))
    symlinkSync(outside, join(root, 'link-out'))

    const listing = await listDirectory(root, [root])
    expect(listing?.dirs.map(dir => dir.name).sort()).toEqual([
      'Shows',
      'link-in',
    ])
  })

  it('withFileTypes 失败时按名字再确认，目录和链接仍能列出', async () => {
    const actual =
      await vi.importActual<typeof import('node:fs/promises')>(
        'node:fs/promises'
      )
    vi.mocked(fsp.readdir).mockImplementation(async (path, options) => {
      if (
        options &&
        typeof options === 'object' &&
        'withFileTypes' in options &&
        options.withFileTypes
      )
        throw Object.assign(new Error('ENOTSUP'), { code: 'ENOTSUP' })
      return actual.readdir(path as string)
    })
    const parent = workDir()
    const root = join(parent, 'media')
    mkdirSync(join(root, 'Shows'), { recursive: true })
    symlinkSync(join(root, 'Shows'), join(root, 'link-in'))
    writeFileSync(join(root, 'movie.mkv'), 'x')

    const listing = await listDirectory(root, [root])
    expect(listing?.dirs.map(dir => dir.name).sort()).toEqual([
      'Shows',
      'link-in',
    ])
  })

  it('多个根目录里不可读的被略过并记日志，剩下的仍返回', async () => {
    const good = workDir()
    const bad = workDir()
    chmodSync(bad, 0)
    const logs: string[] = []
    const listing = await listDirectory(null, [good, bad], message =>
      logs.push(message)
    )
    expect(listing?.dirs.map(dir => dir.path)).toEqual([good])
    expect(logs.join('\n')).toContain(`path=${bad}`)
    expect(logs.join('\n')).toContain('code=EACCES')
    chmodSync(bad, 0o755)
  })
})

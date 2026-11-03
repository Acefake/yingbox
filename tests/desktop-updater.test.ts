import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type DesktopUpdaterDeps,
  createDesktopUpdater,
} from '../src/main/updater/desktop-updater'
import type { UpdateStatusEvent } from '../src/shared/contract/update'

const BODY = Buffer.from('installer-bytes'.repeat(100))
const SHA = createHash('sha256').update(BODY).digest('hex')
const URL = 'https://github.com/Acefake/yingbox/releases/download/v1.0.3/x.exe'

const releases = (sha = SHA, size = BODY.length): unknown[] => [
  {
    tag_name: 'v1.0.3',
    draft: false,
    prerelease: false,
    body: '新版本',
    published_at: '2026-11-03T00:00:00Z',
    assets: [
      {
        name: 'yingbox-setup-1.0.3.exe',
        size,
        digest: `sha256:${sha}`,
        browser_download_url: URL,
      },
    ],
  },
]

let dir = ''
const events: UpdateStatusEvent[] = []
const launch = vi.fn(async () => undefined)
const quit = vi.fn()

function setup(
  over: Partial<DesktopUpdaterDeps> & { list?: unknown; file?: Buffer } = {}
): ReturnType<typeof createDesktopUpdater> {
  const list = over.list ?? releases()
  const file = over.file ?? BODY
  return createDesktopUpdater({
    fetch: (async (input: string | URL | Request) =>
      String(input).startsWith('https://api.github.com')
        ? new Response(JSON.stringify(list))
        : new Response(new Uint8Array(file))) as typeof fetch,
    platform: 'win32',
    version: '1.0.2',
    dir,
    now: () => 0,
    emit: status => events.push(status),
    launch,
    quit,
    ...over,
  })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'yb-updater-'))
  events.length = 0
  launch.mockClear()
  launch.mockImplementation(async () => undefined)
  quit.mockClear()
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('桌面更新器', () => {
  it('没有更新时报告已是最新', async () => {
    const updater = setup({ version: '1.0.3' })
    expect(await updater.check()).toEqual({ success: true, data: null })
    expect(events.at(-1)?.status).toBe('not-available')
  })

  it('非 Windows 不支持应用内更新', async () => {
    const result = await setup({ platform: 'darwin' }).check()
    expect(result.success).toBe(false)
  })

  it('检查到更新，下载校验通过后才算下载完成，安装启动安装包并退出', async () => {
    const updater = setup()
    expect(await updater.check()).toMatchObject({
      success: true,
      data: { version: '1.0.3' },
    })
    expect(await updater.download()).toEqual({ success: true })
    expect(events.map(e => e.status)).toEqual([
      'checking',
      'available',
      'downloading',
      'downloaded',
    ])
    expect(await readdir(dir)).toEqual(['yingbox-setup-1.0.3.exe'])
    await updater.install()
    expect(launch).toHaveBeenCalledWith(join(dir, 'yingbox-setup-1.0.3.exe'), [
      '--updated',
      '--force-run',
    ])
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('校验值不一致时丢弃文件、报错，且不能安装', async () => {
    const updater = setup({ list: releases('0'.repeat(64)) })
    await updater.check()
    const result = await updater.download()
    expect(result.success).toBe(false)
    expect(events.at(-1)?.status).toBe('error')
    expect(await readdir(dir)).toEqual([])
    await updater.install()
    expect(launch).not.toHaveBeenCalled()
  })

  it('下载内容大小与发布不符时视为损坏', async () => {
    const updater = setup({ file: Buffer.from('short') })
    await updater.check()
    expect((await updater.download()).success).toBe(false)
    expect(await readdir(dir)).toEqual([])
  })

  it('没检查就下载、没下载就安装都不动作', async () => {
    const updater = setup()
    expect((await updater.download()).success).toBe(false)
    await updater.install()
    expect(launch).not.toHaveBeenCalled()
  })

  it('下载前清掉其他版本的安装包和残留文件', async () => {
    await writeFile(join(dir, 'yingbox-setup-1.0.0.exe'), 'old')
    await writeFile(join(dir, 'yingbox-setup-1.0.1.exe.part'), 'half')
    const updater = setup()
    await updater.check()
    await updater.download()
    expect(await readdir(dir)).toEqual(['yingbox-setup-1.0.3.exe'])
  })

  it('重复点击下载共用同一次下载，不会互相删文件', async () => {
    let downloads = 0
    const updater = setup({
      fetch: (async (input: string | URL | Request) => {
        if (String(input).startsWith('https://api.github.com'))
          return new Response(JSON.stringify(releases()))
        downloads++
        return new Response(new Uint8Array(BODY))
      }) as typeof fetch,
    })
    await updater.check()
    const [a, b] = await Promise.all([updater.download(), updater.download()])
    expect(a).toEqual({ success: true })
    expect(b).toEqual({ success: true })
    expect(downloads).toBe(1)
    expect(await readdir(dir)).toEqual(['yingbox-setup-1.0.3.exe'])
  })

  it('已下载后再检查更新仍保持已下载，不用重新下载', async () => {
    const updater = setup()
    await updater.check()
    await updater.download()
    await updater.check()
    expect(events.at(-1)?.status).toBe('downloaded')
    expect(await updater.download()).toEqual({ success: true })
  })

  it('安装包启动失败时报错并保留应用', async () => {
    launch.mockRejectedValueOnce(new Error('ENOENT'))
    const updater = setup()
    await updater.check()
    await updater.download()
    await updater.install()
    expect(quit).not.toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({ status: 'error' })
  })

  it('响应比发布声明的更大时中止并丢弃', async () => {
    const updater = setup({ file: Buffer.concat([BODY, BODY]) })
    await updater.check()
    expect((await updater.download()).success).toBe(false)
    expect(await readdir(dir)).toEqual([])
  })

  it('发布列表请求失败时报告错误', async () => {
    const updater = setup({
      fetch: (async () => new Response('', { status: 403 })) as typeof fetch,
    })
    const result = await updater.check()
    expect(result).toMatchObject({ success: false })
    expect(events.at(-1)?.status).toBe('error')
  })
})

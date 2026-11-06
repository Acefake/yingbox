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

function isReleasesUrl(input: string): boolean {
  return input.includes('api.github.com') && input.includes('/releases')
}

function setup(
  over: Partial<DesktopUpdaterDeps> & { list?: unknown; file?: Buffer } = {}
): ReturnType<typeof createDesktopUpdater> {
  const list = over.list ?? releases()
  const file = over.file ?? BODY
  return createDesktopUpdater({
    fetch: (async (input: string | URL | Request) =>
      isReleasesUrl(String(input))
        ? new Response(JSON.stringify(list))
        : new Response(new Uint8Array(file))) as typeof fetch,
    platform: 'win32',
    version: '1.0.2',
    dir,
    now: () => 0,
    emit: status => events.push(status),
    autoDownload: () => false,
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
  it('手动检查绕过缓存，能发现刚发布的版本', async () => {
    let list: unknown = []
    const updater = setup({
      fetch: (async () => new Response(JSON.stringify(list))) as typeof fetch,
    })
    expect(await updater.check()).toMatchObject({ data: null })
    list = releases()
    expect(await updater.check(true)).toMatchObject({
      success: true,
      data: { version: '1.0.3' },
    })
  })

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
      '/S',
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

  it('检查更新：官方失败后镜像成功', async () => {
    const calls: string[] = []
    const updater = setup({
      fetch: (async (input: string | URL | Request) => {
        const u = String(input)
        calls.push(u)
        if (u.startsWith('https://api.github.com'))
          throw new TypeError('fetch failed')
        if (u.includes('gh-proxy.com') && isReleasesUrl(u))
          return new Response(JSON.stringify(releases()))
        return new Response(new Uint8Array(BODY))
      }) as typeof fetch,
    })
    expect((await updater.check()).success).toBe(true)
    expect(calls.some(c => c.includes('gh-proxy.com'))).toBe(true)
  })

  it('下载：官方失败后镜像成功并校验通过', async () => {
    const updater = setup({
      fetch: (async (input: string | URL | Request) => {
        const u = String(input)
        if (isReleasesUrl(u)) return new Response(JSON.stringify(releases()))
        if (u === URL) throw new TypeError('fetch failed')
        if (u.includes('gh-proxy.com') && u.includes(URL))
          return new Response(new Uint8Array(BODY))
        throw new Error(u)
      }) as typeof fetch,
    })
    await updater.check()
    expect(await updater.download()).toEqual({ success: true })
    expect(await readdir(dir)).toEqual(['yingbox-setup-1.0.3.exe'])
  })

  it('下载：镜像自身 403 也换下一个候选（ADR-0055）', async () => {
    const calls: string[] = []
    const updater = setup({
      fetch: (async (input: string | URL | Request) => {
        const u = String(input)
        calls.push(u)
        if (isReleasesUrl(u)) return new Response(JSON.stringify(releases()))
        if (u === URL) throw new TypeError('fetch failed')
        // 第一个镜像配额耗尽，第二个镜像可用
        if (u.includes('ghfast.top')) return new Response('', { status: 403 })
        return new Response(new Uint8Array(BODY))
      }) as typeof fetch,
    })
    await updater.check()
    expect(await updater.download()).toEqual({ success: true })
    expect(calls.some(u => u.includes('ghfast.top'))).toBe(true)
    expect(await readdir(dir)).toEqual(['yingbox-setup-1.0.3.exe'])
  })

  it('下载：还有下一个候选时，长时间低速就换源', async () => {
    let clock = 0
    let slowUrl = ''
    const updater = setup({
      now: () => clock,
      // 声明大小远大于慢速候选实际写入的字节，避免先触发大小上限
      list: releases(SHA, BODY.length),
      fetch: (async (input: string | URL | Request) => {
        const u = String(input)
        if (isReleasesUrl(u)) return new Response(JSON.stringify(releases()))
        if (!slowUrl) {
          slowUrl = u
          // 每个数据块很小、但模拟时间推进 20 秒，三次后超过低速窗口
          let sent = 0
          return new Response(
            new ReadableStream({
              pull(controller) {
                if (sent++ >= 6) return controller.close()
                clock += 20_000
                controller.enqueue(new Uint8Array(16))
              },
            })
          )
        }
        return new Response(new Uint8Array(BODY))
      }) as typeof fetch,
    })
    await updater.check()
    expect(await updater.download()).toEqual({ success: true })
    // 慢速候选被放弃，换到了下一个地址
    expect(slowUrl).toBe(URL)
    expect(events.some(e => e.status === 'error')).toBe(false)
  })

  it('下载：最后一个候选不因低速被中断', async () => {
    let clock = 0
    let served = 0
    const updater = setup({
      now: () => clock,
      fetch: (async (input: string | URL | Request) => {
        const u = String(input)
        if (isReleasesUrl(u)) return new Response(JSON.stringify(releases()))
        served++
        // 每个块 10 字节、模拟时间推进 1 秒，全程平均 10 B/s：前两个候选会被低速放弃
        let offset = 0
        return new Response(
          new ReadableStream({
            pull(controller) {
              if (offset >= BODY.length) return controller.close()
              clock += 1_000
              controller.enqueue(BODY.subarray(offset, offset + 10))
              offset += 10
            },
          })
        )
      }) as typeof fetch,
    })
    await updater.check()
    expect(await updater.download()).toEqual({ success: true })
    // 官方与第一个镜像被低速放弃，最后一个候选跑完
    expect(served).toBe(3)
    expect(events.some(e => e.status === 'error')).toBe(false)
  })

  it('重复点击下载共用同一次下载，不会互相删文件', async () => {
    let downloads = 0
    const updater = setup({
      fetch: (async (input: string | URL | Request) => {
        if (isReleasesUrl(String(input)))
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
    expect(events.at(-1)).toMatchObject({ status: 'error', phase: 'check' })
  })

  it('下载失败的错误事件标记为下载环节', async () => {
    const updater = setup({
      fetch: (async (input: string | URL | Request) =>
        isReleasesUrl(String(input))
          ? new Response(JSON.stringify(releases()))
          : new Response('', { status: 403 })) as typeof fetch,
    })
    await updater.check()
    expect((await updater.download()).success).toBe(false)
    expect(events.at(-1)).toMatchObject({ status: 'error', phase: 'download' })
  })

  it('安装包启动失败的错误事件标记为安装环节', async () => {
    launch.mockRejectedValueOnce(new Error('ENOENT'))
    const updater = setup()
    await updater.check()
    await updater.download()
    await updater.install()
    expect(events.at(-1)).toMatchObject({ status: 'error', phase: 'install' })
  })

  it('开了自动下载：检查到更新后自动下载，下载完成变为已下载', async () => {
    const updater = setup({ autoDownload: () => true })
    await updater.check()
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe('downloaded'))
    expect(events.map(e => e.status)).toEqual([
      'checking',
      'available',
      'downloading',
      'downloaded',
    ])
  })

  it('没开自动下载：检查到更新后停在可下载，不会自己下载', async () => {
    const updater = setup()
    await updater.check()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(events.at(-1)?.status).toBe('available')
    expect(await readdir(dir)).toEqual([])
  })

  it('退出时：开了自动更新且已下载，静默装上但不拉起新版', async () => {
    const updater = setup({ autoDownload: () => true })
    await updater.check()
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe('downloaded'))
    updater.installOnQuit()
    updater.installOnQuit()
    expect(launch).toHaveBeenCalledTimes(1)
    expect(launch).toHaveBeenCalledWith(join(dir, 'yingbox-setup-1.0.3.exe'), [
      '/S',
    ])
  })

  it('退出时：没开自动更新或没有已下载的更新，什么也不装', async () => {
    const off = setup()
    await off.check()
    await off.download()
    off.installOnQuit()
    setup({ autoDownload: () => true }).installOnQuit()
    expect(launch).not.toHaveBeenCalled()
  })

  it('点了更新并重启后，退出时不会再装一次', async () => {
    const updater = setup({ autoDownload: () => true })
    await updater.check()
    await vi.waitFor(() => expect(events.at(-1)?.status).toBe('downloaded'))
    await updater.install()
    updater.installOnQuit()
    expect(launch).toHaveBeenCalledTimes(1)
  })
})

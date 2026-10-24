/**
 * 进度条缩略图服务的退出清理：准备阶段计入 busy、stop() 后不再启动 ffmpeg、stop() 等子进程真正退出。
 * spawn 被替换成假子进程，不会真的跑 ffmpeg。
 */
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

const { SeekThumbnailService } =
  await import('../src/main/seek-thumbnails/service')

/** 可以从外部决定何时、以什么结果返回的 Promise。 */
function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

/** 假子进程：kill() 之后过一会儿才发 exit，模拟真实退出有延迟。 */
function fakeChild(): EventEmitter & { kill: () => boolean; stderr: null } {
  const child = Object.assign(new EventEmitter(), {
    stderr: null,
    kill: () => {
      setTimeout(() => child.emit('exit', null), 20)
      return true
    },
  })
  return child
}

/** 等到条件成立（轮询事件循环）。 */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) {
    await new Promise(r => setTimeout(r, 5))
  }
  expect(check()).toBe(true)
}

let dir: string
let video: string

beforeEach(async () => {
  spawnMock.mockReset()
  dir = await mkdtemp(join(tmpdir(), 'seek-service-'))
  video = join(dir, 'movie.mp4')
  await writeFile(video, 'fake video')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('退出清理', () => {
  it('定位 ffmpeg 期间算 busy；stop 后定位器再返回也不创建子进程', async () => {
    const located = deferred<string | null>()
    let asked = false
    const service = new SeekThumbnailService({
      mediaDir: join(dir, 'media'),
      locateFfmpeg: () => {
        asked = true
        return located.promise
      },
      notify: () => {},
      log: () => {},
    })
    await service.request(video, 600)
    await until(() => asked)
    expect(service.busy).toBe(true)

    let stopped = false
    const stopping = service.stop().then(() => {
      stopped = true
    })
    await new Promise(r => setTimeout(r, 10))
    // 任务还卡在定位器上，stop 不能提前返回
    expect(stopped).toBe(false)

    located.resolve('/usr/bin/ffmpeg')
    await stopping
    expect(spawnMock).not.toHaveBeenCalled()
    expect(service.busy).toBe(false)

    // 停止后不再接新任务
    await service.request(video, 600)
    expect(service.busy).toBe(false)
  })

  it('ffmpeg 在跑时 stop 结束它并等到子进程退出', async () => {
    const child = fakeChild()
    const kill = vi.spyOn(child, 'kill')
    spawnMock.mockReturnValue(child)
    const service = new SeekThumbnailService({
      mediaDir: join(dir, 'media'),
      locateFfmpeg: async () => '/usr/bin/ffmpeg',
      notify: () => {},
      log: () => {},
    })
    await service.request(video, 600)
    await until(() => spawnMock.mock.calls.length === 1)

    let exited = false
    child.once('exit', () => {
      exited = true
    })
    await service.stop()
    expect(kill).toHaveBeenCalled()
    expect(exited).toBe(true)
    expect(service.busy).toBe(false)
  })
})

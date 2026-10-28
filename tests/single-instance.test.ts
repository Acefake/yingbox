import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { installSingleInstance } from '../src/main/single-instance'

it('第二个进程立即退出，不打开窗口或等待初始化', () => {
  const app = Object.assign(new EventEmitter(), {
    requestSingleInstanceLock: () => false,
    exit: vi.fn(),
    whenReady: vi.fn(),
  })
  const show = vi.fn()
  installSingleInstance(app, show)
  expect(app.exit).toHaveBeenCalledWith(0)
  expect(app.listenerCount('second-instance')).toBe(0)
  expect(app.whenReady).not.toHaveBeenCalled()
  expect(show).not.toHaveBeenCalled()
})

it('重复启动会在首个进程初始化完成后显示主窗口', async () => {
  let ready!: () => void
  const promise = new Promise<void>(resolve => {
    ready = resolve
  })
  const app = Object.assign(new EventEmitter(), {
    requestSingleInstanceLock: () => true,
    exit: vi.fn(),
    whenReady: () => promise,
  })
  const show = vi.fn()
  installSingleInstance(app, show)
  app.emit('second-instance')
  expect(show).not.toHaveBeenCalled()
  ready()
  await promise
  expect(show).toHaveBeenCalledTimes(1)
  expect(app.exit).not.toHaveBeenCalled()
  app.emit('second-instance')
  await promise
  expect(show).toHaveBeenCalledTimes(2)
})

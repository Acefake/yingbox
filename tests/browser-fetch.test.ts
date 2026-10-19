import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  readFileSync: vi.fn(),
  close: vi.fn(),
  listen: vi.fn(),
  on: vi.fn(),
}))
vi.mock('fs', () => mocks)
vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\userData' },
  BrowserWindow: vi.fn(),
  screen: {},
  session: { fromPartition: () => ({ setUserAgent: vi.fn() }) },
}))
vi.mock('http', () => ({
  createServer: () => ({
    on: mocks.on,
    listen: mocks.listen,
    close: mocks.close,
    address: () => ({ port: 12345 }),
  }),
}))

import {
  startBrowserFetchService,
  stopBrowserFetchService,
} from '../src/main/browser-fetch'

beforeEach(() => {
  stopBrowserFetchService()
  vi.resetAllMocks()
  mocks.listen.mockImplementation((_port, _host, ready) => ready())
})

describe('browser fetch discovery publication', () => {
  it.each(['writeFileSync', 'renameSync'] as const)(
    'falls back when %s is denied on the temp directory',
    operation => {
      mocks[operation].mockImplementationOnce(() => {
        throw Object.assign(new Error('denied'), { code: 'EPERM' })
      })
      expect(() => startBrowserFetchService()).not.toThrow()
      expect(mocks.close).not.toHaveBeenCalled()
      expect(mocks.writeFileSync.mock.calls.map(call => String(call[0]))).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/Temp|tmp/i),
          expect.stringMatching(/userData/),
        ])
      )
    }
  )

  it('survives EPERM on every location and permits retry', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.writeFileSync.mockImplementation(() => {
      throw Object.assign(new Error('denied'), { code: 'EPERM' })
    })
    expect(() => startBrowserFetchService()).not.toThrow()
    expect(mocks.close).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalled()
    mocks.writeFileSync.mockImplementation(() => {})
    startBrowserFetchService()
    expect(mocks.listen).toHaveBeenCalledTimes(2)
    log.mockRestore()
  })

  it('publishes a complete file by rename', () => {
    startBrowserFetchService()
    const [path, body] = mocks.writeFileSync.mock.calls[0]
    expect(JSON.parse(body)).toMatchObject({
      pid: process.pid,
      url: 'http://127.0.0.1:12345',
    })
    expect(mocks.renameSync).toHaveBeenCalledWith(
      path,
      expect.stringMatching(/yingbox-browser-fetch\.json$/)
    )
  })

  it('does not delete another process discovery file on shutdown', () => {
    mocks.readFileSync.mockReturnValue(JSON.stringify({ pid: process.pid + 1 }))
    stopBrowserFetchService()
    expect(mocks.rmSync).not.toHaveBeenCalled()
  })
})

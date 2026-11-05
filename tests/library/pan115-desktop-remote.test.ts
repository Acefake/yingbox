/**
 * 桌面端 115 片库：引擎侧 pan115 源经主进程代办列目录，播放代理把 pan115 交给专用源。
 */
import { describe, expect, it, vi } from 'vitest'

import {
  type HostCaller,
  PAN115_PROPFIND_METHOD,
  WEBDAV_ACCESS_METHOD,
  hostRemoteClients,
} from '../../src/main/library/remote/host-remote'
import { forwardRemote } from '../../src/main/webdav/proxy'

const entry = {
  path: '/123/a.mkv',
  name: 'a.mkv',
  isDir: false,
  size: 1,
  lastModified: null,
  etag: null,
}

describe('hostRemoteClients · pan115', () => {
  it('pan115 源经 pan115Propfind 代办取目录，不取 WebDAV 凭据', async () => {
    const call = vi.fn().mockResolvedValue([entry])
    const host: HostCaller = { call, settle: () => false }
    const client = await hostRemoteClients(host, vi.fn())('pan115')
    expect(await client.propfind('/123', 1)).toEqual([entry])
    expect(call).toHaveBeenCalledWith(PAN115_PROPFIND_METHOD, ['/123', 1])
    expect(call).not.toHaveBeenCalledWith(
      WEBDAV_ACCESS_METHOD,
      expect.anything()
    )
  })

  it('已取消的扫描不再请求主进程', async () => {
    const call = vi.fn()
    const host: HostCaller = { call, settle: () => false }
    const client = await hostRemoteClients(host, vi.fn())('pan115')
    await expect(
      client.propfind('/123', 1, AbortSignal.abort())
    ).rejects.toBeDefined()
    expect(call).not.toHaveBeenCalled()
  })
})

describe('forwardRemote · 专用源', () => {
  const request = (
    method: string,
    range?: string
  ): Parameters<typeof forwardRemote>[0] => ({
    method,
    header: (name: string) => (name === 'range' ? range : null),
  })

  it('命中专用源：带完整远程路径与 Range 交给它，不查 WebDAV 凭据', async () => {
    const stream = vi.fn(
      async (_path: string, req: Request) =>
        new Response(req.headers.get('range'), { status: 206 })
    )
    const lookup = vi.fn()
    const res = await forwardRemote(
      request('GET', 'bytes=0-9'),
      { sourceId: 'pan115', path: '/123/a.mkv' },
      lookup,
      vi.fn(),
      { id: 'pan115', stream }
    )
    expect(res.status).toBe(206)
    expect(await res.text()).toBe('bytes=0-9')
    expect(stream.mock.calls[0][0]).toBe('yingbox-dav://pan115/123/a.mkv')
    expect(lookup).not.toHaveBeenCalled()
  })

  it('专用源抛错回 502', async () => {
    const res = await forwardRemote(
      request('GET'),
      { sourceId: 'pan115', path: '/123/a.mkv' },
      vi.fn(),
      vi.fn(),
      { id: 'pan115', stream: () => Promise.reject(new Error('x')) }
    )
    expect(res.status).toBe(502)
  })
})
